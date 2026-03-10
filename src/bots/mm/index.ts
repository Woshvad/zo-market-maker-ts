// MarketMaker - main bot logic

import type { NordUser } from "@n1xyz/nord-ts";
import Decimal from "decimal.js";
import type { DebouncedFunc } from "lodash-es";
import { throttle } from "lodash-es";
import { BinancePriceFeed } from "../../pricing/binance.js";
import {
	FairPriceCalculator,
	type FairPriceConfig,
	type FairPriceProvider,
} from "../../pricing/fair-price.js";
import { AccountStream, type FillEvent } from "../../sdk/account.js";
import { createZoClient, type ZoClient } from "../../sdk/client.js";
import { ZoOrderbookStream } from "../../sdk/orderbook.js";
import {
	type CachedOrder,
	cancelOrders,
	placeMarketOrder,
	updateQuotes,
} from "../../sdk/orders.js";
import type { MidPrice } from "../../types.js";
import { log } from "../../utils/logger.js";
import type { MarketMakerConfig } from "./config.js";
import { FeedStateManager, type FeedStateCallbacks } from "./feed-state.js";
import { calculateInventorySkew } from "./inventory-skew.js";
import { type PositionConfig, PositionTracker } from "./position.js";
import { Quoter } from "./quoter.js";
import { PnlTracker } from "./pnl-tracker.js";
import { VolatilityTracker } from "./volatility.js";

export type { MarketMakerConfig } from "./config.js";

// API order type from SDK
interface ApiOrder {
	orderId: bigint | number;
	marketId: number;
	side: "bid" | "ask";
	price: number | string;
	size: number | string;
}

// Convert API orders to cached orders
function mapApiOrdersToCached(orders: ApiOrder[]): CachedOrder[] {
	return orders.map((o) => ({
		orderId: o.orderId.toString(),
		side: o.side,
		price: new Decimal(o.price),
		size: new Decimal(o.size),
	}));
}

// Derive Binance symbol from market symbol (e.g., "BTC-PERP" → "btcusdt")
function deriveBinanceSymbol(marketSymbol: string): string {
	const baseSymbol = marketSymbol
		.replace(/-PERP$/i, "")
		.replace(/USD$/i, "")
		.toLowerCase();
	return `${baseSymbol}usdt`;
}

