import fs from "node:fs";

const creds = JSON.parse(fs.readFileSync("google-service-account.json", "utf8"));
process.env.GOOGLE_SHEET_ID = "1Ipf8xjRIwbV5pPxtsiJsYNkMKsvaY2KkVDM_pJu7m1o";
process.env.GOOGLE_CLIENT_EMAIL = creds.client_email;
process.env.GOOGLE_PRIVATE_KEY = creds.private_key;

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      this.body = value;
    },
  };
}

async function call(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

const health = (await import("../api/sheets/health.js")).default;
const load = (await import("../api/sheets/load.js")).default;
const save = (await import("../api/sheets/save.js")).default;

const healthResult = await call(health, { method: "GET" });
console.log("health", healthResult.statusCode, healthResult.body);

const loadResult = await call(load, { method: "GET" });
console.log("load", loadResult.statusCode, {
  sets: loadResult.body.sets?.length,
  cards: loadResult.body.sets?.reduce((sum, set) => sum + set.cards.length, 0),
  results: loadResult.body.results?.length,
  firstSet: loadResult.body.sets?.[0]?.title,
});

const now = new Date().toISOString();
const testData = {
  sets: [{
    id: "api_test_set",
    title: "API Test Set",
    description: "Temporary test data",
    tags: ["Test"],
    createdAt: now,
    updatedAt: now,
    cards: [{
      id: "api_test_card",
      word: "test",
      ipa: "",
      meaningVi: "kiểm tra",
      definitionEn: "a temporary verification item",
      exampleEn: "",
      exampleVi: "",
      partOfSpeech: "noun",
      level: "A1",
      synonyms: [],
      antonyms: [],
      status: "new",
      mistakeCount: 0,
      correctCount: 0,
      starred: false,
    }],
  }],
  results: [],
  settings: { theme: "light", voiceURI: "" },
  matchBestTimes: {},
};
const saveResult = await call(save, { method: "POST", body: testData });
console.log("save", saveResult.statusCode, saveResult.body);

const afterSave = await call(load, { method: "GET" });
console.log("afterSave", afterSave.statusCode, {
  sets: afterSave.body.sets?.length,
  cards: afterSave.body.sets?.reduce((sum, set) => sum + set.cards.length, 0),
  firstSet: afterSave.body.sets?.[0]?.title,
});

const clearResult = await call(save, {
  method: "POST",
  body: { sets: [], results: [], settings: { theme: "light", voiceURI: "" }, matchBestTimes: {} },
});
console.log("clear", clearResult.statusCode, clearResult.body);
