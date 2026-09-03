import { ensureReadingSchema, readingDataToRows, sendJson, sheetsRequest } from "../_googleSheets.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    await ensureReadingSchema();
    const data = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const { bookRows, passageRows, attemptRows } = readingDataToRows(data);

    await sheetsRequest("POST", "/values:batchClear", { ranges: ["books!A2:E", "passages!A2:F", "readingAttempts!A2:L"] });
    await sheetsRequest("POST", "/values:batchUpdate", {
      valueInputOption: "RAW",
      data: [
        { range: "books!A2:E", values: bookRows },
        { range: "passages!A2:F", values: passageRows },
        { range: "readingAttempts!A2:L", values: attemptRows },
      ],
    });

    return sendJson(res, 200, { ok: true, books: bookRows.length, passages: passageRows.length, attempts: attemptRows.length });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Cannot save Google Sheet reading data" });
  }
}
