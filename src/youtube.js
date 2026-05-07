const YOUTUBE_WATCH_URL = "https://www.youtube.com/watch";
const TRANSCRIPT_DEV_API_URL = "https://youtubetranscript.dev/api/v2/transcribe";
const REQUEST_HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
};

export class YoutubeTranscriptError extends Error {
  constructor(message, code = "YOUTUBE_TRANSCRIPT_ERROR") {
    super(message);
    this.name = "YoutubeTranscriptError";
    this.code = code;
  }
}

export function extractVideoId(input) {
  const text = String(input ?? "").trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) {
    return text;
  }

  const candidate = text.match(/(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s<>"]+/i)?.[0];

  if (!candidate) {
    return null;
  }

  let url;

  try {
    url = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return isVideoId(id) ? id : null;
  }

  if (!host.endsWith("youtube.com")) {
    return null;
  }

  const watchId = url.searchParams.get("v");

  if (isVideoId(watchId)) {
    return watchId;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const knownPathPrefixes = new Set(["embed", "shorts", "live", "v"]);

  if (knownPathPrefixes.has(parts[0]) && isVideoId(parts[1])) {
    return parts[1];
  }

  return null;
}

export async function listCaptionTracks(videoId, fetchImpl = fetch) {
  if (!isVideoId(videoId)) {
    throw new YoutubeTranscriptError("Некорректный YouTube video id.", "BAD_VIDEO_ID");
  }

  const url = new URL(YOUTUBE_WATCH_URL);
  url.searchParams.set("v", videoId);
  url.searchParams.set("hl", "en");

  const response = await fetchImpl(url, {
    headers: REQUEST_HEADERS
  });

  if (!response.ok) {
    throw new YoutubeTranscriptError(
      `YouTube вернул HTTP ${response.status}.`,
      "YOUTUBE_HTTP_ERROR"
    );
  }

  const html = await response.text();
  const playerResponse = extractInitialPlayerResponse(html);
  const tracks = playerResponse?.captions
    ?.playerCaptionsTracklistRenderer
    ?.captionTracks;

  if (!Array.isArray(tracks) || tracks.length === 0) {
    const reason = playerResponse?.playabilityStatus?.reason;
    const details = reason ? ` Причина YouTube: ${reason}` : "";

    throw new YoutubeTranscriptError(
      `Для этого видео не нашлось доступных субтитров.${details}`,
      "NO_CAPTIONS"
    );
  }

  return {
    videoId,
    title: playerResponse?.videoDetails?.title ?? "",
    tracks: normalizeTracks(tracks)
  };
}

export async function fetchBestManagedTranscript(
  videoId,
  fetchImpl = fetch,
  config = runtimeConfig()
) {
  if (!config.YOUTUBE_TRANSCRIPT_DEV_API_KEY) {
    throw new YoutubeTranscriptError(
      "Cloudflare Worker получает HTTP 429 от YouTube. Добавьте YOUTUBE_TRANSCRIPT_DEV_API_KEY в Worker secrets, чтобы получать транскрипты через внешний transcript API.",
      "MANAGED_TRANSCRIPT_API_KEY_REQUIRED"
    );
  }

  const data = await fetchManagedTranscriptData(
    {
      video: videoId,
      source: "auto"
    },
    fetchImpl,
    config
  );
  const transcript = extractManagedTranscriptText(data);

  if (!transcript) {
    throw new YoutubeTranscriptError(
      "Managed transcript API ответил, но текст расшифровки не найден.",
      "MANAGED_TRANSCRIPT_EMPTY"
    );
  }

  return {
    videoId: data?.data?.video_id ?? videoId,
    title: data?.data?.video_title ?? "",
    track: managedTrackFromResponse(data),
    transcript
  };
}

export async function fetchTranscript(
  videoId,
  track,
  fetchImpl = fetch,
  config = runtimeConfig()
) {
  if (!track?.baseUrl) {
    throw new YoutubeTranscriptError("У дорожки субтитров нет URL.", "BAD_CAPTION_TRACK");
  }

  let nativeError;

  try {
    return await fetchTranscriptFromCaptionTrack(track, fetchImpl, config);
  } catch (error) {
    nativeError = error;
  }

  if (config.YOUTUBE_TRANSCRIPT_DEV_API_KEY) {
    return fetchTranscriptViaManagedApi(videoId, track, fetchImpl, config);
  }

  if (nativeError?.code === "EMPTY_TRANSCRIPT") {
    throw new YoutubeTranscriptError(
      [
        "YouTube вернул пустой ответ для выбранных субтитров.",
        "Для части видео сейчас нужен Proof-of-Origin token.",
        "Добавьте YOUTUBE_PO_TOKEN в .env или подключите YOUTUBE_TRANSCRIPT_DEV_API_KEY."
      ].join(" "),
      "EMPTY_TRANSCRIPT"
    );
  }

  throw nativeError;
}

async function fetchTranscriptFromCaptionTrack(track, fetchImpl, config) {
  const formats = ["json3", "vtt", ""];
  let lastError;

  for (const format of formats) {
    try {
      const url = buildCaptionUrl(track, format, config);
      const response = await fetchImpl(url, {
        headers: REQUEST_HEADERS
      });

      if (!response.ok) {
        throw new YoutubeTranscriptError(
          `YouTube не отдал выбранные субтитры, HTTP ${response.status}.`,
          "CAPTION_DOWNLOAD_FAILED"
        );
      }

      const body = await response.text();
      const transcript = parseTranscriptBody(body);

      if (transcript) {
        return transcript;
      }

      lastError = new YoutubeTranscriptError(
        "Субтитры скачались, но текст внутри не найден.",
        "EMPTY_TRANSCRIPT"
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function fetchTranscriptViaManagedApi(videoId, track, fetchImpl, config) {
  const data = await fetchManagedTranscriptData(
    {
      video: videoId,
      language: track.languageCode,
      source: track.isAutoGenerated ? "auto" : "manual"
    },
    fetchImpl,
    config
  );

  const transcript = extractManagedTranscriptText(data);

  if (!transcript) {
    throw new YoutubeTranscriptError(
      "Managed transcript API ответил, но текст расшифровки не найден.",
      "MANAGED_TRANSCRIPT_EMPTY"
    );
  }

  return transcript;
}

async function fetchManagedTranscriptData(payload, fetchImpl, config) {
  const response = await fetchImpl(TRANSCRIPT_DEV_API_URL, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${config.YOUTUBE_TRANSCRIPT_DEV_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new YoutubeTranscriptError(
      data?.error?.message ?? `Managed transcript API вернул HTTP ${response.status}.`,
      "MANAGED_TRANSCRIPT_API_ERROR"
    );
  }

  if (data?.status && data.status !== "completed") {
    throw new YoutubeTranscriptError(
      `Managed transcript API пока не вернул готовый текст: ${data.status}.`,
      "MANAGED_TRANSCRIPT_PROCESSING"
    );
  }

  return data;
}

export function parseTranscriptBody(body) {
  if (!body.trim()) {
    return "";
  }

  if (body.trimStart().startsWith("WEBVTT")) {
    return parseVttTranscript(body);
  }

  try {
    const json = JSON.parse(body);
    return parseJson3Transcript(json);
  } catch {
    return parseXmlTranscript(body);
  }
}

export function parseJson3Transcript(json) {
  const events = Array.isArray(json?.events) ? json.events : [];
  const lines = [];

  for (const event of events) {
    if (!Array.isArray(event.segs)) {
      continue;
    }

    const text = event.segs
      .map((segment) => segment?.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    if (text) {
      lines.push(text);
    }
  }

  return lines.join("\n").trim();
}

export function extractInitialPlayerResponse(html) {
  return extractJsonObjectAfterMarker(html, "ytInitialPlayerResponse", {
    errorMessage: "Не удалось прочитать данные видео со страницы YouTube.",
    errorCode: "PLAYER_RESPONSE_NOT_FOUND"
  });
}

export function extractInitialData(html) {
  return extractJsonObjectAfterMarker(html, "ytInitialData", {
    errorMessage: "Не удалось прочитать данные страницы YouTube.",
    errorCode: "INITIAL_DATA_NOT_FOUND"
  });
}

export function extractYtcfg(html) {
  return extractJsonObjectAfterMarker(html, "ytcfg.set", {
    errorMessage: "Не удалось прочитать конфигурацию YouTube.",
    errorCode: "YTCFG_NOT_FOUND"
  });
}

function extractJsonObjectAfterMarker(html, marker, { errorMessage, errorCode }) {
  let markerIndex = html.indexOf(marker);

  while (markerIndex !== -1) {
    const jsonStart = html.indexOf("{", markerIndex);

    if (jsonStart === -1) {
      break;
    }

    const jsonText = extractBalancedJson(html, jsonStart);

    if (!jsonText) {
      break;
    }

    try {
      return JSON.parse(jsonText);
    } catch {
      markerIndex = html.indexOf(marker, markerIndex + marker.length);
    }
  }

  throw new YoutubeTranscriptError(errorMessage, errorCode);
}

function normalizeTracks(tracks) {
  return tracks
    .map((track, originalIndex) => ({
      originalIndex,
      baseUrl: track.baseUrl,
      languageCode: track.languageCode ?? "unknown",
      languageName: textFromYouTubeLabel(track.name) || track.languageCode || "Unknown",
      isAutoGenerated: track.kind === "asr",
      isTranslatable: track.isTranslatable === true
    }))
    .sort((left, right) => {
      if (left.isAutoGenerated !== right.isAutoGenerated) {
        return left.isAutoGenerated ? 1 : -1;
      }

      return `${left.languageName} ${left.languageCode}`.localeCompare(
        `${right.languageName} ${right.languageCode}`,
        "ru"
      );
    });
}

function parseXmlTranscript(xml) {
  const matches = [
    ...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi),
    ...xml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)
  ];
  const lines = matches
    .map((match) => stripXmlTags(decodeHtmlEntities(match[1])).replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return lines.join("\n").trim();
}

function parseVttTranscript(vtt) {
  const lines = vtt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) {
        return false;
      }

      return !line.startsWith("WEBVTT")
        && !line.includes("-->")
        && !/^\d+$/.test(line)
        && !line.startsWith("Kind:")
        && !line.startsWith("Language:");
    })
    .map((line) => stripXmlTags(decodeHtmlEntities(line)).trim())
    .filter(Boolean);

  return lines.join("\n").trim();
}

function buildCaptionUrl(track, format, config) {
  const url = new URL(track.baseUrl);

  if (format) {
    url.searchParams.set("fmt", format);
  }

  url.searchParams.set("c", "WEB");
  url.searchParams.set("cver", config.YOUTUBE_CLIENT_VERSION ?? "2.20260506.01.00");
  url.searchParams.set("cplayer", "UNIPLAYER");
  url.searchParams.set("cplatform", "DESKTOP");
  url.searchParams.set("cbr", "Chrome");
  url.searchParams.set("cbrver", config.YOUTUBE_BROWSER_VERSION ?? "137.0.0.0");
  url.searchParams.set("cos", "Windows");
  url.searchParams.set("cosver", "10.0");

  if (config.YOUTUBE_PO_TOKEN) {
    url.searchParams.set("potc", "1");
    url.searchParams.set("pot", config.YOUTUBE_PO_TOKEN);
    url.searchParams.set("xorb", "2");
    url.searchParams.set("xobt", "3");
    url.searchParams.set("xovt", "3");
  }

  return url;
}

function runtimeConfig() {
  return globalThis.process?.env ?? {};
}

function extractManagedTranscriptText(data) {
  const stringCandidates = [
    data?.data?.transcript?.text,
    data?.data?.transcript_text,
    data?.transcript?.text,
    data?.transcript_text,
    data?.text
  ];

  for (const candidate of stringCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const arrayCandidates = [
    data?.data?.transcript,
    data?.data?.segments,
    data?.transcript,
    data?.segments
  ];

  for (const candidate of arrayCandidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    const text = candidate
      .map((segment) => segment?.text ?? segment?.snippet ?? "")
      .filter(Boolean)
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
}

function managedTrackFromResponse(data) {
  const source = data?.data?.transcript?.source ?? "auto";
  const languageCode = data?.data?.transcript?.language ?? "unknown";

  return {
    originalIndex: 0,
    baseUrl: "",
    languageCode,
    languageName: languageCode,
    isAutoGenerated: source !== "manual",
    isTranslatable: false
  };
}

function textFromYouTubeLabel(label) {
  if (!label) {
    return "";
  }

  if (typeof label.simpleText === "string") {
    return label.simpleText;
  }

  if (Array.isArray(label.runs)) {
    return label.runs.map((run) => run?.text ?? "").join("");
  }

  return "";
}

function extractBalancedJson(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function decodeHtmlEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, value) => {
    if (value[0] === "#") {
      const radix = value[1]?.toLowerCase() === "x" ? 16 : 10;
      const codePoint = Number.parseInt(radix === 16 ? value.slice(2) : value.slice(1), radix);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    const namedEntities = {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      quot: "\""
    };

    return namedEntities[value] ?? entity;
  });
}

function stripXmlTags(text) {
  return text.replace(/<[^>]+>/g, "");
}

function isVideoId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{11}$/.test(value);
}
