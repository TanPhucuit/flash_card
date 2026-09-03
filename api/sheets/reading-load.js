import { ensureReadingSchema, rowsToReadingData, sendJson, sheetsRequest } from "../_googleSheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    await ensureReadingSchema();
    const ranges = ["books!A2:E", "passages!A2:F", "readingAttempts!A2:L"];
    const payload = await sheetsRequest("GET", `/values:batchGet?ranges=${ranges.map(encodeURIComponent).join("&ranges=")}`);
    const [books, passages, readingAttempts] = payload.valueRanges?.map((range) => range.values ?? []) ?? [[], [], []];
    return sendJson(res, 200, rowsToReadingData({ books, passages, readingAttempts }));
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Cannot load Google Sheet reading data" });
  }
}
