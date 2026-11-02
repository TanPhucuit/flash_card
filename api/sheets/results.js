import { appDataToRows, ensureSchema, sendJson, sheetsRequest } from "../_googleSheets.js";

// Ghi NHANH một vài kết quả học vừa hoàn thành. /api/sheets/save phải ghi lại cả
// nghìn thẻ nên mất vài giây — đủ lâu để một máy khác tải lại trang trong lúc đó
// và không thấy lượt học vừa xong. Ở đây chỉ NỐI THÊM các dòng kết quả chưa có,
// không đụng tới sets/cards, nên chỉ mất khoảng một giây.
//
//   POST { results: [...] } -> { added }
export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const incoming = (Array.isArray(body.results) ? body.results : []).filter((item) => item && typeof item.id === "string" && item.id && (item.mode === "listening" || item.setId)).slice(0, 20);
    if (!incoming.length) return sendJson(res, 200, { added: 0 });

    await ensureSchema();
    const existing = await sheetsRequest("GET", `/values/${encodeURIComponent("results!A2:A")}`);
    const known = new Set((existing.values ?? []).map((row) => row[0]));
    const fresh = incoming.filter((item) => !known.has(item.id));
    if (fresh.length) {
      const { resultRows } = appDataToRows({ sets: [], results: fresh, lists: [] });
      await sheetsRequest("POST", `/values/${encodeURIComponent("results!A2:J")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: resultRows });
    }
    return sendJson(res, 200, { added: fresh.length });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Cannot append results" });
  }
}
