import { AppData } from "../types";
import { ReadingBook, ReadingAttempt } from "../types/reading";

/** Shape returned by /api/sheets/reading-load — just the sheet-backed part of ReadingData. */
export interface CloudReadingData {
  books: ReadingBook[];
  attempts: ReadingAttempt[];
}

export async function loadFromGoogleSheet(signal?: AbortSignal): Promise<AppData> {
  const response = await fetch("/api/sheets/load", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Cannot load Google Sheet data: ${response.status}`);
  return response.json();
}

export async function saveToGoogleSheet(data: AppData): Promise<void> {
  const response = await fetch("/api/sheets/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`Cannot save Google Sheet data: ${response.status}`);
}

export async function loadReadingFromGoogleSheet(signal?: AbortSignal): Promise<CloudReadingData> {
  const response = await fetch("/api/sheets/reading-load", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Cannot load Google Sheet reading data: ${response.status}`);
  return response.json();
}

export async function saveReadingToGoogleSheet(data: CloudReadingData): Promise<void> {
  const response = await fetch("/api/sheets/reading-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`Cannot save Google Sheet reading data: ${response.status}`);
}
