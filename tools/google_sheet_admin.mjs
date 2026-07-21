import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SPREADSHEET_ID = "1Ipf8xjRIwbV5pPxtsiJsYNkMKsvaY2KkVDM_pJu7m1o";
const SERVICE_ACCOUNT_FILE = "google-service-account.json";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

const SET_HEADERS = ["id", "title", "description", "tags", "createdAt", "updatedAt", "lastStudiedAt"];
const CARD_HEADERS = [
  "setId", "id", "word", "ipa", "meaningVi", "definitionEn", "exampleEn", "exampleVi",
  "partOfSpeech", "level", "synonyms", "antonyms", "status", "mistakeCount",
  "correctCount", "starred", "lastStudiedAt", "nextReviewAt",
];
const RESULT_HEADERS = ["id", "setId", "mode", "totalQuestions", "correctAnswers", "wrongAnswers", "accuracy", "studiedAt"];

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function loadCredentials() {
  if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) throw new Error(`Missing credential file: ${SERVICE_ACCOUNT_FILE}`);
  return JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, "utf8"));
}

async function accessToken() {
  const creds = loadCredentials();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: creds.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), creds.private_key).toString("base64url");
  const assertion = `${unsigned}.${signature}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Token request failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  return payload.access_token;
}

async function sheetsRequest(method, suffix, token, body) {
  const response = await fetch(`${SHEETS_BASE}/${SPREADSHEET_ID}${suffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${suffix} failed: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function metadata(token) {
  return sheetsRequest("GET", "?includeGridData=false", token);
}

function sheetTitles(meta) {
  return Object.fromEntries((meta.sheets ?? []).map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
}

async function inspect() {
  const token = await accessToken();
  const meta = await metadata(token);
  console.log(`Spreadsheet: ${meta.properties?.title ?? SPREADSHEET_ID}`);
  for (const sheet of meta.sheets ?? []) {
    const props = sheet.properties;
    console.log(`- ${props.title} id=${props.sheetId} rows=${props.gridProperties?.rowCount} cols=${props.gridProperties?.columnCount}`);
  }
}

async function values(range) {
  const token = await accessToken();
  const encodedRange = encodeURIComponent(range);
  const payload = await sheetsRequest("GET", `/values/${encodedRange}`, token);
  console.log(JSON.stringify(payload.values ?? [], null, 2));
}

async function setupSchema() {
  const token = await accessToken();
  let meta = await metadata(token);
  let titles = sheetTitles(meta);
  const addRequests = ["sets", "cards", "results"]
    .filter((title) => !(title in titles))
    .map((title) => ({ addSheet: { properties: { title } } }));

  if (addRequests.length) {
    await sheetsRequest("POST", ":batchUpdate", token, { requests: addRequests });
    meta = await metadata(token);
    titles = sheetTitles(meta);
  }

  const headerUpdates = [
    ["sets", SET_HEADERS],
    ["cards", CARD_HEADERS],
    ["results", RESULT_HEADERS],
  ];
  await sheetsRequest("POST", "/values:batchUpdate", token, {
    valueInputOption: "RAW",
    data: headerUpdates.map(([title, headers]) => ({
      range: `${title}!A1:${String.fromCharCode(64 + headers.length)}1`,
      values: [headers],
    })),
  });

  const requests = headerUpdates.flatMap(([title, headers]) => {
    const sheetId = titles[title];
    return [
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.31, green: 0.27, blue: 0.90 },
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      },
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
      { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: headers.length } } },
    ];
  });
  await sheetsRequest("POST", ":batchUpdate", token, { requests });
  console.log("Schema is ready: sets, cards, results.");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = "";
  let quoted = false;
  const pushCell = () => { row.push(current.trim()); current = ""; };
  const pushRow = () => { if (row.some((cell) => cell.length > 0)) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && next === '"') { current += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) pushCell();
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      pushCell();
      pushRow();
    } else current += char;
  }
  pushCell();
  pushRow();
  return rows;
}

function rowsToObjects(rows) {
  const [headers, ...data] = rows;
  return data.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

async function importByTopic({ clearExisting }) {
  await setupSchema();
  const token = await accessToken();
  const csvDir = path.join("exports", "by_topic");
  const files = fs.readdirSync(csvDir).filter((file) => file.endsWith(".csv")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const now = new Date().toISOString();
  const setRows = [];
  const cardRows = [];

  for (const file of files) {
    const stem = file.replace(/\.csv$/i, "");
    const title = stem.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    setRows.push([stem, title, `Imported from ${file}`, JSON.stringify(["Imported"]), now, now, ""]);
    const objects = rowsToObjects(parseCsv(fs.readFileSync(path.join(csvDir, file), "utf8").replace(/^\uFEFF/, "")));
    objects.forEach((row, index) => {
      cardRows.push([
        stem,
        `${stem}-${String(index + 1).padStart(3, "0")}`,
        row.word ?? "",
        row.ipa ?? "",
        row.meaningVi ?? "",
        row.definitionEn ?? "",
        row.exampleEn ?? "",
        row.exampleVi ?? "",
        row.partOfSpeech || "phrase",
        row.level || "IELTS",
        "[]",
        "[]",
        "new",
        0,
        0,
        "FALSE",
        "",
        "",
      ]);
    });
  }

  if (clearExisting) {
    await sheetsRequest("POST", "/values:batchClear", token, { ranges: ["sets!A2:G", "cards!A2:R", "results!A2:H"] });
  }
  await sheetsRequest("POST", "/values:batchUpdate", token, {
    valueInputOption: "RAW",
    data: [
      { range: "sets!A2:G", values: setRows },
      { range: "cards!A2:R", values: cardRows },
    ],
  });
  console.log(`Imported ${setRows.length} sets and ${cardRows.length} cards.`);
}

async function backupAndClear() {
  const token = await accessToken();
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const meta = await metadata(token);
  const titles = sheetTitles(meta);
  const requests = ["sets", "cards", "results"]
    .filter((title) => title in titles)
    .map((title) => ({
      duplicateSheet: {
        sourceSheetId: titles[title],
        newSheetName: `backup_${title}_${stamp}`,
      },
    }));
  if (requests.length) await sheetsRequest("POST", ":batchUpdate", token, { requests });
  await setupSchema();
  await sheetsRequest("POST", "/values:batchClear", token, { ranges: ["sets!A2:G", "cards!A2:R", "results!A2:H"] });
  console.log(`Backed up existing data tabs with stamp ${stamp}, then cleared sets/cards/results data rows.`);
}

const command = process.argv[2];
if (command === "inspect") await inspect();
else if (command === "values") await values(process.argv[3] ?? "sets!A1:G5");
else if (command === "setup-schema") await setupSchema();
else if (command === "import-by-topic") await importByTopic({ clearExisting: process.argv.includes("--clear-existing") });
else if (command === "backup-and-clear") await backupAndClear();
else {
  console.log("Usage: node tools/google_sheet_admin.mjs inspect|values <range>|setup-schema|import-by-topic [--clear-existing]|backup-and-clear");
  process.exit(1);
}
