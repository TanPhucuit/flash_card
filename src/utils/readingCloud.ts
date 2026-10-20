import { ReadingAttempt } from "../types/reading";
import { normalizeAttempt } from "./readingStorage";

const ENDPOINT = "/api/sheets/reading";

export async function loadReadingAttempts(signal?: AbortSignal): Promise<ReadingAttempt[]> {
  const response = await fetch(ENDPOINT, { headers: { Accept: "application/json" }, cache: "no-store", signal });
  if (!response.ok) throw new Error(`Cannot load reading attempts: ${response.status}`);
  const body = (await response.json()) as { attempts?: ReadingAttempt[] };
  return (body.attempts ?? []).map(normalizeAttempt);
}

export async function pushReadingAttempts(attempts: ReadingAttempt[]): Promise<void> {
  if (!attempts.length) return;
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attempts }),
  });
  if (!response.ok) throw new Error(`Cannot save reading attempts: ${response.status}`);
}

/** Hợp hai danh sách theo id, mới nhất lên đầu (đúng thứ tự recordAttempt vẫn dùng). */
export function mergeAttempts(local: ReadingAttempt[], remote: ReadingAttempt[]): ReadingAttempt[] {
  const byId = new Map<string, ReadingAttempt>();
  for (const attempt of [...remote, ...local]) byId.set(attempt.id, attempt);
  return [...byId.values()].sort((a, b) => (b.finishedAt || "").localeCompare(a.finishedAt || ""));
}
