import {
  buildInlineKeyboard,
  buildLanguageChoiceMessage,
  buildTranscriptCaption,
  buildTranscriptDocument,
  buildTranscriptFilename,
  formatTrackLabel,
  shouldSendAsDocument
} from "./format.js";
import {
  extractVideoId,
  fetchTranscript,
  listCaptionTracks,
  YoutubeTranscriptError
} from "./youtube.js";

const START_MESSAGE = [
  "Пришлите ссылку на YouTube-видео, а я верну полную расшифровку из субтитров.",
  "",
  "Если у видео есть несколько дорожек, я попрошу выбрать язык и покажу, какие субтитры загружены вручную, а какие сгенерированы автоматически."
].join("\n");

export class YoutubeTranscriptBot {
  constructor(telegram, options = {}) {
    this.telegram = telegram;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.config = options.config ?? undefined;
  }

  async handleUpdate(update) {
    if (update.message) {
      await this.handleMessage(update.message);
      return;
    }

    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
    }
  }

  async handleMessage(message) {
    const chatId = message.chat?.id;
    const text = message.text?.trim();

    if (!chatId || !text) {
      return;
    }

    if (text === "/start" || text === "/help") {
      await this.telegram.sendMessage(chatId, START_MESSAGE);
      return;
    }

    const videoId = extractVideoId(text);

    if (!videoId) {
      await this.telegram.sendMessage(
        chatId,
        "Не вижу YouTube-ссылку. Пришлите ссылку вида https://www.youtube.com/watch?v=..."
      );
      return;
    }

    await this.telegram.sendMessage(chatId, "Смотрю, какие субтитры доступны для видео...");

    try {
      const captionInfo = await listCaptionTracks(videoId, this.fetchImpl);

      if (captionInfo.tracks.length === 1) {
        await this.sendTranscript(chatId, captionInfo, captionInfo.tracks[0]);
        return;
      }

      await this.telegram.sendMessage(
        chatId,
        buildLanguageChoiceMessage(captionInfo),
        {
          reply_markup: buildInlineKeyboard(captionInfo.videoId, captionInfo.tracks)
        }
      );
    } catch (error) {
      await this.sendFriendlyError(chatId, error);
    }
  }

  async handleCallback(callbackQuery) {
    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;
    const data = callbackQuery.data ?? "";
    const match = data.match(/^yt:([a-zA-Z0-9_-]{11}):(\d+)$/);

    if (!chatId || !match) {
      await this.telegram.answerCallbackQuery(callbackQuery.id, "Не удалось прочитать выбор.");
      return;
    }

    const [, videoId, trackIndexText] = match;
    let captionInfo;

    try {
      captionInfo = await listCaptionTracks(videoId, this.fetchImpl);
    } catch (error) {
      await this.sendFriendlyError(chatId, error);
      return;
    }

    const track = captionInfo.tracks[Number(trackIndexText)];

    if (!track) {
      await this.telegram.answerCallbackQuery(callbackQuery.id, "Такой дорожки уже нет.");
      return;
    }

    await this.telegram.answerCallbackQuery(callbackQuery.id, "Готовлю расшифровку...");

    if (messageId) {
      await this.telegram.editMessageReplyMarkup(chatId, messageId).catch(() => {});
    }

    await this.telegram.sendMessage(chatId, `Выбрано: ${formatTrackLabel(track)}`);

    try {
      await this.sendTranscript(chatId, captionInfo, track);
    } catch (error) {
      await this.sendFriendlyError(chatId, error);
    }
  }

  async sendTranscript(chatId, captionInfo, track) {
    await this.telegram.sendMessage(chatId, "Скачиваю текст субтитров...");

    const transcript = await fetchTranscript(
      captionInfo.videoId,
      track,
      this.fetchImpl,
      this.config
    );
    const documentText = buildTranscriptDocument({
      videoId: captionInfo.videoId,
      title: captionInfo.title,
      track,
      transcript
    });

    if (shouldSendAsDocument(documentText)) {
      await this.telegram.sendDocument(chatId, {
        filename: buildTranscriptFilename({
          videoId: captionInfo.videoId,
          track,
          title: captionInfo.title
        }),
        content: documentText,
        caption: buildTranscriptCaption({
          title: captionInfo.title,
          track
        })
      });
      return;
    }

    await this.telegram.sendMessage(chatId, documentText);
  }

  async sendFriendlyError(chatId, error) {
    if (error instanceof YoutubeTranscriptError) {
      await this.telegram.sendMessage(chatId, error.message);
      return;
    }

    console.error(error);
    await this.telegram.sendMessage(
      chatId,
      "Не получилось получить расшифровку. Попробуйте другое видео или повторите позже."
    );
  }
}
