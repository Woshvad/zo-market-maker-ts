// Atomic order operations with immediate order ID tracking

import {
	FillMode,
	type NordUser,
	Side,
	type UserAtomicSubaction,
} from "@n1xyz/nord-ts";
import Decimal from "decimal.js";
import type { Quote } from "../types.js";
import { log } from "../utils/logger.js";

const MAX_ATOMIC_ACTIONS = 4;
const DEFAULT_MAX_RETRIES = 5;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 5000;

// Cached order info
export interface CachedOrder {
	orderId: string;
	side: "bid" | "ask";
	price: Decimal;
	size: Decimal;
}

// Result type for atomic operations
interface AtomicResult {
	results: Array<{
		inner: {
			case: string;
			value: {
				orderId?: string;
				posted?: {
					orderId: string;
				};
			};
		};
	}>;
}

function formatAction(action: UserAtomicSubaction): string {
	if (action.kind === "cancel") {
		return `X${action.orderId}`;
	}
	const side = action.side === Side.Bid ? "B" : "A";
	const ro = action.isReduceOnly ? "RO" : "";
	const fm =
		action.fillMode === FillMode.PostOnly
			? "PO"
			: action.fillMode === FillMode.Limit
				? "LIM"
				: action.fillMode === FillMode.ImmediateOrCancel
					? "IOC"
					: "FOK";
	return `${side}${ro}[${fm}]@${action.price}x${action.size}`;
}

// Extract placed orders from atomic result
function extractPlacedOrders(
	result: AtomicResult,
	actions: UserAtomicSubaction[],
): CachedOrder[] {
	const orders: CachedOrder[] = [];
	const placeActions = actions.filter((a) => a.kind === "place");
	let placeIdx = 0;

	for (const r of result.results) {
		if (r.inner.case === "placeOrderResult" && r.inner.value.posted?.orderId) {
			const action = placeActions[placeIdx];
			if (action && action.kind === "place") {
				orders.push({
					orderId: r.inner.value.posted.orderId,
					side: action.side === Side.Bid ? "bid" : "ask",
					price: new Decimal(action.price as Decimal.Value),
					size: new Decimal(action.size as Decimal.Value),
				});
			}
			placeIdx++;
		}
	}
	return orders;
}

// Execute atomic operations in chunks of MAX_ATOMIC_ACTIONS with retry
async function executeAtomic(
	user: NordUser,
	actions: UserAtomicSubaction[],
	maxRetries = DEFAULT_MAX_RETRIES,
): Promise<CachedOrder[]> {
	if (actions.length === 0) return [];

	const allOrders: CachedOrder[] = [];
	const totalChunks = Math.ceil(actions.length / MAX_ATOMIC_ACTIONS);

	for (let i = 0; i < actions.length; i += MAX_ATOMIC_ACTIONS) {
		const chunkIdx = Math.floor(i / MAX_ATOMIC_ACTIONS) + 1;
		const chunk = actions.slice(i, i + MAX_ATOMIC_ACTIONS);

		log.info(
			`ATOMIC [${chunkIdx}/${totalChunks}]: ${chunk.map(formatAction).join(" ")}`,
		);

		let lastError: unknown;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const result = (await user.atomic(chunk)) as AtomicResult;
				const placed = extractPlacedOrders(result, chunk);
				allOrders.push(...placed);

				if (placed.length > 0) {
					log.debug(`ATOMIC: placed [${placed.map((o) => o.orderId).join(", ")}]`);
				}
				lastError = null;
				break;
			} catch (err) {
				lastError = err;
				if (attempt < maxRetries) {
					const backoffMs = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
					log.warn(`ATOMIC retry ${attempt + 1}/${maxRetries} in ${backoffMs}ms: ${err instanceof Error ? err.message : String(err)}`);
					await new Promise((resolve) => setTimeout(resolve, backoffMs));
				}
			}
		}

		if (lastError) {
			throw lastError;
		}
	}

	return allOrders;
}

