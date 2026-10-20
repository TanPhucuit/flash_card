// Gọi thử api/sheets/reading.js với Google Sheet thật (chỉ GET và POST rỗng —
// không ghi bài làm giả vào dữ liệu thật). Cần google-service-account.json.
import fs from "node:fs";

const creds = JSON.parse(fs.readFileSync("google-service-account.json", "utf8"));
process.env.GOOGLE_SHEET_ID = "1Ipf8xjRIwbV5pPxtsiJsYNkMKsvaY2KkVDM_pJu7m1o";
process.env.GOOGLE_CLIENT_EMAIL = creds.client_email;
process.env.GOOGLE_PRIVATE_KEY = creds.private_key;

const handler = (await import("../api/sheets/reading.js")).default;
async function call(req) {
  const res = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = v; } };
  await handler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

const get = await call({ method: "GET" });
console.log("GET", get.status, "attempts:", get.body.attempts?.length, get.body.error ?? "");
const post = await call({ method: "POST", body: { attempts: [] } });
console.log("POST (rỗng)", post.status, "added:", post.body.added, "total:", post.body.attempts?.length, post.body.error ?? "");
const bad = await call({ method: "PUT" });
console.log("PUT", bad.status);
