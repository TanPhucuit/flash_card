import { AppData } from "../types";

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
