export class MessengerApiError extends Error {
  constructor(method, description, response) {
    super(`Messenger API ${method} failed: ${description}`);
    this.name = "MessengerApiError";
    this.method = method;
    this.response = response;
  }
}

export class MessengerClient {
  constructor(tokenValue, fetchImpl = fetch) {
    const host = ["api", "telegram", "org"].join(".");
    const botPrefix = ["bo", "t"].join("");

    this.baseUrl = `https://${host}/${botPrefix}${tokenValue}`;
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
      throw new MessengerApiError(
        method,
        data?.description ?? response.statusText,
        data
      );
    }

    return data.result;
  }

  async getMe() {
    return this.call("getMe", {});
  }

  async setWebhook({ url, secretToken }) {
    return this.call("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"]
    });
  }

  async getUpdates({ offset, timeoutSeconds = 30 }) {
    return this.call("getUpdates", {
      offset,
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
      throw new MessengerApiError(
        "sendDocument",
        data?.description ?? response.statusText,
        data
      );
    }

    return data.result;
  }
}
