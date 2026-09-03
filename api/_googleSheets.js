import crypto from "node:crypto";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export const SET_HEADERS = ["id", "title", "description", "tags", "createdAt", "updatedAt", "lastStudiedAt"];
export const CARD_HEADERS = [
  "setId",
  "id",
  "word",
  "ipa",
  "meaningVi",
  "definitionEn",
  "exampleEn",
  "exampleVi",
  "partOfSpeech",
  "level",
  "synonyms",
  "antonyms",
  "status",
  "mistakeCount",
  "correctCount",
  "starred",
  "lastStudiedAt",
  "nextReviewAt",
];
export const RESULT_HEADERS = ["id", "setId", "mode", "totalQuestions", "correctAnswers", "wrongAnswers", "accuracy", "studiedAt", "wrongCardIds", "direction"];

// Reading (IELTS practice books) gets its own three tabs, mirroring
// sets/cards/results. Kept separate from AppData's tabs because a full book
// can be tens of passages and this schema is unrelated to vocabulary.
export const BOOK_HEADERS = ["id", "title", "sourceFileName", "createdAt", "lifeManagementTaskId"];
// One row per passage, not per book: a book's full text would blow past a
// single cell's usefulness long before it hits the ~50,000 char sheet limit,
// and per-passage rows are what let a book update touch only what changed.
export const PASSAGE_HEADERS = ["bookId", "id", "order", "title", "text", "questionsJson"];
export const READING_ATTEMPT_HEADERS = ["id", "bookId", "bookTitle", "passageId", "passageTitle", "startedAt", "finishedAt", "durationSec", "answersJson", "correct", "total", "dateKey"];

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: env("GOOGLE_CLIENT_EMAIL"),
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const privateKey = env("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url");
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsigned}.${signature}`,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Google token failed: ${response.status} ${await response.text()}`);
  return (await response.json()).access_token;
}

