import { YoutubeTranscriptBot } from "./bot.js";
import { MessengerClient } from "./messenger.js";

const WEBHOOK_PATH = "/telegram/webhook";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "youtube-video-transcript-bot"
      });
    }

    if (url.pathname === "/setup-webhook") {
      try {
        return await setupWebhook(request, env);
      } catch (error) {
        console.error(error);
        return jsonResponse(
          {
            ok: false,
            error: error?.message ?? "Unknown setup error",
            missing: {
              TELEGRAM_BOT_TOKEN: !env.TELEGRAM_BOT_TOKEN,
              WEBHOOK_SECRET: !env.WEBHOOK_SECRET,
              SETUP_SECRET: !env.SETUP_SECRET
            }
          },
          { status: 500 }
        );
      }
    }

    if (url.pathname !== WEBHOOK_PATH) {
      return new Response("Not found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const authError = validateWebhookRequest(request, env);

    if (authError) {
      return authError;
    }

    let update;

    try {
      update = await request.json();
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    const messenger = new MessengerClient(requiredEnv(env, "TELEGRAM_BOT_TOKEN"));
    const bot = new YoutubeTranscriptBot(messenger, {
      config: env
    });

    ctx.waitUntil(bot.handleUpdate(update).catch((error) => {
      console.error(error);
    }));

    return jsonResponse({ ok: true });
  }
};

async function setupWebhook(request, env) {
  if (!env.SETUP_SECRET) {
    return new Response("Webhook setup is disabled", { status: 404 });
  }

  const url = new URL(request.url);

  if (url.searchParams.get("secret") !== env.SETUP_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const webhookUrl = new URL(WEBHOOK_PATH, request.url).toString();
  const messenger = new MessengerClient(requiredEnv(env, "TELEGRAM_BOT_TOKEN"));
  const result = await messenger.setWebhook({
    url: webhookUrl,
    secretToken: env.WEBHOOK_SECRET
  });

  return jsonResponse({
    ok: true,
    webhookUrl,
    result
  });
}

function validateWebhookRequest(request, env) {
  if (!env.WEBHOOK_SECRET) {
    return null;
  }

  const incomingSecret = request.headers.get("x-telegram-bot-api-secret-token");

  if (incomingSecret !== env.WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}

function requiredEnv(env, key) {
  const value = env[key];

  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json;charset=utf-8",
      ...init.headers
    }
  });
}
