import { appDataToRows, ensureSchema, rowsToAppData, sendJson, sheetsRequest } from "../_googleSheets.js";

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

    // KẾT QUẢ HỌC chỉ được thêm, không bị một máy giữ bản cũ ghi đè mất: hợp với
    // những kết quả đang có trên sheet mà bản gửi lên chưa biết (vd. vừa học xong
    // trên điện thoại, còn máy tính đang mở bản cũ rồi lưu). Bỏ qua khi client
    // chủ động thay thế (reset tiến độ, nhập file) hoặc khi kết quả thuộc set đã
    // bị xoá.
    // Loại dòng trùng id (hai đường ghi từng chạy đua và thêm một kết quả hai lần).
    const seen = new Set();
    data.results = (data.results ?? []).filter((result) => result?.id && !seen.has(result.id) && seen.add(result.id));
    let knownIds = null;
    const incomingResultIds = new Set((data.results ?? []).map((result) => result.id));
    if (req.headers?.["x-replace-results"] !== "1") {
      const existing = await sheetsRequest("GET", `/values/${encodeURIComponent("results!A2:J")}`);
      const known = rowsToAppData({ results: existing.values ?? [] }).results;
      knownIds = new Set(known.map((result) => result.id));
      const incomingIds = new Set((data.results ?? []).map((result) => result.id));
      const setIds = new Set((data.sets ?? []).map((set) => set.id));
      const kept = known.filter((result) => !incomingIds.has(result.id) && (result.mode === "listening" || String(result.setId).split(",").some((id) => setIds.has(id))));
      if (kept.length) data.results = [...(data.results ?? []), ...kept].sort((a, b) => String(b.studiedAt).localeCompare(String(a.studiedAt)));
    }

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
    // Trong lúc ta ghi, một thiết bị khác có thể vừa NỐI THÊM một kết quả (đường
    // ghi nhanh) vào đúng phần đuôi sắp bị xoá. Đọc lại đuôi: dòng nào ta chưa
    // từng thấy thì giữ và ghi lại sau khi xoá, đừng để nó biến mất.
    let lateResultRows = [];
    if (knownIds) {
      const tail = await sheetsRequest("GET", `/values/${encodeURIComponent(`results!A${rows.resultRows.length + 2}:J`)}`);
      const seenLate = new Set();
      lateResultRows = (tail.values ?? []).filter((row) => row[0] && !knownIds.has(row[0]) && !incomingResultIds.has(row[0]) && !seenLate.has(row[0]) && seenLate.add(row[0]));
    }

    // Chỉ xoá những dải thực sự nằm trong lưới: dải bắt đầu SAU dòng cuối của
    // sheet (khi dữ liệu mới lấp đầy đúng bằng lưới) bị Google từ chối 400.
    const meta = await sheetsRequest("GET", "?fields=sheets.properties(title,gridProperties.rowCount)");
    const rowCount = new Map((meta.sheets ?? []).map((sheet) => [sheet.properties.title, sheet.properties.gridProperties?.rowCount ?? 0]));
    const leftovers = TABS.filter((tab) => rows[tab.key].length + 2 <= (rowCount.get(tab.name) ?? 0));
    if (leftovers.length) {
      await sheetsRequest("POST", "/values:batchClear", {
        ranges: leftovers.map((tab) => `${tab.name}!A${rows[tab.key].length + 2}:${tab.last}`),
      });
    }
    if (lateResultRows.length) {
      await sheetsRequest("PUT", `/values/${encodeURIComponent(`results!A${rows.resultRows.length + 2}:J`)}?valueInputOption=RAW`, { values: lateResultRows });
    }

    return sendJson(res, 200, { ok: true, sets: setRows.length, cards: cardRows.length, results: resultRows.length, lists: listRows.length });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Cannot save Google Sheet data" });
  }
}
