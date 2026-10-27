import { ensureTabs, sendJson, sheetsRequest } from "../_googleSheets.js";

// Hộp thư từ mới do tiện ích mở rộng của trình duyệt gửi tới. Cố tình tách khỏi
// các tab sets/cards: /api/sheets/save ghi đè TOÀN BỘ dữ liệu từ trạng thái của
// app, nên nếu extension chèn thẳng thẻ vào đó thì bản app đang mở (cũ hơn) sẽ
// xoá mất chúng ở lần lưu kế tiếp. Ở đây chỉ NỐI THÊM dòng và ĐÁNH DẤU đã nhận,
// không bao giờ xoá/ghi lại dòng nào, nên nhiều thiết bị không giẫm lên nhau.
//
//   GET                       -> { items: [chưa nhận] }
//   POST { words: [...] }     -> nối thêm (bỏ qua id đã có)
//   POST { consume: [ids] }   -> đánh dấu các id đã được app nhận
const TAB = "word_inbox";
const HEADERS = ["id", "word", "meaningVi", "sourceUrl", "sourceTitle", "addedAt", "consumedAt"];
const RANGE = `${TAB}!A2:G`;
const MAX_WORD = 120;
const MAX_MEANING = 300;
const MAX_URL = 500;

const ensureTab = () => ensureTabs([{ title: TAB, lastColumn: "G", headers: HEADERS }]);

/** Mọi dòng kèm số dòng thật trong sheet (dòng 1 là tiêu đề). */
async function readRows() {
  const payload = await sheetsRequest("GET", `/values/${encodeURIComponent(RANGE)}`);
  return (payload.values ?? []).map((row, index) => ({
    rowNumber: index + 2,
    id: row[0] ?? "",
    word: row[1] ?? "",
    meaningVi: row[2] ?? "",
    sourceUrl: row[3] ?? "",
    sourceTitle: row[4] ?? "",
    addedAt: row[5] ?? "",
    consumedAt: row[6] ?? "",
  }));
}

const clip = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function cleanWord(raw) {
  const id = clip(raw?.id, 80);
  const word = clip(raw?.word, MAX_WORD);
  const meaningVi = clip(raw?.meaningVi, MAX_MEANING);
  if (!id || !word || !meaningVi) return null;
  return {
    id,
    word,
    meaningVi,
    sourceUrl: clip(raw?.sourceUrl, MAX_URL),
    sourceTitle: clip(raw?.sourceTitle, MAX_MEANING),
  };
}

export default async function handler(req, res) {
  try {
    await ensureTab();
    if (req.method === "GET") {
      const rows = await readRows();
      const items = rows
        .filter((row) => row.id && !row.consumedAt)
        .map(({ rowNumber, consumedAt, ...item }) => item);
      return sendJson(res, 200, { items });
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

    const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const rows = await readRows();

    if (Array.isArray(body.consume)) {
      const ids = new Set(body.consume.filter((id) => typeof id === "string"));
      const stamp = new Date().toISOString();
      const targets = rows.filter((row) => ids.has(row.id) && !row.consumedAt);
      if (targets.length) {
        await sheetsRequest("POST", "/values:batchUpdate", {
          valueInputOption: "RAW",
          data: targets.map((row) => ({ range: `${TAB}!G${row.rowNumber}`, values: [[stamp]] })),
        });
      }
      return sendJson(res, 200, { consumed: targets.length });
    }

    const incoming = (Array.isArray(body.words) ? body.words : []).map(cleanWord).filter(Boolean).slice(0, 50);
    const known = new Set(rows.map((row) => row.id));
    const fresh = incoming.filter((item) => !known.has(item.id));
    if (fresh.length) {
      const now = new Date().toISOString();
      await sheetsRequest("POST", `/values/${encodeURIComponent(RANGE)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        values: fresh.map((item) => [item.id, item.word, item.meaningVi, item.sourceUrl, item.sourceTitle, now, ""]),
      });
    }
    return sendJson(res, 200, { added: fresh.length, duplicates: incoming.length - fresh.length });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Cannot access the word inbox" });
  }
}