export async function sheetsRequest(method, suffix, body) {
  const token = await getAccessToken();
  const spreadsheetId = env("GOOGLE_SHEET_ID");
  const response = await fetch(`${SHEETS_BASE}/${spreadsheetId}${suffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Google Sheets ${method} ${suffix} failed: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export async function ensureSchema() {
  const meta = await sheetsRequest("GET", "?includeGridData=false");
  const titles = Object.fromEntries((meta.sheets ?? []).map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
  const missing = ["sets", "cards", "results"].filter((title) => !(title in titles));
  if (missing.length) {
    await sheetsRequest("POST", ":batchUpdate", {
      requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
    });
  }
  await sheetsRequest("POST", "/values:batchUpdate", {
    valueInputOption: "RAW",
    data: [
      { range: "sets!A1:G1", values: [SET_HEADERS] },
      { range: "cards!A1:R1", values: [CARD_HEADERS] },
      { range: "results!A1:J1", values: [RESULT_HEADERS] },
    ],
  });
}

export async function ensureReadingSchema() {
  const meta = await sheetsRequest("GET", "?includeGridData=false");
  const titles = Object.fromEntries((meta.sheets ?? []).map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
  const missing = ["books", "passages", "readingAttempts"].filter((title) => !(title in titles));
  if (missing.length) {
    await sheetsRequest("POST", ":batchUpdate", {
      requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
    });
  }
  await sheetsRequest("POST", "/values:batchUpdate", {
    valueInputOption: "RAW",
    data: [
      { range: "books!A1:E1", values: [BOOK_HEADERS] },
      { range: "passages!A1:F1", values: [PASSAGE_HEADERS] },
      { range: "readingAttempts!A1:L1", values: [READING_ATTEMPT_HEADERS] },
    ],
  });
}

function parseJsonList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function rowsToAppData(raw) {
  const setsById = new Map();

  for (const row of raw.sets ?? []) {
    const [id, title, description, tags, createdAt, updatedAt, lastStudiedAt] = row;
    if (!id) continue;
    setsById.set(id, {
      id,
      title: title ?? "",
      description: description ?? "",
      tags: parseJsonList(tags),
      cards: [],
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: updatedAt || new Date().toISOString(),
      lastStudiedAt: lastStudiedAt || undefined,
    });
  }

  for (const row of raw.cards ?? []) {
    const [
      setId,
      id,
      word,
      ipa,
      meaningVi,
      definitionEn,
      exampleEn,
      exampleVi,
      partOfSpeech,
      level,
      synonyms,
      antonyms,
      status,
      mistakeCount,
      correctCount,
      starred,
      lastStudiedAt,
      nextReviewAt,
    ] = row;
    const set = setsById.get(setId);
    if (!set || !id) continue;
    set.cards.push({
      id,
      word: word ?? "",
      ipa: ipa ?? "",
      meaningVi: meaningVi ?? "",
      definitionEn: definitionEn ?? "",
      exampleEn: exampleEn ?? "",
      exampleVi: exampleVi ?? "",
      partOfSpeech: partOfSpeech || "phrase",
      level: level || "A1",
      synonyms: parseJsonList(synonyms),
      antonyms: parseJsonList(antonyms),
      status: status || "new",
      mistakeCount: Number(mistakeCount || 0),
      correctCount: Number(correctCount || 0),
      starred: starred === "TRUE" || starred === true,
      lastStudiedAt: lastStudiedAt || undefined,
      nextReviewAt: nextReviewAt || undefined,
    });
  }

  const results = (raw.results ?? []).filter((row) => row[0]).map((row) => {
    if (row[2] === "listening") {
      return {
        id: row[0],
        mode: "listening",
        accuracy: Number(row[6] || 0),
        studiedAt: row[7],
      };
    }
    return {
      id: row[0],
      setId: row[1],
      mode: row[2],
      totalQuestions: Number(row[3] || 0),
      correctAnswers: Number(row[4] || 0),
      wrongAnswers: Number(row[5] || 0),
      accuracy: Number(row[6] || 0),
      studiedAt: row[7],
      wrongCardIds: row[8] ? parseJsonList(row[8]) : undefined,
      direction: row[9] || undefined,
    };
  });

  return {
    sets: Array.from(setsById.values()),
    results,
    matchBestTimes: {},
    settings: { theme: "light", voiceURI: "" },
  };
}

export function appDataToRows(data) {
  const setRows = (data.sets ?? []).map((set) => [
    set.id,
    set.title,
    set.description,
    JSON.stringify(set.tags ?? []),
    set.createdAt,
    set.updatedAt,
    set.lastStudiedAt ?? "",
  ]);
  const cardRows = (data.sets ?? []).flatMap((set) =>
    (set.cards ?? []).map((card) => [
      set.id,
      card.id,
      card.word,
      card.ipa,
      card.meaningVi,
      card.definitionEn,
      card.exampleEn,
      card.exampleVi,
      card.partOfSpeech,
      card.level,
      JSON.stringify(card.synonyms ?? []),
      JSON.stringify(card.antonyms ?? []),
      card.status,
      card.mistakeCount,
      card.correctCount,
      card.starred ? "TRUE" : "FALSE",
      card.lastStudiedAt ?? "",
      card.nextReviewAt ?? "",
    ]),
  );
  const resultRows = (data.results ?? []).map((result) => result.mode === "listening"
    ? [result.id, "", result.mode, "", "", "", result.accuracy, result.studiedAt, "", ""]
    : [
        result.id,
        result.setId,
        result.mode,
        result.totalQuestions,
        result.correctAnswers,
        result.wrongAnswers,
        result.accuracy,
        result.studiedAt,
        result.wrongCardIds === undefined ? "" : JSON.stringify(result.wrongCardIds),
        result.direction ?? "",
      ]);
  return { setRows, cardRows, resultRows };
}

export function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function parseJsonObject(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function rowsToReadingData(raw) {
  const booksById = new Map();
  for (const row of raw.books ?? []) {
    const [id, title, sourceFileName, createdAt, lifeManagementTaskId] = row;
    if (!id) continue;
    booksById.set(id, {
      id,
      title: title ?? "",
      sourceFileName: sourceFileName ?? "",
      createdAt: createdAt || new Date().toISOString(),
      passages: [],
      lifeManagementTaskId: lifeManagementTaskId || undefined,
    });
  }

  for (const row of raw.passages ?? []) {
    const [bookId, id, order, title, text, questionsJson] = row;
    const book = booksById.get(bookId);
    if (!book || !id) continue;
    book.passages.push({
      id,
      order: Number(order || 0),
      title: title ?? "",
      text: text ?? "",
      questions: Array.isArray(parseJsonObject(questionsJson, [])) ? parseJsonObject(questionsJson, []) : [],
    });
  }
  for (const book of booksById.values()) book.passages.sort((a, b) => a.order - b.order);

  const attempts = (raw.readingAttempts ?? []).filter((row) => row[0]).map((row) => {
    const [id, bookId, bookTitle, passageId, passageTitle, startedAt, finishedAt, durationSec, answersJson, correct, total, dateKey] = row;
    return {
      id,
      bookId: bookId ?? "",
      bookTitle: bookTitle ?? "",
      passageId: passageId ?? "",
      passageTitle: passageTitle ?? "",
      startedAt: startedAt ?? "",
      finishedAt: finishedAt ?? "",
      durationSec: Number(durationSec || 0),
      answers: parseJsonObject(answersJson, {}),
      correct: Number(correct || 0),
      total: Number(total || 0),
      dateKey: dateKey ?? "",
    };
  });

  return { books: Array.from(booksById.values()), attempts };
}

export function readingDataToRows(data) {
  const bookRows = (data.books ?? []).map((book) => [
    book.id,
    book.title,
    book.sourceFileName,
    book.createdAt,
    book.lifeManagementTaskId ?? "",
  ]);
  const passageRows = (data.books ?? []).flatMap((book) =>
    (book.passages ?? []).map((passage) => [
      book.id,
      passage.id,
      passage.order,
      passage.title,
      passage.text,
      JSON.stringify(passage.questions ?? []),
    ]),
  );
  const attemptRows = (data.attempts ?? []).map((attempt) => [
    attempt.id,
    attempt.bookId,
    attempt.bookTitle,
    attempt.passageId,
    attempt.passageTitle,
    attempt.startedAt,
    attempt.finishedAt,
    attempt.durationSec,
    JSON.stringify(attempt.answers ?? {}),
    attempt.correct,
    attempt.total,
    attempt.dateKey,
  ]);
  return { bookRows, passageRows, attemptRows };
}
