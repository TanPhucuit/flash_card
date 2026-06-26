import { ensureSchema, rowsToAppData, sendJson, sheetsRequest } from "../_googleSheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    await ensureSchema();
    const ranges = ["sets!A2:G", "cards!A2:R", "results!A2:H"];
    const payload = await sheetsRequest("GET", `/values:batchGet?ranges=${ranges.map(encodeURIComponent).join("&ranges=")}`);
    const [sets, cards, results] = payload.valueRanges?.map((range) => range.values ?? []) ?? [[], [], []];
    return sendJson(res, 200, rowsToAppData({ sets, cards, results }));
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Cannot load Google Sheet data" });
  }
}
