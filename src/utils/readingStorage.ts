import { LifeManagementConfig, ReadingData } from "../types/reading";

// Reading data lives under its OWN localStorage key, deliberately outside the
// AppData that useAppData manages. That store is overwritten wholesale by the
// Google Sheet on every load (see useAppData), and passage bodies are far too
// large for the sheet's row model anyway — folding reading into it would mean
// losing every book on the next sync.
export const READING_STORAGE_KEY = "localEnglishReading:v1";
export const READING_BACKUP_KEY = "localEnglishReading:v1:backup";

// Discovered from the live Life Management database, so a fresh install only
// needs the deployment URL filled in rather than four opaque UUIDs.
export const DEFAULT_LIFE_MANAGEMENT: LifeManagementConfig = {
  baseUrl: "",
  userId: "70574365-70e1-4a4e-b84c-584f6001ed22",
  topicId: "4f13d430-127e-4a18-95b3-69fa72cad03e",
  readingTaskId: "4482037e-446d-45a3-b48c-3cabec7046d2",
  enabled: true,
};

export function emptyReadingData(): ReadingData {
  return { books: [], attempts: [], lifeManagement: { ...DEFAULT_LIFE_MANAGEMENT } };
}

function normalize(parsed: Partial<ReadingData>): ReadingData {
  return {
    books: Array.isArray(parsed.books) ? parsed.books : [],
    attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
    // Spread the defaults under the stored value so a config saved before a
    // new field existed still ends up with that field populated.
    lifeManagement: { ...DEFAULT_LIFE_MANAGEMENT, ...(parsed.lifeManagement ?? {}) },
  };
}

function parse(raw: string | null): ReadingData | null {
  if (!raw) return null;
  return normalize(JSON.parse(raw) as Partial<ReadingData>);
}

export function loadReadingData(): ReadingData {
  try {
    const primary = parse(localStorage.getItem(READING_STORAGE_KEY));
    if (primary) return primary;
  } catch (error) {
    console.error("Cannot read reading data. Trying backup.", error);
  }
  try {
    const backup = parse(localStorage.getItem(READING_BACKUP_KEY));
    if (backup) {
      localStorage.setItem(READING_STORAGE_KEY, JSON.stringify(backup));
      return backup;
    }
  } catch (error) {
    console.error("Cannot read reading backup data.", error);
  }
  return emptyReadingData();
}

export function saveReadingData(data: ReadingData) {
  const serialized = JSON.stringify(data);
  localStorage.setItem(READING_STORAGE_KEY, serialized);
  localStorage.setItem(READING_BACKUP_KEY, serialized);
}

/** Local calendar day, not UTC — "today" has to mean the user's today. */
export function toDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Monday-based week start, matching how the Life Management app groups weeks. */
export function startOfWeek(date: Date): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - weekday);
  return copy;
}
