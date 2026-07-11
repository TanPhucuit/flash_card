import { appDataToRows, ensureSchema, sendJson, sheetsRequest } from "../_googleSheets.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    await ensureSchema();
    const data = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const { setRows, cardRows, resultRows } = appDataToRows(data);

    await sheetsRequest("POST", "/values:batchClear", { ranges: ["sets!A2:G", "cards!A2:R", "results!A2:I"] });
    await sheetsRequest("POST", "/values:batchUpdate", {
      valueInputOption: "RAW",
      data: [
        { range: "sets!A2:G", values: setRows },
        { range: "cards!A2:R", values: cardRows },
        { range: "results!A2:I", values: resultRows },
      ],
    });

    return sendJson(res, 200, { ok: true, sets: setRows.length, cards: cardRows.length, results: resultRows.length });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Cannot save Google Sheet data" });
  }
}
