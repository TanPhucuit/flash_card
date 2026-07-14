export interface SubtitleCue {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface SubtitleParseResult {
  cues: SubtitleCue[];
  rejectedBlocks: number;
}

function parseTimestamp(value: string) {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite) || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key in named) return named[key];
    if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    return match;
  });
}

function cleanCueText(lines: string[]) {
  return decodeEntities(lines.join(" ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSubtitles(input: string): SubtitleParseResult {
  const blocks = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const cues: SubtitleCue[] = [];
  let rejectedBlocks = 0;

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim());
    const first = lines[0]?.toUpperCase() ?? "";
    if (first.startsWith("WEBVTT") || first.startsWith("NOTE") || first === "STYLE" || first === "REGION") continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      rejectedBlocks += 1;
      continue;
    }
    const [rawStart, rawEnd = ""] = lines[timingIndex].split("-->");
    const startSeconds = parseTimestamp(rawStart);
    const endSeconds = parseTimestamp(rawEnd.trim().split(/\s+/)[0] ?? "");
    const text = cleanCueText(lines.slice(timingIndex + 1));
    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds || !text) {
      rejectedBlocks += 1;
      continue;
    }
    cues.push({
      id: `cue-${cues.length + 1}-${Math.round(startSeconds * 1000)}`,
      startSeconds,
      endSeconds,
      text,
    });
  }

  cues.sort((left, right) => left.startSeconds - right.startSeconds);
  return { cues, rejectedBlocks };
}

export function extractYouTubeVideoId(input: string) {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let candidate = "";
    if (host === "youtu.be") candidate = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (host.endsWith("youtube.com")) {
      if (url.pathname === "/watch") candidate = url.searchParams.get("v") ?? "";
      else candidate = url.pathname.split("/").filter(Boolean)[1] ?? "";
    }
    return /^[\w-]{11}$/.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function normalizeListeningAnswer(value: string) {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("en")
    .replace(/[’‘`']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchYouTubeTranscript(videoId: string) {
  const response = await fetch(`/api/youtube/transcript?videoId=${encodeURIComponent(videoId)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as {
    cues?: SubtitleCue[];
    language?: string;
    languageCode?: string;
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error || "Không thể tự lấy phụ đề từ YouTube.");
  if (!payload.cues?.length) throw new Error("Video này không có phụ đề phù hợp để tạo bài test.");
  return {
    cues: payload.cues,
    language: payload.language || payload.languageCode || "Unknown",
  };
}
