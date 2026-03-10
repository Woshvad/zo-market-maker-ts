// Telegram notification utility for bot alerts

import { log } from "./logger.js";

export class TelegramNotifier {
	private readonly apiUrl: string;
	private readonly chatId: string;
	private readonly botLabel: string;

	constructor(opts: {
		botToken: string;
		chatId: string;
		botLabel: string;
	}) {
		this.apiUrl = `https://api.telegram.org/bot${opts.botToken}/sendMessage`;
		this.chatId = opts.chatId;
		this.botLabel = opts.botLabel;
	}

	async sendMessage(text: string): Promise<void> {
		try {
			const body = JSON.stringify({
				chat_id: this.chatId,
				text: `[${this.botLabel}] ${text}`,
				parse_mode: "HTML",
			});
			const resp = await fetch(this.apiUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
			});
			if (!resp.ok) {
				log.error(`Telegram send failed: ${resp.status} ${resp.statusText}`);
			}
		} catch (err) {
			log.error("Telegram send error:", err);
		}
	}
}

/**
 * Create a TelegramNotifier from environment variables.
 * Returns null (silent no-op) if TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.
 */
export function createTelegramNotifier(
	botLabel: string,
): TelegramNotifier | null {
	const botToken = process.env.TELEGRAM_BOT_TOKEN;
	const chatId = process.env.TELEGRAM_CHAT_ID;

	if (!botToken || !chatId) {
		log.warn("Telegram notifications disabled (missing env vars)");
		return null;
	}

	return new TelegramNotifier({ botToken, chatId, botLabel });
}
