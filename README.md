# YouTube Video Transcript Telegram Bot

Telegram bot that accepts a YouTube link and returns a full transcript from the video's available subtitles.

If a video has several subtitle tracks, the bot asks which language to use and marks the source:

- `manual` / uploaded subtitles;
- `auto` / YouTube auto-generated subtitles.

The project has two runtimes:

- local long polling: `src/index.js`;
- Cloudflare Workers webhook: `src/worker.js`.

## Cloudflare Workers Deploy

The Worker is stateless. Language-choice buttons contain only `videoId` and track index; when a user taps a button, the Worker fetches the caption list again. No KV/D1 database is required.

1. Push this repository to GitHub.
2. In Cloudflare, create a Worker connected to this GitHub repository.
3. Use the repository `wrangler.toml`:

```toml
name = "youtube-video-transcript-bot"
main = "src/worker.js"
compatibility_date = "2026-05-07"
workers_dev = true
```

4. Add Worker secrets / environment variables:

```env
TELEGRAM_BOT_TOKEN=123456789:your_bot_token
WEBHOOK_SECRET=long_random_secret_for_telegram_header
SETUP_SECRET=long_random_secret_for_one_time_setup_url
YOUTUBE_TRANSCRIPT_DEV_API_KEY=your_api_key
```

Optional:

```env
YOUTUBE_PO_TOKEN=
```

`YOUTUBE_TRANSCRIPT_DEV_API_KEY` is strongly recommended for Cloudflare Workers. YouTube often returns HTTP 429 to direct requests from data center IPs, including Workers. When this key is present, the bot skips direct YouTube scraping and asks `https://www.youtubetranscript.dev/api/v2/transcribe` for the best available caption track.

5. Deploy the Worker.
6. Open this URL once in your browser:

```text
https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/setup-webhook?secret=SETUP_SECRET_VALUE
```

The Worker will call Telegram `setWebhook` for:

```text
https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/telegram/webhook
```

After that, send `/start` to the bot in Telegram and then send a YouTube link.

## Local Run

Create `.env` from `.env.example`:

```env
TELEGRAM_BOT_TOKEN=123456789:your_bot_token
```

Run:

```bash
npm install
npm start
```

For Cloudflare local dev:

```bash
copy .dev.vars.example .dev.vars
npm run cf:dev
```

For direct Wrangler deploy:

```bash
npm run cf:deploy
```

## How It Works

1. Extracts the YouTube `videoId` from the message.
2. Reads the video's `captionTracks`.
3. Sends a language/source selector if several tracks exist.
4. Downloads the selected transcript.
5. Sends short transcripts as text and long transcripts as `.txt` files.

Important: YouTube does not provide a stable public transcript API for arbitrary videos. Some `timedtext` requests now return an empty response without a Proof-of-Origin token, so the bot supports optional `YOUTUBE_PO_TOKEN` and `YOUTUBE_TRANSCRIPT_DEV_API_KEY`.

## Checks

```bash
npm run check
```

Live YouTube smoke test:

```bash
npm run smoke:youtube -- M7lc1UVf-VE
```
