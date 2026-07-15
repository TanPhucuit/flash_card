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
    .replace(/\bwon['’]?t\b/g, "will not")
    .replace(/\bcan['’]?t\b/g, "can not")
    .replace(/\b([\p{L}]+)n['’]?t\b/gu, "$1 not")
    .replace(/\b(i|you|we|they)\s*['’]?ve\b/g, "$1 have")
    .replace(/\b(you|we|they)\s*['’]?re\b/g, "$1 are")
    .replace(/\bi\s*['’]?m\b/g, "i am")
    .replace(/\b(i|you|he|she|it|we|they)\s*['’]?ll\b/g, "$1 will")
    .replace(/[’‘`']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function relaxedToken(value: string) {
  const irregular: Record<string, string> = { does: "do", has: "have" };
  if (irregular[value]) return irregular[value];
  if (value.length <= 3 || /(?:ss|us|is)$/.test(value)) return value;
  if (value.endsWith("ies") && value.length > 4) return `${value.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|zes|oes)$/.test(value)) return value.slice(0, -2);
  if (value.endsWith("s")) return value.slice(0, -1);
  return value;
}

function editDistanceAtMostOne(left: string, right: string) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let first = left;
  let second = right;
  if (first.length > second.length) [first, second] = [second, first];
  let edits = 0;
  for (let leftIndex = 0, rightIndex = 0; rightIndex < second.length;) {
    if (first[leftIndex] === second[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
    } else {
      edits += 1;
      if (edits > 1) return false;
      if (first.length === second.length) leftIndex += 1;
      rightIndex += 1;
    }
  }
  return true;
}

export function isListeningAnswerCorrect(answer: string, expected: string) {
  const answerTokens = normalizeListeningAnswer(answer).split(" ").filter(Boolean);
  const expectedTokens = normalizeListeningAnswer(expected).split(" ").filter(Boolean);
  if (answerTokens.length !== expectedTokens.length) return false;
  return expectedTokens.every((expectedToken, index) => {
    const answerToken = answerTokens[index];
    if (answerToken === expectedToken) return true;
    const relaxedAnswer = relaxedToken(answerToken);
    const relaxedExpected = relaxedToken(expectedToken);
    if (relaxedAnswer === relaxedExpected) return true;
    return Math.min(relaxedAnswer.length, relaxedExpected.length) >= 5 && editDistanceAtMostOne(relaxedAnswer, relaxedExpected);
  });
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

export async function fetchListeningTranslation(text: string) {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ text }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { translation?: string; error?: string };
  if (!response.ok || !payload.translation) throw new Error(payload.error || "Không thể tải bản dịch.");
  return payload.translation;
}
