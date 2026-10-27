import crypto from "node:crypto";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export const SET_HEADERS = ["id", "title", "description", "tags", "createdAt", "updatedAt", "lastStudiedAt", "listId", "lifeManagementTaskIds"];
export const LIST_HEADERS = ["id", "title", "createdAt", "lifeManagementTaskId"];
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

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

// Token Google sống 1 giờ — dùng lại giữa các request trong cùng một instance
// thay vì ký JWT + gọi oauth2 cho MỖI request (tốn thời gian và hạn mức).
let cachedToken = { value: "", expiresAt: 0 };

async function getAccessToken() {
  if (cachedToken.value && Date.now() < cachedToken.expiresAt) return cachedToken.value;
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
  const token = await response.json();
  cachedToken = { value: token.access_token, expiresAt: Date.now() + Math.max(60, (token.expires_in ?? 3600) - 300) * 1000 };
  return token.access_token;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Google Sheets hay trả 429 (vượt hạn mức đọc/ghi theo phút) hoặc 5xx thoáng
// qua. Thử lại vài lần với thời gian chờ tăng dần thay vì trả lỗi 500 ngay cho
// người dùng; tổng thời gian chờ giữ dưới giới hạn của hàm serverless.
export async function sheetsRequest(method, suffix, body) {
  const spreadsheetId = env("GOOGLE_SHEET_ID");
  const delays = [400, 1200, 2500];
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      const token = await getAccessToken();
      response = await fetch(`${SHEETS_BASE}/${spreadsheetId}${suffix}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (attempt >= delays.length) throw error;
      await sleep(delays[attempt]);
      continue;
    }
    if (response.status === 401) cachedToken = { value: "", expiresAt: 0 };
    if (!response.ok) {
      if ((RETRYABLE.has(response.status) || response.status === 401) && attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
      throw new Error(`Google Sheets ${method} ${suffix} failed: ${response.status} ${await response.text()}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
}

// Danh sách tab đã tồn tại, nhớ trong 10 phút: trước đây MỌI request đều đọc
// metadata (và ensureSchema còn ghi lại hàng tiêu đề) — 2–3 lệnh gọi Google
// thừa cho mỗi lần tải/lưu.
const knownTabs = new Set();
let tabsCheckedAt = 0;

/** Tạo các tab còn thiếu (kèm hàng tiêu đề) — chỉ gọi Google khi chưa kiểm tra gần đây. */
export async function ensureTabs(tabs) {
  const fresh = Date.now() - tabsCheckedAt < 10 * 60 * 1000;
  if (fresh && tabs.every((tab) => knownTabs.has(tab.title))) return;
  const meta = await sheetsRequest("GET", "?includeGridData=false&fields=sheets.properties.title");
  for (const sheet of meta.sheets ?? []) knownTabs.add(sheet.properties.title);
  const missing = tabs.filter((tab) => !knownTabs.has(tab.title));
  if (missing.length) {
    await sheetsRequest("POST", ":batchUpdate", {
      requests: missing.map((tab) => ({ addSheet: { properties: { title: tab.title } } })),
    });
    await sheetsRequest("POST", "/values:batchUpdate", {
      valueInputOption: "RAW",
      data: missing.map((tab) => ({ range: `${tab.title}!A1:${tab.lastColumn}1`, values: [tab.headers] })),
    });
    missing.forEach((tab) => knownTabs.add(tab.title));
  }
  tabsCheckedAt = Date.now();
}

export async function ensureSchema() {
  await ensureTabs([
    { title: "sets", lastColumn: "I", headers: SET_HEADERS },
    { title: "cards", lastColumn: "R", headers: CARD_HEADERS },
    { title: "results", lastColumn: "J", headers: RESULT_HEADERS },
    { title: "lists", lastColumn: "D", headers: LIST_HEADERS },
  ]);
}

/** Cột lưu map "chế độ -> taskId" dưới dạng JSON, nên phải đọc ra object. */
function parseJsonObject(value) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
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
    const [id, title, description, tags, createdAt, updatedAt, lastStudiedAt, listId, lifeManagementTaskIds] = row;
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
      listId: listId || undefined,
      lifeManagementTaskIds: parseJsonObject(lifeManagementTaskIds),
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

  const lists = (raw.lists ?? []).filter((row) => row[0]).map((row) => ({
    id: row[0],
    title: row[1] ?? "",
    createdAt: row[2] || new Date().toISOString(),
    lifeManagementTaskId: row[3] || undefined,
  }));

  return {
    sets: Array.from(setsById.values()),
    results,
    matchBestTimes: {},
    lists,
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
    set.listId ?? "",
    set.lifeManagementTaskIds ? JSON.stringify(set.lifeManagementTaskIds) : "",
  ]);
  const listRows = (data.lists ?? []).map((list) => [list.id, list.title, list.createdAt, list.lifeManagementTaskId ?? ""]);
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
  return { setRows, cardRows, resultRows, listRows };
}

export function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}
