const WATCH_BASE = "https://www.youtube.com/watch?v=";

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

function trackLanguageName(track) {
  return track?.name?.simpleText
    ?? track?.name?.runs?.map((run) => run.text ?? "").join("")
    ?? track?.languageCode
    ?? "Unknown";
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
    if (!watchResponse.ok) return sendJson(res, 502, { error: "Không thể truy cập video YouTube này." });
    const watchHtml = await watchResponse.text();
    const { apiKey } = parseYouTubeConfig(watchHtml);
    if (!apiKey) return sendJson(res, 502, { error: "Không thể khởi tạo kết nối phụ đề YouTube." });
    const playerApiResponse = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "20.10.38",
            androidSdkVersion: 35,
            hl: "en",
            gl: "US",
          },
        },
        videoId,
      }),
    });
    if (!playerApiResponse.ok) return sendJson(res, 502, { error: "Không thể đọc thông tin phụ đề YouTube." });
    const playerResponse = await playerApiResponse.json();
    const track = selectCaptionTrack(playerResponse);
    if (!track?.baseUrl) return sendJson(res, 422, { error: "Video này không có phụ đề để tạo bài test." });

    const captionUrl = new URL(track.baseUrl);
    if (captionUrl.protocol !== "https:" || !captionUrl.hostname.endsWith("youtube.com")) {
      return sendJson(res, 502, { error: "Nguồn phụ đề YouTube không hợp lệ." });
    }
    captionUrl.searchParams.set("fmt", "json3");
    const captionResponse = await fetch(captionUrl, { headers: { "Accept-Language": "en-US,en;q=0.9" } });
    if (!captionResponse.ok) return sendJson(res, 502, { error: "Không thể tải phụ đề của video." });
    const cues = parseTimedText(await captionResponse.json());
    if (!cues.length) return sendJson(res, 422, { error: "Phụ đề của video không có đoạn hội thoại hợp lệ." });

    return sendJson(res, 200, {
      cues,
      language: trackLanguageName(track),
      languageCode: track.languageCode ?? "",
    });
  } catch (error) {
    console.error("YouTube transcript error", error);
    return sendJson(res, 500, { error: "Không thể tự lấy phụ đề. Vui lòng thử video khác." });
  }
}
