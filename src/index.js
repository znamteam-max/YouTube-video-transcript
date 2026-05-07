import { loadEnvFile } from "./env.js";
import { YoutubeTranscriptBot } from "./bot.js";

loadEnvFile();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is required. Put it into .env or environment variables.");
  process.exit(1);
}

const telegram = new TelegramClient(token);
const bot = new YoutubeTranscriptBot(telegram);
let offset = 0;
let isShuttingDown = false;

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log("YouTube transcript Telegram bot is running.");

while (!isShuttingDown) {
  try {
    const updates = await telegram.getUpdates({
      offset,
      timeoutSeconds: 30
    });

    for (const update of updates) {
      offset = update.update_id + 1;
      await bot.handleUpdate(update);
    }
  } catch (error) {
    console.error(error);
    await delay(3000);
  }
}

function shutdown(signal) {
  isShuttingDown = true;
  console.log(`Received ${signal}. Stopping after the current polling cycle.`);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class TelegramApiError extends Error {
  constructor(method, description, response) {
    super(`Telegram API ${method} failed: ${description}`);
    this.name = "TelegramApiError";
    this.method = method;
    this.response = response;
  }
}

class TelegramClient {
  constructor(tokenValue, fetchImpl = fetch) {
    this.baseUrl = `https://api.telegram.org/bot${tokenValue}`;
    this.fetch = fetchImpl;
  }

  async call(method, payload) {
    const response = await this.fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok) {
      throw new TelegramApiError(
        method,
        data?.description ?? response.statusText,
        data
      );
    }

    return data.result;
  }

  async getUpdates({ offset: nextOffset, timeoutSeconds = 30 }) {
    return this.call("getUpdates", {
      offset: nextOffset,
      timeout: timeoutSeconds,
      allowed_updates: ["message", "callback_query"]
    });
  }

  async sendMessage(chatId, text, options = {}) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...options
    });
  }

  async answerCallbackQuery(callbackQueryId, text) {
    return this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text
    });
  }

  async editMessageReplyMarkup(
    chatId,
    messageId,
    replyMarkup = { inline_keyboard: [] }
  ) {
    return this.call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup
    });
  }

  async sendDocument(chatId, { filename, content, caption }) {
    const form = new FormData();
    const blob = new Blob([content], {
      type: "text/plain;charset=utf-8"
    });

    form.append("chat_id", String(chatId));
    form.append("document", blob, filename);

    if (caption) {
      form.append("caption", caption);
    }

    const response = await this.fetch(`${this.baseUrl}/sendDocument`, {
      method: "POST",
      body: form
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok) {
      throw new TelegramApiError(
        "sendDocument",
        data?.description ?? response.statusText,
        data
      );
    }

    return data.result;
  }
}
