const WATCH_BASE = "https://www.youtube.com/watch?v=";
const FALLBACK_INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const PLAYER_CLIENTS = [
  {
    origin: "https://www.youtube.com",
    client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 35 },
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
  },
  {
    origin: "https://www.youtube-nocookie.com",
    client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 35 },
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
  },
  {
    origin: "https://www.youtube-nocookie.com",
    client: {
      clientName: "IOS",
      clientVersion: "20.10.4",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "18.3.1.22D72",
    },
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_1 like Mac OS X)",
  },
];

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.end(JSON.stringify(body));
}

function extractJsonObject(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

export function parsePlayerResponse(html) {
  for (const marker of ["ytInitialPlayerResponse =", 'ytInitialPlayerResponse":']) {
    const json = extractJsonObject(html, marker);
    if (!json) continue;
    try {
      return JSON.parse(json);
    } catch {
      // Try the next representation embedded in the page.
    }
  }
  return null;
}

export function parseYouTubeConfig(html) {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? "";
  return { apiKey };
}

export function selectCaptionTrack(playerResponse) {
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || !tracks.length) return null;
  return tracks.find((track) => track.languageCode?.toLowerCase() === "en" && track.kind !== "asr")
    ?? tracks.find((track) => track.languageCode?.toLowerCase().startsWith("en"))
    ?? tracks.find((track) => track.kind !== "asr")
    ?? tracks[0];
}

export function rankCaptionTracks(playerResponse, origin = "https://www.youtube.com") {
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks)) return [];
  return tracks
    .filter((track) => track?.baseUrl)
    .map((track) => ({ ...track, sourceOrigin: origin }))
    .sort((left, right) => {
      const score = (track) => {
        const language = track.languageCode?.toLowerCase() ?? "";
        return (language === "en" ? 0 : language.startsWith("en") ? 1 : 2) + (track.kind === "asr" ? 1 : 0);
      };
      return score(left) - score(right);
    });
}

function cleanText(value) {
  return value
    .replace(/\n/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[A-Z][A-Z .'-]{1,40}:\s+/, "")
    .trim();
}

export function parseTimedText(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return events.flatMap((event, index) => {
    const text = cleanText(Array.isArray(event.segs) ? event.segs.map((segment) => segment.utf8 ?? "").join("") : "");
    const startMs = Number(event.tStartMs);
    const durationMs = Number(event.dDurationMs);
    if (!text || /^\s*[[(].*[\])]\s*$/.test(text) || !Number.isFinite(startMs) || !Number.isFinite(durationMs) || durationMs <= 0) return [];
    return [{
      id: `cue-${index + 1}-${Math.round(startMs)}`,
      startSeconds: startMs / 1000,
      endSeconds: (startMs + durationMs) / 1000,
      text,
    }];
  });
}

function decodeXml(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };
  return value.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (named[key]) return named[key];
    if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    return match;
  });
}

export function parseXmlTimedText(xml) {
  const cues = [];
  const pattern = /<(?:text|p)\b([^>]*)>([\s\S]*?)<\/(?:text|p)>/gi;
  for (const match of xml.matchAll(pattern)) {
    const attributes = match[1];
    const startValue = attributes.match(/\bstart="([^"]+)"/)?.[1];
    const durationValue = attributes.match(/\bdur="([^"]+)"/)?.[1];
    const timeValue = attributes.match(/\bt="([^"]+)"/)?.[1];
    const xmlDurationValue = attributes.match(/\bd="([^"]+)"/)?.[1];
    const startSeconds = startValue === undefined ? Number(timeValue) / 1000 : Number(startValue);
    const durationSeconds = durationValue === undefined ? Number(xmlDurationValue) / 1000 : Number(durationValue);
    const text = cleanText(decodeXml(match[2].replace(/<[^>]*>/g, " ")));
    if (!text || /^\s*[[(].*[\])]\s*$/.test(text) || !Number.isFinite(startSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) continue;
    cues.push({
      id: `cue-${cues.length + 1}-${Math.round(startSeconds * 1000)}`,
      startSeconds,
      endSeconds: startSeconds + durationSeconds,
      text,
    });
  }
  return cues;
}

function trackLanguageName(track) {
  return track?.name?.simpleText
    ?? track?.name?.runs?.map((run) => run.text ?? "").join("")
    ?? track?.languageCode
    ?? "Unknown";
}

