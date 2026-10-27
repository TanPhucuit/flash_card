import { appDataToRows, ensureSchema, sendJson, sheetsRequest } from "../_googleSheets.js";

// Cột cuối của từng tab — dùng để xoá phần dòng dư phía dưới sau khi ghi.
const TABS = [
  { name: "sets", last: "I", key: "setRows" },
  { name: "cards", last: "R", key: "cardRows" },
  { name: "results", last: "J", key: "resultRows" },
  { name: "lists", last: "D", key: "listRows" },
];

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    await ensureSchema();
    const data = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const rows = appDataToRows(data);
    const { setRows, cardRows, resultRows, listRows } = rows;

    // Một bản "trống trơn" gần như chắc chắn là lỗi (máy vừa tải phải dữ liệu
    // rỗng, cache bị xoá...) chứ không phải ý muốn xoá sạch mọi bộ từ — từ chối
    // thay vì ghi đè lên toàn bộ dữ liệu đang có trên sheet.
    if (!setRows.length && !cardRows.length) {
      return sendJson(res, 409, { error: "Refusing to overwrite Google Sheet with empty data" });
    }

    // GHI TRƯỚC, XOÁ PHẦN DƯ SAU. Trước đây là xoá sạch rồi mới ghi: nếu bước
    // ghi gặp lỗi (hạn mức, mạng) thì sheet bị bỏ trống, và mọi máy tải trong
    // khoảng đó nhận về dữ liệu rỗng. Giờ lỗi ở bất kỳ bước nào cũng chỉ để lại
    // dữ liệu cũ nguyên vẹn hoặc dữ liệu mới, không bao giờ để trống.
    await sheetsRequest("POST", "/values:batchUpdate", {
      valueInputOption: "RAW",
      data: TABS.map((tab) => ({ range: `${tab.name}!A2:${tab.last}`, values: rows[tab.key] })),
    });
    await sheetsRequest("POST", "/values:batchClear", {
      ranges: TABS.map((tab) => `${tab.name}!A${rows[tab.key].length + 2}:${tab.last}`),
    });

    return sendJson(res, 200, { ok: true, sets: setRows.length, cards: cardRows.length, results: resultRows.length, lists: listRows.length });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Cannot save Google Sheet data" });
  }
}
