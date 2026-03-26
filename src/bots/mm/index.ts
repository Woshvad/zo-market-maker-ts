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
import {
	createTelegramNotifier,
	type TelegramNotifier,
} from "../../utils/telegram.js";
import { AdverseSelectionTracker } from "./adverse-selection.js";
import type { MarketMakerConfig } from "./config.js";
import { DrawdownCooldown } from "./drawdown-cooldown.js";
import { type FeedStateCallbacks, FeedStateManager } from "./feed-state.js";
import { calculateInventorySkew } from "./inventory-skew.js";
import { PnlTracker } from "./pnl-tracker.js";
import { type PositionConfig, PositionTracker } from "./position.js";
import { Quoter } from "./quoter.js";
import { HedgeManager } from "./hedge-manager.js";
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
	private sizeDecimals = 0;
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
	private adverseSelectionTracker: AdverseSelectionTracker | null = null;
	private drawdownCooldown: DrawdownCooldown | null = null;
	private lastCycleRealizedPnl = 0; // realized PnL at start of current cycle
	private staleCheckInterval: ReturnType<typeof setInterval> | null = null;
	private forceCloseInterval: ReturnType<typeof setInterval> | null = null;
	private telegram: TelegramNotifier | null = null;
	private hedgeManager: HedgeManager | null = null;

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
		await this.telegram?.sendMessage("Bot started");

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
		const { nord, user, accountId } = this.client;

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
		this.sizeDecimals = market.sizeDecimals;
		this.telegram = createTelegramNotifier(this.marketSymbol);

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

		// Initialize adverse selection tracker
		if (this.config.adverseSelectionEnabled) {
			this.adverseSelectionTracker = new AdverseSelectionTracker({
				windowSize: this.config.adverseSelectionWindowSize,
				imbalanceThreshold: this.config.adverseSelectionThreshold,
				spreadMultiplier: this.config.adverseSelectionMultiplier,
			});
		}

		// Initialize drawdown cooldown
		if (this.config.drawdownCooldownEnabled) {
			this.drawdownCooldown = new DrawdownCooldown({
				consecutiveLossLimit: this.config.drawdownConsecutiveLossLimit,
				cooldownSizeMultiplier: this.config.drawdownCooldownSizeMultiplier,
			});
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

					// Hard deadline: exit no matter what after 5s
					setTimeout(() => {
						log.error("HALTED: exit timeout reached, forcing exit");
						process.exit(1);
					}, 5000).unref();

					// Attempt to flatten open position, then notify and exit
					void (async () => {
						try {
							const posSize = this.positionTracker?.getBaseSize() ?? 0;
							const rawSize = Math.abs(posSize);
							const factor = 10 ** this.sizeDecimals;
							const truncatedSize = Math.floor(rawSize * factor) / factor;
							if (truncatedSize > 0) {
								const closeSide: "bid" | "ask" = posSize > 0 ? "ask" : "bid";
								const closeSize = new Decimal(truncatedSize.toFixed(this.sizeDecimals));
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

						await this.telegram?.sendMessage(
							`HALTED: ${reason}\nPosition close attempted.`,
						);
						process.exit(1);
					})();
				},
				onDivergenceWarning: () => {
					log.divergenceWarning("within grace period, not counting toward halt");
				},
			};
			this.feedState = new FeedStateManager(
				{
					staleThresholdMs: this.config.staleThresholdMs,
					recoveryPriceCount: this.config.recoveryPriceCount,
					stalePriceEnabled: this.config.stalePriceEnabled,
					haltStaleCount: this.config.haltStaleCount,
					haltWindowMs: this.config.haltWindowMs,
					divergenceHaltCount: this.config.divergenceHaltCount,
					divergenceHaltWindowMs: this.config.divergenceHaltWindowMs,
				},
				callbacks,
			);
		}

		// Initialize hedge manager (opt-in)
		if (this.config.hedgeEnabled) {
			const positionProvider = this.positionTracker;
			const fairPriceCalc = this.fairPriceCalc;
			const orderbookStream = this.orderbookStream;
			if (!positionProvider || !fairPriceCalc || !orderbookStream) {
				throw new Error("Hedge manager requires position tracker, fair price calculator, and orderbook stream");
			}
			this.hedgeManager = new HedgeManager(
				{
					hedgeThresholdUsd: this.config.hedgeThresholdUsd,
					hedgeRatio: this.config.hedgeRatio,
					hedgeSyncIntervalMs: this.config.hedgeSyncIntervalMs,
					marketId: this.marketId,
					sizeDecimals: market.sizeDecimals,
				},
				user,
				positionProvider,
				{
					getFairPrice: () => {
						const binanceMid = this.binanceFeed?.getMidPrice()?.mid;
						if (!binanceMid) return null;
						return fairPriceCalc.getFairPrice(binanceMid) ?? null;
					},
				},
				{
					getBestBid: () => orderbookStream.getBBO()?.bestBid ?? null,
					getBestAsk: () => orderbookStream.getBBO()?.bestAsk ?? null,
				},
			);
		}
	}

	private setupEventHandlers(): void {
		const { user, accountId } = this.requireClient();

		// Account stream - fill events
		this.accountStream?.syncOrders(user, accountId);
		this.accountStream?.setOnFill((fill: FillEvent) => {
			log.fill(fill.side === "bid" ? "buy" : "sell", fill.price, fill.size);

			const wasFlat = Math.abs(this.positionTracker?.getBaseSize() ?? 0) < 0.00001;

			this.positionTracker?.applyFill(fill.side, fill.size, fill.price);
			this.pnlTracker?.applyFill(fill.side, fill.size, fill.price);

			// Track fill side for adverse selection
			this.adverseSelectionTracker?.recordFill(fill.side);

			const posAfterFill = this.positionTracker?.getBaseSize() ?? 0;
			const isFlatNow = Math.abs(posAfterFill) < 0.00001;

			if (isFlatNow) {
				this.forceCloseGaveUp = false;
				this.forceCloseFailCount = 0;
				this.forceClosePausedUntil = 0;

				// Drawdown cycle detection: position returned to flat = cycle complete
				if (!wasFlat && this.drawdownCooldown && this.pnlTracker) {
					const currentRealized = this.pnlTracker.getRealizedPnl();
					const cyclePnl = currentRealized - this.lastCycleRealizedPnl;
					this.drawdownCooldown.onCycleComplete(cyclePnl);
					this.lastCycleRealizedPnl = currentRealized;
					const ddState = this.drawdownCooldown.getState();
					log.info(
						`CYCLE: pnl=$${cyclePnl.toFixed(2)} | streak=${ddState.consecutiveLosses}/${this.config.drawdownConsecutiveLossLimit} | cooldown=${ddState.inCooldown ? "YES" : "no"} | size_mult=${ddState.sizeMultiplier}`,
					);
				}
			} else if (wasFlat && !isFlatNow) {
				// Starting a new cycle — snapshot realized PnL baseline
				if (this.pnlTracker) {
					this.lastCycleRealizedPnl = this.pnlTracker.getRealizedPnl();
				}
			}

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

		// Force-close check runs on its own 1s timer so position timeout
		// fires even when no price ticks are arriving (stale feed).
		let forceCloseTickCount = 0;
		this.forceCloseInterval = setInterval(() => {
			const binanceMid = this.binanceFeed?.getMidPrice()?.mid;
			if (!binanceMid) return;
			const fairPrice = this.fairPriceCalc?.getFairPrice(binanceMid);
			if (!fairPrice) return;

			// Log force-close state every 10s when holding a position
			forceCloseTickCount++;
			const ageMs = this.positionTracker?.getPositionAgeMs();
			const posSize = this.positionTracker?.getBaseSize() ?? 0;
			if (forceCloseTickCount % 10 === 0 && Math.abs(posSize) > 0.00001) {
				log.debug(
					`force-close tick: pos=${posSize.toFixed(6)}, age=${ageMs !== null && ageMs !== undefined ? (ageMs / 1000).toFixed(1) + "s" : "null"}, timeout=${this.config.positionTimeoutMs / 1000}s`,
				);
			}

			void this.checkForceClose(fairPrice);
		}, 1000);

		// Start hedge manager (runs its own interval loop)
		this.hedgeManager?.start();
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

		if (this.forceCloseInterval) {
			clearInterval(this.forceCloseInterval);
			this.forceCloseInterval = null;
		}

		if (this.statusInterval) {
			clearInterval(this.statusInterval);
			this.statusInterval = null;
		}
		if (this.orderSyncInterval) {
			clearInterval(this.orderSyncInterval);
			this.orderSyncInterval = null;
		}

		// Close hedge position before disconnecting streams
		if (this.hedgeManager) {
			this.hedgeManager.stop();
			try {
				await this.hedgeManager.closeHedge();
			} catch (err) {
				log.error("Hedge shutdown error:", err);
			}
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

		await this.telegram?.sendMessage("Bot shutting down (manual stop)");
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

			// Check force-close before quoting (stop-loss or timeout)
			const forceClosed = await this.checkForceClose(fairPrice);
			if (forceClosed) return;

			// Compute effective spread: volatility → adverse selection multiplier
			let effectiveSpreadBps = this.volatilityTracker
				? this.volatilityTracker.getEffectiveSpreadBps(this.config.spreadBps)
				: this.config.spreadBps;

			// Apply adverse selection spread widening
			if (this.adverseSelectionTracker) {
				const asMultiplier = this.adverseSelectionTracker.getSpreadMultiplier();
				effectiveSpreadBps *= asMultiplier;
			}

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
			const quotes = this.quoter.getQuotes(
				quotingCtx,
				bbo,
				this.drawdownCooldown?.getSizeMultiplier(),
			);

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

			const result = await updateQuotes(
				this.client.user,
				this.marketId,
				this.activeOrders,
				quotes,
			);
			this.activeOrders = result.orders;

			// State divergence detected — report to sliding window tracker
			if (result.diverged) {
				log.divergence("atomic operation failed after retries — local state may not match server");
				this.feedState?.onDivergence();
				if (!this.feedState) {
					this.cancelOrdersAsync();
					this.isRunning = false;
				}
				return;
			}

			this.checkCircuitBreaker();
		} catch (err) {
			log.error("Update error:", err);
			this.activeOrders = [];
		} finally {
			this.isUpdating = false;
		}
	}

	/**
	 * Force-close position if per-trade stop-loss or position timeout is breached.
	 * Cancels all orders and fires an IOC reduce-only market order.
	 * Returns true if a force-close was triggered (caller should skip normal quoting).
	 */
	private isForceClosing = false;
	private forceCloseFailCount = 0;
	private forceClosePausedUntil = 0;
	private forceCloseGaveUp = false;
	private async checkForceClose(fairPrice: number): Promise<boolean> {
		if (this.isForceClosing) return false;
		if (Date.now() < this.forceClosePausedUntil) return false;
		if (this.forceCloseGaveUp) return false;
		if (!this.positionTracker || !this.pnlTracker || !this.client) return false;

		const posSize = this.positionTracker.getBaseSize();
		if (Math.abs(posSize) < 0.00001) return false;

		const unrealizedPnl = this.pnlTracker.getUnrealizedPnl(fairPrice);
		const positionAgeMs = this.positionTracker.getPositionAgeMs();

		const stopLossBreached = unrealizedPnl < -this.config.stopLossUsd;
		const timeoutBreached =
			positionAgeMs !== null && positionAgeMs > this.config.positionTimeoutMs;

		if (!stopLossBreached && !timeoutBreached) return false;

		const reason = stopLossBreached
			? `stop-loss ($${unrealizedPnl.toFixed(2)} < -$${this.config.stopLossUsd})`
			: `timeout (${((positionAgeMs ?? 0) / 1000).toFixed(1)}s > ${this.config.positionTimeoutMs / 1000}s)`;

		log.warn(`FORCE CLOSE: ${reason}`);
		this.isForceClosing = true;

		// Cancel all orders first
		this.cancelOrdersAsync();

		// Fire IOC reduce-only market order
		try {
			const rawSize = Math.abs(posSize);
			const factor = 10 ** this.sizeDecimals;
			const truncatedSize = Math.floor(rawSize * factor) / factor;
			if (truncatedSize === 0) return false;
			const closeSide: "bid" | "ask" = posSize > 0 ? "ask" : "bid";
			const closeSize = new Decimal(truncatedSize.toFixed(this.sizeDecimals));
			const aggressivePrice =
				closeSide === "ask"
					? new Decimal("0.01")
					: new Decimal("999999");

			await placeMarketOrder(
				this.client.user,
				this.marketId,
				closeSide,
				closeSize,
				aggressivePrice,
			);
			this.forceCloseFailCount = 0;
			this.forceClosePausedUntil = 0;
		} catch (err) {
			this.forceCloseFailCount++;
			const backoffMs = Math.min(1000 * 2 ** this.forceCloseFailCount, 60000);
			this.forceClosePausedUntil = Date.now() + backoffMs;
			log.error(`Force close failed (attempt ${this.forceCloseFailCount}, next retry in ${backoffMs / 1000}s):`, err);
			await this.telegram?.sendMessage(`Force close FAILED (attempt ${this.forceCloseFailCount}): ${err instanceof Error ? err.message : String(err)}`);
			if (this.forceCloseFailCount >= 5) {
				log.warn("Force close failed 5 times — falling back to close mode via regular quoting");
				this.forceCloseGaveUp = true;
				this.forceCloseFailCount = 0;
				this.forceClosePausedUntil = 0;
				this.isForceClosing = false;
				await this.telegram?.sendMessage("Force close gave up after 5 attempts. Position will be closed via regular quoting.");
				return false;
			}
		} finally {
			this.isForceClosing = false;
		}

		return true;
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
			this.feedState?.halt("circuit_breaker");
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
			cfg["Halt"] =
				`${this.config.haltStaleCount} stale events in ${this.config.haltWindowMs / 60000}m`;
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
		cfg["Stop Loss"] = `$${this.config.stopLossUsd}/position`;
		cfg["Position Timeout"] = `${this.config.positionTimeoutMs / 1000}s`;
		if (this.config.adverseSelectionEnabled) {
			cfg["Adverse Selection"] =
				`window=${this.config.adverseSelectionWindowSize}, threshold=${(this.config.adverseSelectionThreshold * 100).toFixed(0)}%, multiplier=${this.config.adverseSelectionMultiplier}x`;
		}
		if (this.config.drawdownCooldownEnabled) {
			cfg["Drawdown Cooldown"] =
				`${this.config.drawdownConsecutiveLossLimit} losses → ${this.config.drawdownCooldownSizeMultiplier}x size`;
		}
		if (this.config.hedgeEnabled) {
			cfg["Hedge"] = `threshold=$${this.config.hedgeThresholdUsd}, ratio=${this.config.hedgeRatio}, interval=${this.config.hedgeSyncIntervalMs}ms`;
		}
		log.config(cfg);
	}

	private cancelOrdersAsync(): void {
		if (this.activeOrders.length === 0 || !this.client) return;
		const orders = this.activeOrders;
		cancelOrders(this.client.user, orders)
			.then((result) => {
				this.activeOrders = [];
				if (result.diverged) {
					log.divergence("cancel may have failed — orders could still be live on server");
					this.feedState?.onDivergence();
				}
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

		const ageMs = this.positionTracker?.getPositionAgeMs() ?? null;
		const ageStr = ageMs !== null ? ` | age: ${(ageMs / 1000).toFixed(1)}s` : "";

		log.info(
			`STATUS: pos=${pos.toFixed(5)} | bid=[${bidStr}] | ask=[${askStr}]${ageStr}${feedStateStr}${staleStr}`,
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
					const dirStr = posUsd > 0 ? "long" : posUsd < 0 ? "short" : "flat";
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

		// Adverse selection status
		if (this.adverseSelectionTracker) {
			const as = this.adverseSelectionTracker.getState();
			const domStr = as.dominantSide ? ` dominant=${as.dominantSide}` : "";
			log.info(
				`ADVERSE: bids=${as.bidFills} asks=${as.askFills} total=${as.totalFills} | ratio=bid:${(as.bidRatio * 100).toFixed(0)}%/ask:${(as.askRatio * 100).toFixed(0)}% | imbalanced=${as.isImbalanced ? "YES" : "no"}${domStr} | spread_mult=${as.spreadMultiplier}x`,
			);
		}

		// Drawdown cooldown status
		if (this.drawdownCooldown) {
			const dd = this.drawdownCooldown.getState();
			log.info(
				`DRAWDOWN: streak=${dd.consecutiveLosses}/${this.config.drawdownConsecutiveLossLimit} | cooldown=${dd.inCooldown ? "YES" : "no"} | size_mult=${dd.sizeMultiplier} | cycles=${dd.totalCycles} losses=${dd.totalLosses}`,
			);
		}
	}
}
