import { sendJson, sheetsRequest } from "../_googleSheets.js";

// Lịch sử làm bài Reading, dùng chung cho mọi thiết bị. Trước đây nó chỉ nằm
// trong localStorage của từng trình duyệt, nên điện thoại không thấy những bài
// đã làm trên máy tính và ngược lại.
//
// POST GỘP theo id chứ không ghi đè: hai thiết bị cùng đẩy lên thì không máy
// nào xoá mất bài làm của máy kia.
const TAB = "reading_attempts";
const HEADERS = ["id", "bookId", "bookTitle", "passageId", "passageTitle", "startedAt", "finishedAt", "durationSec", "answers", "correct", "total", "dateKey"];
const RANGE = `${TAB}!A2:L`;

async function ensureTab() {
  const meta = await sheetsRequest("GET", "?includeGridData=false");
  const exists = (meta.sheets ?? []).some((sheet) => sheet.properties.title === TAB);
  if (!exists) {
    await sheetsRequest("POST", ":batchUpdate", { requests: [{ addSheet: { properties: { title: TAB } } }] });
    await sheetsRequest("POST", "/values:batchUpdate", {
      valueInputOption: "RAW",
      data: [{ range: `${TAB}!A1:L1`, values: [HEADERS] }],
    });
  }
}

function rowToAttempt(row) {
  const [id, bookId, bookTitle, passageId, passageTitle, startedAt, finishedAt, durationSec, answers, correct, total, dateKey] = row;
  if (!id || !passageId) return null;
  let parsedAnswers = {};
  try {
    const value = JSON.parse(answers || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) parsedAnswers = value;
  } catch {
    parsedAnswers = {};
  }
  return {
    id,
    bookId: bookId ?? "",
    bookTitle: bookTitle ?? "",
    passageId,
    passageTitle: passageTitle ?? "",
    startedAt: startedAt ?? "",
    finishedAt: finishedAt ?? "",
    durationSec: Number(durationSec) || 0,
    answers: parsedAnswers,
    correct: Number(correct) || 0,
    total: Number(total) || 0,
    dateKey: dateKey ?? "",
  };
}

function attemptToRow(attempt) {
  return [
    attempt.id,
    attempt.bookId ?? "",
    attempt.bookTitle ?? "",
    attempt.passageId,
    attempt.passageTitle ?? "",
    attempt.startedAt ?? "",
    attempt.finishedAt ?? "",
    Number(attempt.durationSec) || 0,
    JSON.stringify(attempt.answers ?? {}),
    Number(attempt.correct) || 0,
    Number(attempt.total) || 0,
    attempt.dateKey ?? "",
  ];
}

async function readAttempts() {
  const payload = await sheetsRequest("GET", `/values/${encodeURIComponent(RANGE)}`);
  return (payload.values ?? []).map(rowToAttempt).filter(Boolean);
}

export default async function handler(req, res) {
  try {
    await ensureTab();
    if (req.method === "GET") {
      return sendJson(res, 200, { attempts: await readAttempts() });
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

    const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const incoming = Array.isArray(body.attempts) ? body.attempts.filter((item) => item && item.id && item.passageId) : [];
    const existing = await readAttempts();
    const known = new Set(existing.map((attempt) => attempt.id));
    const fresh = incoming.filter((attempt) => !known.has(attempt.id));

    if (fresh.length) {
      // Chỉ nối thêm dòng mới — không xoá/ghi lại những dòng đã có, nên một
      // thiết bị có dữ liệu cũ hơn cũng không thể làm mất bài của thiết bị khác.
      await sheetsRequest("POST", `/values/${encodeURIComponent(RANGE)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        values: fresh.map(attemptToRow),
      });
    }
    const merged = [...existing, ...fresh];
    return sendJson(res, 200, { attempts: merged, added: fresh.length });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Cannot sync reading attempts" });
  }
}