async function fetchTrackCues(track) {
  const captionUrl = new URL(track.baseUrl, track.sourceOrigin);
  if (captionUrl.protocol !== "https:" || !(captionUrl.hostname === "youtube.com" || captionUrl.hostname.endsWith(".youtube.com") || captionUrl.hostname === "youtube-nocookie.com" || captionUrl.hostname.endsWith(".youtube-nocookie.com"))) {
    return [];
  }

  captionUrl.searchParams.set("fmt", "json3");
  const jsonResponse = await fetch(captionUrl, { headers: { "Accept-Language": "en-US,en;q=0.9" } });
  if (jsonResponse.ok) {
    const text = await jsonResponse.text();
    if (text.trim()) {
      try {
        const cues = parseTimedText(JSON.parse(text));
        if (cues.length) return cues;
      } catch {
        // Some YouTube clients ignore fmt and return XML; try the raw track below.
      }
    }
  }

  captionUrl.searchParams.delete("fmt");
  const xmlResponse = await fetch(captionUrl, { headers: { "Accept-Language": "en-US,en;q=0.9" } });
  if (!xmlResponse.ok) return [];
  return parseXmlTimedText(await xmlResponse.text());
}

async function fetchPlayerResponse(videoId, apiKey, source) {
  const response = await fetch(`${source.origin}/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": source.userAgent },
    body: JSON.stringify({
      context: { client: { ...source.client, hl: "en", gl: "US" } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!response.ok) return null;
  const text = await response.text();
  if (!text.trim().startsWith("{")) return null;
  return JSON.parse(text);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  const videoId = typeof req.query?.videoId === "string" ? req.query.videoId : "";
  if (!/^[\w-]{11}$/.test(videoId)) return sendJson(res, 400, { error: "URL YouTube không hợp lệ." });

  try {
    const watchResponse = await fetch(`${WATCH_BASE}${encodeURIComponent(videoId)}&hl=en`, {
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
    });
    const watchHtml = watchResponse.ok ? await watchResponse.text() : "";
    const apiKey = parseYouTubeConfig(watchHtml).apiKey || FALLBACK_INNERTUBE_KEY;
    const candidates = [];
    const initialPlayerResponse = parsePlayerResponse(watchHtml);
    if (initialPlayerResponse) candidates.push({ response: initialPlayerResponse, origin: "https://www.youtube.com" });

    let accessBlocked = initialPlayerResponse?.playabilityStatus?.status === "LOGIN_REQUIRED";
    for (const source of PLAYER_CLIENTS) {
      try {
        const response = await fetchPlayerResponse(videoId, apiKey, source);
        if (!response) continue;
        if (response.playabilityStatus?.status === "LOGIN_REQUIRED") accessBlocked = true;
        candidates.push({ response, origin: source.origin });
      } catch {
        // Continue with the next client/host because YouTube may block one route only.
      }
    }

    let foundTrack = false;
    const triedUrls = new Set();
    for (const candidate of candidates) {
      for (const track of rankCaptionTracks(candidate.response, candidate.origin)) {
        const key = `${track.languageCode ?? ""}:${track.kind ?? "manual"}:${track.baseUrl}`;
        if (triedUrls.has(key)) continue;
        triedUrls.add(key);
        foundTrack = true;
        try {
          const cues = await fetchTrackCues(track);
          if (cues.length) {
            return sendJson(res, 200, {
              cues,
              language: trackLanguageName(track),
              languageCode: track.languageCode ?? "",
            });
          }
        } catch {
          // Try another caption track or YouTube client.
        }
      }
    }

    if (accessBlocked && !foundTrack) {
      return sendJson(res, 503, { error: "YouTube đang tạm chặn máy chủ lấy phụ đề. Hãy thử lại sau ít phút." });
    }
    if (foundTrack) return sendJson(res, 502, { error: "YouTube có phụ đề nhưng tạm thời không cho tải nội dung. Hãy thử lại." });
    return sendJson(res, 422, { error: "Video này không có phụ đề hoặc lời thoại tự động từ YouTube." });
  } catch (error) {
    console.error("YouTube transcript error", error);
    return sendJson(res, 500, { error: "Không thể tự lấy phụ đề. Vui lòng thử video khác." });
  }
}
