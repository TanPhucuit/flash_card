import { sendJson, sheetsRequest } from "../_googleSheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    const meta = await sheetsRequest("GET", "?includeGridData=false");
    return sendJson(res, 200, {
      ok: true,
      title: meta.properties?.title,
      sheets: (meta.sheets ?? []).map((sheet) => sheet.properties.title),
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: "Cannot connect Google Sheet" });
  }
}
