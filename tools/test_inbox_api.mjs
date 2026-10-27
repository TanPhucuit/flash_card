// Kiểm thử api/sheets/inbox.js với Google Sheet thật. Chỉ ghi các dòng có id
// bắt đầu bằng "selftest-" rồi đánh dấu đã nhận; không đụng tới dòng khác.
import fs from "node:fs";

const creds = JSON.parse(fs.readFileSync("google-service-account.json", "utf8"));
process.env.GOOGLE_SHEET_ID = "1Ipf8xjRIwbV5pPxtsiJsYNkMKsvaY2KkVDM_pJu7m1o";
process.env.GOOGLE_CLIENT_EMAIL = creds.client_email;
process.env.GOOGLE_PRIVATE_KEY = creds.private_key;

const handler = (await import("../api/sheets/inbox.js")).default;
async function call(req) {
  const res = { statusCode: 200, setHeader() {}, end(value) { this.body = value; } };
  await handler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

const ids = [`selftest-${Date.now()}-a`, `selftest-${Date.now()}-b`];
const words = [
  { id: ids[0], word: "ubiquitous", meaningVi: "có mặt khắp nơi", sourceUrl: "https://example.com/a", sourceTitle: "Example" },
  { id: ids[1], word: "x".repeat(500), meaningVi: "quá dài", sourceUrl: "" },
  { id: "", word: "no id", meaningVi: "bị bỏ" },
  { id: "selftest-nomeaning", word: "nomeaning", meaningVi: "" },
];

const add1 = await call({ method: "POST", body: { words } });
console.log("append", add1.status, add1.body);
const add2 = await call({ method: "POST", body: JSON.stringify({ words: [words[0]] }) });
console.log("append lại (phải là trùng)", add2.status, add2.body);
const pending = await call({ method: "GET" });
const mine = pending.body.items.filter((item) => item.id.startsWith("selftest-"));
console.log("pending", pending.status, mine.map((item) => `${item.id.slice(-1)}:${item.word.slice(0, 12)}(${item.word.length})=${item.meaningVi}`));
const eaten = await call({ method: "POST", body: { consume: ids } });
console.log("consume", eaten.status, eaten.body);
const again = await call({ method: "POST", body: { consume: ids } });
console.log("consume lần 2 (phải là 0)", again.body);
const after = await call({ method: "GET" });
console.log("còn pending của selftest:", after.body.items.filter((item) => item.id.startsWith("selftest-")).length);
console.log("PUT", (await call({ method: "PUT" })).status);
