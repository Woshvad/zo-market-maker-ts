// CLI entry point for market maker bot

import "dotenv/config";
import { DEFAULT_CONFIG } from "../bots/mm/config.js";
import { MarketMaker } from "../bots/mm/index.js";
import { log } from "../utils/logger.js";
import { createTelegramNotifier } from "../utils/telegram.js";

// Global crash handlers - send Telegram alert before dying
function registerCrashHandlers(symbol: string): void {
	const telegram = createTelegramNotifier(symbol);

	process.on("uncaughtException", (err) => {
		log.error("Uncaught exception:", err);
		const msg = `CRASH (uncaughtException): ${err.message}`;
		if (telegram) {
			telegram.sendMessage(msg).finally(() => process.exit(1));
			setTimeout(() => process.exit(1), 3000).unref();
		} else {
			process.exit(1);
		}
	});

	process.on("unhandledRejection", (reason) => {
		log.error("Unhandled rejection:", reason);
		const errMsg = reason instanceof Error ? reason.message : String(reason);
		const msg = `CRASH (unhandledRejection): ${errMsg}`;
		if (telegram) {
			telegram.sendMessage(msg).finally(() => process.exit(1));
			setTimeout(() => process.exit(1), 3000).unref();
		} else {
			process.exit(1);
		}
	});
}

function main(): void {
	const symbol = process.argv[2]?.toUpperCase();

	if (!symbol) {
		console.error("Usage: npm run bot -- <symbol>");
		console.error("Example: npm run bot -- BTC");
		process.exit(1);
	}

	const privateKey = process.env.PRIVATE_KEY;
	if (!privateKey) {
		console.error("Missing required environment variable: PRIVATE_KEY");
		process.exit(1);
	}

	registerCrashHandlers(symbol);

	const bot = new MarketMaker(
		{
			symbol,
			...DEFAULT_CONFIG,
		},
		privateKey,
	);

	bot.run().catch((err) => {
		log.error("Fatal error:", err);
		process.exit(1);
	});
}

main();
