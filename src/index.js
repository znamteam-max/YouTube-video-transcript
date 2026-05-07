import { YoutubeTranscriptBot } from "./bot.js";
import { loadEnvFile } from "./env.js";
import { MessengerClient } from "./messenger.js";

loadEnvFile();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is required. Put it into .env or environment variables.");
  process.exit(1);
}

const messenger = new MessengerClient(token);
const bot = new YoutubeTranscriptBot(messenger);
let offset = 0;
let isShuttingDown = false;

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log("YouTube transcript Telegram bot is running.");

while (!isShuttingDown) {
  try {
    const updates = await messenger.getUpdates({
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