export class MarketMaker {
	private client: ZoClient | null = null;
	private marketId = 0;
	private marketSymbol = "";
	private accountStream: AccountStream | null = null;
	private orderbookStream: ZoOrderbookStream | null = null;
	private binanceFeed: BinancePriceFeed | null = null;
	private fairPriceCalc: FairPriceProvider | null = null;
	private positionTracker: PositionTracker | null = null;
	private quoter: Quoter | null = null;
	private isRunning = false;
	private lastLoggedSampleCount = -1;
	private activeOrders: CachedOrder[] = [];
	private isUpdating = false;
	private throttledUpdate: DebouncedFunc<
		(fairPrice: number) => Promise<void>
	> | null = null;
	private statusInterval: ReturnType<typeof setInterval> | null = null;
	private orderSyncInterval: ReturnType<typeof setInterval> | null = null;
	private feedState: FeedStateManager | null = null;
	private volatilityTracker: VolatilityTracker | null = null;
	private pnlTracker: PnlTracker | null = null;
	private staleCheckInterval: ReturnType<typeof setInterval> | null = null;
	private haltedWarningInterval: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly config: MarketMakerConfig,
		private readonly privateKey: string,
	) {}

	private requireClient(): ZoClient {
		if (!this.client) {
			throw new Error("Client not initialized");
		}
		return this.client;
	}

	async run(): Promise<void> {
		log.banner();

		await this.initialize();
		this.setupEventHandlers();
		await this.syncInitialOrders();
		this.startIntervals();
		this.registerShutdownHandlers();

		log.info("Warming up price feeds...");
		await this.waitForever();
	}

	private async initialize(): Promise<void> {
		this.throttledUpdate = throttle(
			(fairPrice: number) => this.executeUpdate(fairPrice),
			this.config.updateThrottleMs,
			{ leading: true, trailing: true },
		);

		this.client = await createZoClient(this.privateKey);
		const { nord, accountId } = this.client;

		// Find market by symbol (e.g., "BTC" matches "BTC-PERP")
		const market = nord.markets.find((m) =>
			m.symbol.toUpperCase().startsWith(this.config.symbol.toUpperCase()),
		);
		if (!market) {
			const available = nord.markets.map((m) => m.symbol).join(", ");
			throw new Error(
				`Market "${this.config.symbol}" not found. Available: ${available}`,
			);
		}
		this.marketId = market.marketId;
		this.marketSymbol = market.symbol;

		const binanceSymbol = deriveBinanceSymbol(market.symbol);
		this.logConfig(binanceSymbol);

		// Initialize strategy components
		const fairPriceConfig: FairPriceConfig = {
			windowMs: this.config.fairPriceWindowMs,
			minSamples: this.config.warmupSeconds,
		};
		const positionConfig: PositionConfig = {
			closeThresholdUsd: this.config.closeThresholdUsd,
			syncIntervalMs: this.config.positionSyncIntervalMs,
			inventorySkewEnabled: this.config.inventorySkewEnabled,
			maxPositionUsd: this.config.maxPositionUsd,
		};

		this.fairPriceCalc = new FairPriceCalculator(fairPriceConfig);
		this.positionTracker = new PositionTracker(positionConfig);
		this.quoter = new Quoter(
			market.priceDecimals,
			market.sizeDecimals,
			this.config.takeProfitBps,
			this.config.orderSizeUsd,
		);

		// Initialize volatility tracker
		if (this.config.volatilityEnabled) {
			this.volatilityTracker = new VolatilityTracker({
				windowMs: this.config.volatilityWindowMs,
				sampleIntervalMs: this.config.volatilitySampleIntervalMs,
				volatilityMultiplier: this.config.volatilityMultiplier,
			});
		}

		// Initialize PnL tracker (process restart resets PnL to zero -- circuit breaker is resettable)
		if (this.config.pnlTrackingEnabled) {
			this.pnlTracker = new PnlTracker();
		}

		// Initialize streams
		this.accountStream = new AccountStream(nord, accountId);
		this.orderbookStream = new ZoOrderbookStream(nord, this.marketSymbol);
		this.binanceFeed = new BinancePriceFeed(binanceSymbol);

		this.isRunning = true;

		// Initialize feed state manager for stale price protection and circuit breaker halt support
		if (this.config.stalePriceEnabled || this.config.pnlTrackingEnabled) {
			const callbacks: FeedStateCallbacks = {
				onStale: () => {
					log.stale("STALE", "Cancelling all orders");
					this.cancelOrdersAsync();
				},
				onRecovery: () => {
					log.info("Feed recovered - resuming quoting");
				},
				// HALT POSITION CLOSE
				// When the bot halts (circuit breaker or repeated stale), we attempt to
				// flatten any open position via a market IOC order before entering the
				// halted warning loop. This prevents unmanaged exposure while halted.
				// If the close order fails, we log the error but still proceed to HALTED
				// state -- the bot must never get stuck trying to close.
				onHalted: (reason) => {
					log.halted(reason);
					this.cancelOrdersAsync();

					// Attempt to flatten open position
					void (async () => {
						try {
							const posSize =
								this.positionTracker?.getBaseSize() ?? 0;
							if (Math.abs(posSize) > 0.00001) {
								const closeSide: "bid" | "ask" =
									posSize > 0 ? "ask" : "bid";
								const closeSize = new Decimal(
									Math.abs(posSize),
								);
								const aggressivePrice =
									closeSide === "ask"
										? new Decimal("0.01")
										: new Decimal("999999");
								log.info(
									`HALTED: closing open position [${closeSide}] [${closeSize}] @ market`,
								);
								await placeMarketOrder(
									this.requireClient().user,
									this.marketId,
									closeSide,
									closeSize,
									aggressivePrice,
								);
							}
						} catch (err) {
							log.error(
								"HALTED: failed to close position, proceeding anyway:",
								err,
							);
						}
					})();

					// Start 30s warning interval
					if (this.haltedWarningInterval) {
						clearInterval(this.haltedWarningInterval);
					}
					this.haltedWarningInterval = setInterval(() => {
						log.halted(reason);
					}, 30_000);
				},
			};
			this.feedState = new FeedStateManager(
				{
					staleThresholdMs: this.config.staleThresholdMs,
					recoveryPriceCount: this.config.recoveryPriceCount,
					stalePriceEnabled: this.config.stalePriceEnabled,
					haltStaleCount: this.config.haltStaleCount,
					haltWindowMs: this.config.haltWindowMs,
				},
				callbacks,
			);
		}
	}

	private setupEventHandlers(): void {
		const { user, accountId } = this.requireClient();

		// Account stream - fill events
		this.accountStream?.syncOrders(user, accountId);
		this.accountStream?.setOnFill((fill: FillEvent) => {
			log.fill(fill.side === "bid" ? "buy" : "sell", fill.price, fill.size);
			this.positionTracker?.applyFill(fill.side, fill.size, fill.price);
			this.pnlTracker?.applyFill(fill.side, fill.size, fill.price);
			this.checkCircuitBreaker();
			// Cancel all orders when entering close mode
			if (this.positionTracker?.isCloseMode(fill.price)) {
				this.cancelOrdersAsync();
			}
		});

		// Price feeds
		if (this.binanceFeed) {
			this.binanceFeed.onPrice = (price) => this.handleBinancePrice(price);
		}
		if (this.orderbookStream) {
			this.orderbookStream.onPrice = (price) => this.handleZoPrice(price);
		}

		// Start connections
		this.accountStream?.connect();
		this.orderbookStream?.connect();
		this.binanceFeed?.connect();

		// Enable fill processing after initial connect (suppressed during replay)
		// Small delay ensures WebSocket replay messages are processed before we start counting
		setTimeout(() => {
			this.accountStream?.setSuppressFills(false);
			log.info("Fill processing enabled (replay window closed)");
		}, 2000);
	}

	private handleBinancePrice(binancePrice: MidPrice): void {
		// Always feed timing to state manager
		this.feedState?.onPrice();
		this.volatilityTracker?.onPrice(binancePrice.mid);

		const zoPrice = this.orderbookStream?.getMidPrice();
		if (
			zoPrice &&
			Math.abs(binancePrice.timestamp - zoPrice.timestamp) < 1000
		) {
			this.fairPriceCalc?.addSample(zoPrice.mid, binancePrice.mid);
		}

		const fairPrice = this.fairPriceCalc?.getFairPrice(binancePrice.mid);

		// If state machine is active, use it as the gate
		if (this.feedState) {
			if (!fairPrice) {
				if (this.feedState.getState() === "WARMING_UP") {
					this.logWarmupProgress(binancePrice);
				}
				return;
			}
			// Promote to QUOTING on first valid fair price
			if (this.feedState.getState() === "WARMING_UP") {
				this.feedState.promoteToQuoting();
			}
			if (!this.feedState.canQuote()) {
				return;
			}
		} else {
			// Original behavior when stalePriceEnabled=false
			if (!this.isRunning) return;
			if (!fairPrice) {
				this.logWarmupProgress(binancePrice);
				return;
			}
		}

		// Log ready on first valid fair price
		if (this.lastLoggedSampleCount < this.config.warmupSeconds) {
			this.lastLoggedSampleCount = this.config.warmupSeconds;
			log.info(`Ready! Fair price: $${fairPrice.toFixed(2)}`);
		}

		this.throttledUpdate?.(fairPrice);
	}

	private handleZoPrice(zoPrice: MidPrice): void {
		const binancePrice = this.binanceFeed?.getMidPrice();
		if (
			binancePrice &&
			Math.abs(zoPrice.timestamp - binancePrice.timestamp) < 1000
		) {
			this.fairPriceCalc?.addSample(zoPrice.mid, binancePrice.mid);
		}
	}

	private logWarmupProgress(binancePrice: MidPrice): void {
		const state = this.fairPriceCalc?.getState();
		if (!state || state.samples === this.lastLoggedSampleCount) return;

		this.lastLoggedSampleCount = state.samples;
		const zoPrice = this.orderbookStream?.getMidPrice();
		const offsetBps =
			state.offset !== null && binancePrice.mid > 0
				? ((state.offset / binancePrice.mid) * 10000).toFixed(1)
				: "--";
		log.info(
			`Warming up: ${state.samples}/${this.config.warmupSeconds} samples | Binance $${binancePrice.mid.toFixed(2)} | 01 $${zoPrice?.mid.toFixed(2) ?? "--"} | Offset ${offsetBps}bps`,
		);
	}

	private async syncInitialOrders(): Promise<void> {
		const { user, accountId } = this.requireClient();

		await user.fetchInfo();
		const existingOrders = (user.orders[accountId] ?? []) as ApiOrder[];
		const marketOrders = existingOrders.filter(
			(o) => o.marketId === this.marketId,
		);
		this.activeOrders = mapApiOrdersToCached(marketOrders);

		if (this.activeOrders.length > 0) {
			log.info(`Synced ${this.activeOrders.length} existing orders`);
		}

		// Start position sync
		this.positionTracker?.startSync(user, accountId, this.marketId);
	}

	private startIntervals(): void {
		const { user, accountId } = this.requireClient();

		// Status display
		this.statusInterval = setInterval(() => {
			this.logStatus();
		}, this.config.statusIntervalMs);

		// Order sync
		this.orderSyncInterval = setInterval(() => {
			this.syncOrders(user, accountId);
		}, this.config.orderSyncIntervalMs);

		// Stale price check (500ms interval for 2s threshold -- 4x Nyquist)
		if (this.feedState) {
			this.staleCheckInterval = setInterval(() => {
				this.feedState?.checkStale();
			}, 500);
		}
	}

	private registerShutdownHandlers(): void {
		const shutdown = () => this.shutdown();
		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);
	}

	private async shutdown(): Promise<void> {
		log.shutdown();
		this.isRunning = false;
		this.throttledUpdate?.cancel();
		this.positionTracker?.stopSync();

		if (this.staleCheckInterval) {
			clearInterval(this.staleCheckInterval);
			this.staleCheckInterval = null;
		}
		if (this.haltedWarningInterval) {
			clearInterval(this.haltedWarningInterval);
			this.haltedWarningInterval = null;
		}

		if (this.statusInterval) {
			clearInterval(this.statusInterval);
			this.statusInterval = null;
		}
		if (this.orderSyncInterval) {
			clearInterval(this.orderSyncInterval);
			this.orderSyncInterval = null;
		}

		this.binanceFeed?.close();
		this.orderbookStream?.close();
		this.accountStream?.close();

		try {
			if (this.activeOrders.length > 0 && this.client) {
				await cancelOrders(this.client.user, this.activeOrders);
				log.info(`Cancelled ${this.activeOrders.length} orders. Goodbye!`);
				this.activeOrders = [];
			} else {
				log.info("No active orders. Goodbye!");
			}
		} catch (err) {
			log.error("Shutdown error:", err);
		}

		process.exit(0);
	}

	private async waitForever(): Promise<void> {
		await new Promise(() => {});
	}

	private async executeUpdate(fairPrice: number): Promise<void> {
		if (this.isUpdating) return;
		this.isUpdating = true;

		try {
			if (!this.positionTracker || !this.quoter || !this.client) {
				return;
			}

			// Compute effective spread
			const effectiveSpreadBps = this.volatilityTracker
				? this.volatilityTracker.getEffectiveSpreadBps(this.config.spreadBps)
				: this.config.spreadBps;

			// Compute inventory skew
			const positionState = this.positionTracker.getPositionState(fairPrice);
			const skewResult = this.config.inventorySkewEnabled
				? calculateInventorySkew(
						positionState.sizeUsd,
						this.config.maxPositionUsd,
						effectiveSpreadBps,
					)
				: { skewBps: 0, pauseIncreasing: false };

			const quotingCtx = this.positionTracker.getQuotingContext(
				fairPrice,
				effectiveSpreadBps,
				positionState.isCloseMode ? 0 : skewResult.skewBps,
				skewResult.pauseIncreasing,
			);

			if (positionState.sizeBase !== 0) {
				log.position(
					positionState.sizeBase,
					positionState.sizeUsd,
					positionState.isLong,
					positionState.isCloseMode,
				);
			}

			const bbo = this.orderbookStream?.getBBO() ?? null;
			const quotes = this.quoter.getQuotes(quotingCtx, bbo);

			if (quotes.length === 0) {
				log.warn("No quotes generated (order size too small)");
				return;
			}

			const bid = quotes.find((q) => q.side === "bid");
			const ask = quotes.find((q) => q.side === "ask");
			const isClose = positionState.isCloseMode;
			const spreadBps = isClose
				? this.config.takeProfitBps
				: effectiveSpreadBps;
			log.quote(
				bid?.price.toNumber() ?? null,
				ask?.price.toNumber() ?? null,
				fairPrice,
				spreadBps,
				isClose ? "close" : "normal",
			);

			const newOrders = await updateQuotes(
				this.client.user,
				this.marketId,
				this.activeOrders,
				quotes,
			);
			this.activeOrders = newOrders;

			this.checkCircuitBreaker();
		} catch (err) {
			log.error("Update error:", err);
			this.activeOrders = [];
		} finally {
			this.isUpdating = false;
		}
	}

	private checkCircuitBreaker(): void {
		if (!this.pnlTracker) return;
		const binanceMid = this.binanceFeed?.getMidPrice()?.mid;
		if (!binanceMid) return;
		const fairPrice = this.fairPriceCalc?.getFairPrice(binanceMid);
		if (!fairPrice) return;

		const totalPnl = this.pnlTracker.getTotalPnl(fairPrice);
		if (totalPnl < -this.config.maxDailyLossUsd) {
			const snapshot = this.pnlTracker.getSnapshot(fairPrice);
			log.circuitBreaker(
				snapshot.totalPnl,
				snapshot.realizedPnl,
				snapshot.unrealizedPnl,
				snapshot.positionSize,
				snapshot.avgCostPrice,
				this.config.maxDailyLossUsd,
			);
			this.feedState?.halt('circuit_breaker');
			// Fallback if feedState is still null (defense-in-depth)
			if (!this.feedState) {
				this.cancelOrdersAsync();
				this.isRunning = false;
			}
		}
	}

	private logConfig(binanceSymbol: string): void {
		const cfg: Record<string, unknown> = {
			Market: this.marketSymbol,
			Binance: binanceSymbol,
			Spread: `${this.config.spreadBps} bps`,
			"Take Profit": `${this.config.takeProfitBps} bps`,
			"Order Size": `$${this.config.orderSizeUsd}`,
			"Close Mode": `>=$${this.config.closeThresholdUsd}`,
		};
		if (this.config.stalePriceEnabled) {
			cfg["Stale Detection"] = `${this.config.staleThresholdMs}ms threshold`;
			cfg["Recovery"] = `${this.config.recoveryPriceCount} prices`;
			cfg["Halt"] = `${this.config.haltStaleCount} stale events in ${this.config.haltWindowMs / 60000}m`;
		}
		if (this.config.volatilityEnabled) {
			cfg["Volatility"] =
				`${this.config.volatilityMultiplier}x, ${this.config.volatilityWindowMs / 60000}m window`;
		}
		if (this.config.inventorySkewEnabled) {
			cfg["Inventory Skew"] = `max $${this.config.maxPositionUsd}`;
		}
		if (this.config.pnlTrackingEnabled) {
			cfg["Loss Limit"] = `-$${this.config.maxDailyLossUsd}`;
		}
		log.config(cfg);
	}

	private cancelOrdersAsync(): void {
		if (this.activeOrders.length === 0 || !this.client) return;
		const orders = this.activeOrders;
		cancelOrders(this.client.user, orders)
			.then(() => {
				this.activeOrders = [];
			})
			.catch((err) => {
				log.error("Failed to cancel orders:", err);
				this.activeOrders = [];
			});
	}

	private syncOrders(user: NordUser, accountId: number): void {
		user
			.fetchInfo()
			.then(() => {
				const apiOrders = (user.orders[accountId] ?? []) as ApiOrder[];
				const marketOrders = apiOrders.filter(
					(o) => o.marketId === this.marketId,
				);
				this.activeOrders = mapApiOrdersToCached(marketOrders);
			})
			.catch((err) => {
				log.error("Order sync error:", err);
			});
	}

	private logStatus(): void {
		if (!this.isRunning) return;

		const pos = this.positionTracker?.getBaseSize() ?? 0;
		const bids = this.activeOrders.filter((o) => o.side === "bid");
		const asks = this.activeOrders.filter((o) => o.side === "ask");

		const formatOrder = (o: CachedOrder) =>
			`$${o.price.toFixed(2)}x${o.size.toString()}`;

		const bidStr = bids.map(formatOrder).join(",") || "-";
		const askStr = asks.map(formatOrder).join(",") || "-";

		const staleInfo = this.feedState?.getStaleInfo();
		const staleStr = staleInfo
			? ` | stale: ${staleInfo.count}/${staleInfo.max} in ${staleInfo.windowMs / 60000}m`
			: "";
		const feedStateStr = this.feedState
			? ` | feed: ${this.feedState.getState()}`
			: "";

		log.info(
			`STATUS: pos=${pos.toFixed(5)} | bid=[${bidStr}] | ask=[${askStr}]${feedStateStr}${staleStr}`,
		);

		// Volatility and skew status line
		const volBps = this.volatilityTracker?.getVolatilityBps();
		const effSpread =
			this.volatilityTracker?.getEffectiveSpreadBps(this.config.spreadBps) ??
			this.config.spreadBps;
		const volStr = volBps != null ? `${volBps.toFixed(1)}bps` : "warmup";
		const spreadSource = effSpread > this.config.spreadBps ? "vol" : "config";
		const binanceMid = this.binanceFeed?.getMidPrice()?.mid ?? 0;
		const posUsd = pos * (this.fairPriceCalc?.getFairPrice(binanceMid) ?? 0);
		const skewInfo = this.config.inventorySkewEnabled
			? (() => {
					const skew = calculateInventorySkew(
						posUsd,
						this.config.maxPositionUsd,
						effSpread,
					);
					const pctStr =
						this.config.maxPositionUsd > 0
							? `${((Math.abs(posUsd) / this.config.maxPositionUsd) * 100).toFixed(0)}%`
							: "0%";
					const dirStr =
						posUsd > 0 ? "long" : posUsd < 0 ? "short" : "flat";
					return ` | skew: ${skew.skewBps.toFixed(1)}bps (${dirStr} ${pctStr})`;
				})()
			: "";

		log.info(
			`VOL: ${volStr} | spread: ${effSpread.toFixed(1)}bps (${spreadSource})${skewInfo}`,
		);

		if (this.pnlTracker) {
			const fp = this.fairPriceCalc?.getFairPrice(binanceMid);
			if (fp) {
				const snap = this.pnlTracker.getSnapshot(fp);
				log.info(
					`PNL: total=$${snap.totalPnl.toFixed(2)} | realized=$${snap.realizedPnl.toFixed(2)} | unrealized=$${snap.unrealizedPnl.toFixed(2)} | limit=-$${this.config.maxDailyLossUsd}`,
				);
			}
		}
	}
}
