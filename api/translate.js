function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.end(JSON.stringify(body));
}

export function parseTranslation(payload) {
  if (!Array.isArray(payload?.[0])) return "";
  return payload[0]
    .map((segment) => (Array.isArray(segment) ? segment[0] : ""))
    .filter((segment) => typeof segment === "string")
    .join("")
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    const requestBody = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const text = typeof requestBody.text === "string" ? requestBody.text.trim() : "";
    if (!text) return sendJson(res, 400, { error: "Không có nội dung cần dịch." });
    if (text.length > 1500) return sendJson(res, 400, { error: "Đoạn cần dịch quá dài." });

    const form = new URLSearchParams({ client: "gtx", sl: "auto", tl: "vi", dt: "t", q: text });
    const response = await fetch("https://translate.googleapis.com/translate_a/single", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form,
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return sendJson(res, 502, { error: "Dịch vụ dịch đang tạm thời không khả dụng." });
    const translation = parseTranslation(await response.json());
    if (!translation) return sendJson(res, 502, { error: "Không thể dịch đoạn này." });
    return sendJson(res, 200, { translation });
  } catch (error) {
    console.error("Translation error", error);
    return sendJson(res, 500, { error: "Không thể tải bản dịch. Hãy thử lại." });
  }
}
