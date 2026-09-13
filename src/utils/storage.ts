import { AppData, AppSettings } from "../types";

export const STORAGE_KEY = "localEnglishFlashcards:v1";
export const STORAGE_BACKUP_KEY = "localEnglishFlashcards:v1:backup";

function emptyAppData(): AppData {
  return {
    sets: [],
    results: [],
    matchBestTimes: {},
    lists: [],
    settings: {
      theme: "light",
      voiceURI: "",
    },
  };
}

function normalizeAppData(parsed: Partial<AppData>): AppData {
  return {
    sets: parsed.sets ?? [],
    results: parsed.results ?? [],
    matchBestTimes: parsed.matchBestTimes ?? {},
    lists: parsed.lists ?? [],
    settings: {
      theme: parsed.settings?.theme ?? "light",
      voiceURI: parsed.settings?.voiceURI ?? "",
    } satisfies AppSettings,
  };
}

function parseStoredData(raw: string | null): AppData | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<AppData>;
  return normalizeAppData(parsed);
}

export function loadAppData(): AppData {
  try {
    const primary = parseStoredData(localStorage.getItem(STORAGE_KEY));
    if (primary) return primary;
  } catch (error) {
    console.error("Cannot read primary app data. Trying backup.", error);
  }

  try {
    const backup = parseStoredData(localStorage.getItem(STORAGE_BACKUP_KEY));
    if (backup) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(backup));
      return backup;
    }
  } catch (error) {
    console.error("Cannot read backup app data.", error);
  }

  return emptyAppData();
}

export function saveAppData(data: AppData): string {
  const serialized = JSON.stringify(data);
  localStorage.setItem(STORAGE_KEY, serialized);
  localStorage.setItem(STORAGE_BACKUP_KEY, serialized);
  return serialized;
}

/**
 * Ghi rồi đọc lại NGAY một khoá thử, thay vì chỉ dựa vào try/catch của
 * setItem — trên một số trình duyệt/WebView bị hạn chế lưu trữ (thường gặp
 * nhất trên iPad khi Safari bật "Chặn tất cả cookie" hoặc đang ở chế độ Duyệt
 * web riêng tư), setItem() không ném lỗi gì cả nhưng dữ liệu không thực sự
 * được lưu lại — đây là cách duy nhất phát hiện được kiểu ghi-giả đó.
 */
export function testStorageWritable(): boolean {
  const testKey = "localEnglishFlashcards:writeTest";
  const testValue = String(Date.now());
  try {
    localStorage.setItem(testKey, testValue);
    const ok = localStorage.getItem(testKey) === testValue;
    localStorage.removeItem(testKey);
    return ok;
  } catch {
    return false;
  }
}

export function getStorageDiagnostics() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const backup = localStorage.getItem(STORAGE_BACKUP_KEY);
  return {
    origin: window.location.origin,
    hasPrimary: Boolean(raw),
    hasBackup: Boolean(backup),
    primaryBytes: raw ? new Blob([raw]).size : 0,
    backupBytes: backup ? new Blob([backup]).size : 0,
    writable: testStorageWritable(),
  };
}
