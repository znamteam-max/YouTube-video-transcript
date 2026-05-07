# YouTube Video Transcript Telegram Bot

Telegram-бот принимает ссылку на YouTube-видео и возвращает полную расшифровку из доступных субтитров.

Если у видео есть несколько дорожек субтитров, бот показывает список языков и отдельно помечает источник:

- `загружены вручную на YouTube` — обычные загруженные субтитры;
- `автоматически сгенерированы YouTube` — auto captions / ASR.

## Требования

- Node.js 20 или новее.
- Токен Telegram-бота от [BotFather](https://t.me/BotFather).

Проект не использует внешние npm-зависимости.

## Запуск

1. Создайте `.env` на основе `.env.example`.
2. Укажите токен:

```env
TELEGRAM_BOT_TOKEN=123456789:your_bot_token
```

Опционально:

```env
# Если YouTube отдаёт пустые timedtext-субтитры без Proof-of-Origin token.
YOUTUBE_PO_TOKEN=

# Fallback на managed API, если не хотите заниматься PO token.
YOUTUBE_TRANSCRIPT_DEV_API_KEY=
```

3. Установите lockfile-окружение:

```bash
npm install
```

4. Запустите бота:

```bash
npm start
```

Для запуска без npm:

```bash
node src/index.js
```

## Как это работает

1. Бот получает YouTube-ссылку и извлекает video id.
2. Загружает страницу видео и читает список `captionTracks`.
3. Если дорожка одна, сразу скачивает ее текст.
4. Если дорожек несколько, просит выбрать язык и показывает источник субтитров.
5. Длинные расшифровки отправляет `.txt`-файлом, короткие — обычным сообщением.

Важно: у YouTube нет стабильного публичного API для произвольных транскриптов. В 2025+ часть `timedtext`-запросов возвращает пустой ответ без Proof-of-Origin token. Поэтому бот поддерживает `YOUTUBE_PO_TOKEN` и опциональный fallback `YOUTUBE_TRANSCRIPT_DEV_API_KEY`.

## Проверка

```bash
npm run check
```

Команда выполняет синтаксическую проверку и unit-тесты для разбора YouTube-ссылок и форматов субтитров.

Живой smoke-test против YouTube:

```bash
npm run smoke:youtube -- M7lc1UVf-VE
```
