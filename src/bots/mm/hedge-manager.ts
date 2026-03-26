// Delta-neutral hedge manager
// Runs independently from MM quoting logic on its own interval.
// Reads the MM bot's net position and places offsetting market orders
// to maintain near-zero net exposure.

import {
	FillMode,
	type NordUser,
	Side,
	type UserAtomicSubaction,
} from "@n1xyz/nord-ts";
import Decimal from "decimal.js";
import { log } from "../../utils/logger.js";

export interface HedgeManagerConfig {
	readonly hedgeThresholdUsd: number;
	readonly hedgeRatio: number;
	readonly hedgeSyncIntervalMs: number;
	readonly marketId: number;
	readonly sizeDecimals: number;
}

/** Provides the MM bot's current net position in base units */
export interface PositionProvider {
	getBaseSize(): number;
}

/** Provides the current fair price for USD conversion */
export interface FairPriceProvider {
	getFairPrice(): number | null;
}

/** Provides the current best bid/ask for IOC order pricing */
export interface OrderbookProvider {
	getBestBid(): number | null;
	getBestAsk(): number | null;
}

export class HedgeManager {
	private hedgePositionBase = 0;
	private isRunning = false;
	private isBusy = false;

	constructor(
		private readonly config: HedgeManagerConfig,
		private readonly user: NordUser,
		private readonly positionProvider: PositionProvider,
		private readonly fairPriceProvider: FairPriceProvider,
		private readonly orderbookProvider: OrderbookProvider,
	) {}

	start(): void {
		if (this.isRunning) return;
		this.isRunning = true;
		log.info(
			`HEDGE: started (threshold=$${this.config.hedgeThresholdUsd}, ratio=${this.config.hedgeRatio}, interval=${this.config.hedgeSyncIntervalMs}ms)`,
		);
		this.syncLoop();
	}

	stop(): void {
		this.isRunning = false;
	}

	/** Close the hedge position on shutdown. Returns once the close order is sent. */
	async closeHedge(): Promise<void> {
		if (this.hedgePositionBase === 0) {
			log.info("HEDGE: no hedge position to close");
			return;
		}

		const fairPrice = this.fairPriceProvider.getFairPrice();
		if (!fairPrice) {
			log.warn("HEDGE: cannot close hedge — no fair price available");
			return;
		}

		const closeSize = Math.abs(this.hedgePositionBase);
		// If hedge is long, we sell to close; if short, we buy to close
		const closeSide = this.hedgePositionBase > 0 ? "short" : "long";
		const closeUsd = closeSize * fairPrice;

		log.hedgeAction(closeSide, closeUsd);

		try {
			await this.placeMarketOrder(
				closeSide === "long" ? Side.Bid : Side.Ask,
				closeSize,
				fairPrice,
			);
			this.hedgePositionBase = 0;
			log.info("HEDGE: hedge position closed");
		} catch (err) {
			log.error("HEDGE: failed to close hedge position:", err);
		}
	}

	getHedgePositionBase(): number {
		return this.hedgePositionBase;
	}

	private async syncLoop(): Promise<void> {
		while (this.isRunning) {
			await this.sync();
			await this.sleep(this.config.hedgeSyncIntervalMs);
		}
	}

	private async sync(): Promise<void> {
		if (this.isBusy) return;
		this.isBusy = true;

		try {
			const fairPrice = this.fairPriceProvider.getFairPrice();
			if (!fairPrice) return;

			const mmPositionBase = this.positionProvider.getBaseSize();
			const mmPositionUsd = mmPositionBase * fairPrice;
			const hedgePositionUsd = this.hedgePositionBase * fairPrice;

			// Target hedge is the opposite of the MM position, scaled by hedgeRatio
			// If MM is long 1 BTC, target hedge is short (1 * hedgeRatio) BTC
			const targetHedgeBase = -mmPositionBase * this.config.hedgeRatio;
			const deltaBase = targetHedgeBase - this.hedgePositionBase;
			const deltaUsd = deltaBase * fairPrice;

			log.hedge(mmPositionUsd, hedgePositionUsd, deltaUsd);

			// Only act if delta exceeds threshold
			if (Math.abs(deltaUsd) < this.config.hedgeThresholdUsd) {
				return;
			}

			// Determine direction: positive delta = need to buy, negative = need to sell
			const direction: "long" | "short" = deltaBase > 0 ? "long" : "short";
			const orderSize = Math.abs(deltaBase);

			log.hedgeAction(direction, Math.abs(deltaUsd));

			const side = direction === "long" ? Side.Bid : Side.Ask;
			await this.placeMarketOrder(side, orderSize, fairPrice);

			// Assume fill (IOC at aggressive price should fill immediately)
			this.hedgePositionBase += deltaBase;
		} catch (err) {
			log.error("HEDGE: sync error:", err);
		} finally {
			this.isBusy = false;
		}
	}

	private async placeMarketOrder(
		side: typeof Side.Bid | typeof Side.Ask,
		sizeBase: number,
		fairPrice: number,
	): Promise<void> {
		// Price the IOC order aggressively to ensure fill:
		// Buy: use best ask + 0.5% slippage. Sell: use best bid - 0.5% slippage.
		const SLIPPAGE = 0.005;
		let price: number;

		if (side === Side.Bid) {
			const bestAsk = this.orderbookProvider.getBestAsk();
			price = (bestAsk ?? fairPrice) * (1 + SLIPPAGE);
		} else {
			const bestBid = this.orderbookProvider.getBestBid();
			price = (bestBid ?? fairPrice) * (1 - SLIPPAGE);
		}

		const roundedSize = new Decimal(sizeBase).toDecimalPlaces(
			this.config.sizeDecimals,
			Decimal.ROUND_DOWN,
		);

		if (roundedSize.isZero()) return;

		const action: UserAtomicSubaction = {
			kind: "place" as const,
			marketId: this.config.marketId,
			side,
			fillMode: FillMode.ImmediateOrCancel,
			isReduceOnly: false,
			price: new Decimal(price).toDecimalPlaces(2),
			size: roundedSize,
		};

		const sideLabel = side === Side.Bid ? "BUY" : "SELL";
		log.info(
			`HEDGE ORDER: ${sideLabel} IOC ${roundedSize.toString()} @ $${price.toFixed(2)}`,
		);

		await this.user.atomic([action]);
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
