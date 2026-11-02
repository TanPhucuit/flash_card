import { AppData, StudyResult } from "../types";

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

/** Ghi nhanh vài kết quả học vừa xong (nối thêm, ~1 giây) — bản lưu đầy đủ vẫn chạy sau đó. */
export async function appendResultsToGoogleSheet(results: StudyResult[]): Promise<void> {
  const response = await fetch("/api/sheets/results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ results }),
  });
  if (!response.ok) throw new Error(`Cannot append results: ${response.status}`);
}

/** replaceResults: kết quả trong `data` là bản đúng (reset/nhập file), đừng hợp với kết quả đang có trên sheet. */
export async function saveToGoogleSheet(data: AppData, replaceResults = false): Promise<void> {
  const response = await fetch("/api/sheets/save", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(replaceResults ? { "X-Replace-Results": "1" } : {}) },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`Cannot save Google Sheet data: ${response.status}`);
}
