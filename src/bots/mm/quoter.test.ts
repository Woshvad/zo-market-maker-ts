import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { QuotingContext } from "./position.js";
import { Quoter } from "./quoter.js";

// Helper to create a QuotingContext with defaults
function makeCtx(overrides: Partial<QuotingContext> = {}): QuotingContext {
	return {
		fairPrice: 100,
		positionState: {
			sizeBase: 0,
			sizeUsd: 0,
			isLong: false,
			isCloseMode: false,
		},
		allowedSides: ["bid", "ask"],
		effectiveSpreadBps: 10,
		skewBps: 0,
		...overrides,
	};
}

describe("Quoter", () => {
	// priceDecimals=2, sizeDecimals=5, takeProfitBps=0.1, orderSizeUsd=1000
	const quoter = new Quoter(2, 5, 0.1, 1000);

	it("uses effectiveSpreadBps from context", () => {
		const ctx = makeCtx({ fairPrice: 100, effectiveSpreadBps: 20 });
		const quotes = quoter.getQuotes(ctx, null);

		const bid = quotes.find((q) => q.side === "bid");
		const ask = quotes.find((q) => q.side === "ask");

		// spread = 100 * 20 / 10000 = 0.20
		// bid = 100 - 0.20 = 99.80, ask = 100 + 0.20 = 100.20
		expect(bid?.price.toNumber()).toBe(99.8);
		expect(ask?.price.toNumber()).toBe(100.2);
	});

	it("applies positive skewBps - shifts quotes up", () => {
		const ctx = makeCtx({
			fairPrice: 100,
			effectiveSpreadBps: 10,
			skewBps: 5,
		});
		const quotes = quoter.getQuotes(ctx, null);

		const bid = quotes.find((q) => q.side === "bid");
		const ask = quotes.find((q) => q.side === "ask");

		// skewShift = 100 * 5 / 10000 = 0.05
		// effectiveFair = 100.05
		// spread = 100 * 10 / 10000 = 0.10
		// bid = 100.05 - 0.10 = 99.95, ask = 100.05 + 0.10 = 100.15
		expect(bid?.price.toNumber()).toBe(99.95);
		expect(ask?.price.toNumber()).toBe(100.15);
	});

	it("applies negative skewBps - shifts quotes down", () => {
		const ctx = makeCtx({
			fairPrice: 100,
			effectiveSpreadBps: 10,
			skewBps: -5,
		});
		const quotes = quoter.getQuotes(ctx, null);

		const bid = quotes.find((q) => q.side === "bid");
		const ask = quotes.find((q) => q.side === "ask");

		// skewShift = 100 * -5 / 10000 = -0.05
		// effectiveFair = 99.95
		// spread = 100 * 10 / 10000 = 0.10
		// bid = 99.95 - 0.10 = 99.85, ask = 99.95 + 0.10 = 100.05
		expect(bid?.price.toNumber()).toBe(99.85);
		expect(ask?.price.toNumber()).toBe(100.05);
	});

	it("both bid and ask shift symmetrically by skew", () => {
		const ctxNoSkew = makeCtx({
			fairPrice: 100,
			effectiveSpreadBps: 10,
			skewBps: 0,
		});
		const ctxWithSkew = makeCtx({
			fairPrice: 100,
			effectiveSpreadBps: 10,
			skewBps: 5,
		});

		const noSkew = quoter.getQuotes(ctxNoSkew, null);
		const withSkew = quoter.getQuotes(ctxWithSkew, null);

		const noBid = noSkew.find((q) => q.side === "bid")!.price.toNumber();
		const noAsk = noSkew.find((q) => q.side === "ask")!.price.toNumber();
		const skewBid = withSkew.find((q) => q.side === "bid")!.price.toNumber();
		const skewAsk = withSkew.find((q) => q.side === "ask")!.price.toNumber();

		// Both should shift by 0.05 (100 * 5 / 10000)
		const shift = 0.05;
		expect(skewBid - noBid).toBeCloseTo(shift, 10);
		expect(skewAsk - noAsk).toBeCloseTo(shift, 10);
	});

	it("in close mode, uses takeProfitBps and skew is zero", () => {
		const ctx = makeCtx({
			fairPrice: 100,
			effectiveSpreadBps: 10,
			skewBps: 0, // Caller ensures 0 in close mode
			positionState: {
				sizeBase: 0.5,
				sizeUsd: 50,
				isLong: true,
				isCloseMode: true,
			},
			allowedSides: ["ask"],
		});
		const quotes = quoter.getQuotes(ctx, null);

		// Only ask in close mode (long -> sell to close)
		expect(quotes.length).toBe(1);
		expect(quotes[0].side).toBe("ask");

		// takeProfitBps = 0.1 -> spread = 100 * 0.1 / 10000 = 0.001
		// ask = 100 + 0.001 = 100.01 (ceiled to tick)
		expect(quotes[0].price.toNumber()).toBe(100.01);
	});

	it("with skew=0, matches original fixed-spread behavior", () => {
		const ctx = makeCtx({
			fairPrice: 100,
			effectiveSpreadBps: 8,
			skewBps: 0,
		});
		const quotes = quoter.getQuotes(ctx, null);

		const bid = quotes.find((q) => q.side === "bid");
		const ask = quotes.find((q) => q.side === "ask");

		// spread = 100 * 8 / 10000 = 0.08
		expect(bid?.price.toNumber()).toBe(99.92);
		expect(ask?.price.toNumber()).toBe(100.08);
	});

	it("excludes side not in allowedSides", () => {
		const ctxBidOnly = makeCtx({
			fairPrice: 100,
			effectiveSpreadBps: 10,
			allowedSides: ["bid"],
		});
		const quotes = quoter.getQuotes(ctxBidOnly, null);

		expect(quotes.length).toBe(1);
		expect(quotes[0].side).toBe("bid");
	});
});
