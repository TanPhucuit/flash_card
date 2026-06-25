import { AppData, AppSettings } from "../types";
import { initialData } from "../data/sampleData";

export const STORAGE_KEY = "localEnglishFlashcards:v1";
export const STORAGE_BACKUP_KEY = "localEnglishFlashcards:v1:backup";

function cloneInitialData(): AppData {
  return JSON.parse(JSON.stringify(initialData)) as AppData;
}

function normalizeAppData(parsed: Partial<AppData>): AppData {
  return {
    sets: parsed.sets ?? [],
    results: parsed.results ?? [],
    matchBestTimes: parsed.matchBestTimes ?? {},
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

  return cloneInitialData();
}

export function saveAppData(data: AppData) {
  const serialized = JSON.stringify(data);
  localStorage.setItem(STORAGE_KEY, serialized);
  localStorage.setItem(STORAGE_BACKUP_KEY, serialized);
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
  };
}