// Build place action from quote
function buildPlaceAction(marketId: number, quote: Quote): UserAtomicSubaction {
	const action = {
		kind: "place" as const,
		marketId,
		side: quote.side === "bid" ? Side.Bid : Side.Ask,
		fillMode: FillMode.PostOnly,
		isReduceOnly: false,
		price: quote.price,
		size: quote.size,
	};
	log.debug(`ORDER JSON: ${JSON.stringify(action)}`);
	return action;
}

// Build cancel action from order ID
function buildCancelAction(orderId: string): UserAtomicSubaction {
	return {
		kind: "cancel" as const,
		orderId,
	};
}

// Check if order matches quote (same side, price, size)
function orderMatchesQuote(order: CachedOrder, quote: Quote): boolean {
	return (
		order.side === quote.side &&
		order.price.eq(quote.price) &&
		order.size.eq(quote.size)
	);
}

// Result from updateQuotes — includes divergence flag
export interface UpdateQuotesResult {
	orders: CachedOrder[];
	/** True if retries were exhausted and state may have diverged from server */
	diverged: boolean;
}

// Update quotes: only cancel/place if changed, with retry + divergence detection
export async function updateQuotes(
	user: NordUser,
	marketId: number,
	currentOrders: CachedOrder[],
	newQuotes: Quote[],
): Promise<UpdateQuotesResult> {
	const keptOrders: CachedOrder[] = [];
	const ordersToCancel: CachedOrder[] = [];
	const quotesToPlace: Quote[] = [];

	// For each new quote, check if matching order exists
	for (const quote of newQuotes) {
		const matchingOrder = currentOrders.find((o) =>
			orderMatchesQuote(o, quote),
		);
		if (matchingOrder) {
			keptOrders.push(matchingOrder);
		} else {
			quotesToPlace.push(quote);
		}
	}

	// Cancel orders that don't match any new quote
	for (const order of currentOrders) {
		if (!keptOrders.includes(order)) {
			ordersToCancel.push(order);
		}
	}

	// Log expected vs actual order state
	log.info(
		`ORDER SYNC: expected=${currentOrders.length} (keep=${keptOrders.length}, cancel=${ordersToCancel.length}, place=${quotesToPlace.length})`,
	);

	// Skip if nothing to do
	if (ordersToCancel.length === 0 && quotesToPlace.length === 0) {
		return { orders: currentOrders, diverged: false };
	}

	// Build actions: cancels first, then places
	const actions: UserAtomicSubaction[] = [
		...ordersToCancel.map((o) => buildCancelAction(o.orderId)),
		...quotesToPlace.map((q) => buildPlaceAction(marketId, q)),
	];

	try {
		const placedOrders = await executeAtomic(user, actions);
		return { orders: [...keptOrders, ...placedOrders], diverged: false };
	} catch (err) {
		log.error(`ORDER DIVERGENCE: atomic operation failed after ${DEFAULT_MAX_RETRIES} retries — local state may not match server`, err);
		// Return empty orders — caller must treat state as unknown
		return { orders: [], diverged: true };
	}
}

// Cancel orders with retry
export async function cancelOrders(
	user: NordUser,
	orders: CachedOrder[],
): Promise<{ diverged: boolean }> {
	if (orders.length === 0) return { diverged: false };
	const actions = orders.map((o) => buildCancelAction(o.orderId));
	try {
		await executeAtomic(user, actions);
		return { diverged: false };
	} catch (err) {
		log.error(`CANCEL DIVERGENCE: cancel failed after ${DEFAULT_MAX_RETRIES} retries — orders may still be open on server`, err);
		return { diverged: true };
	}
}

// Place a market-style IOC reduce-only order (used for halt position close)
export async function placeMarketOrder(
	user: NordUser,
	marketId: number,
	side: "bid" | "ask",
	size: Decimal,
	price: Decimal,
): Promise<void> {
	const action: UserAtomicSubaction = {
		kind: "place",
		marketId,
		side: side === "bid" ? Side.Bid : Side.Ask,
		fillMode: FillMode.ImmediateOrCancel,
		isReduceOnly: true,
		price,
		size,
	};
	log.info(
		`MARKET ORDER: ${side} ${size.toString()} @ ${price.toString()} (IOC reduce-only)`,
	);
	await executeAtomic(user, [action]);
}

