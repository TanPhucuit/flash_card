// Gom các file CSV high_level_*.csv (mỗi file 20 từ) thành public/high-level-sets.json
// để trang Settings nhập được vào app chỉ bằng một nút bấm. Id set/thẻ được đặt
// cố định theo tên file và số thứ tự, nhờ vậy nhập lại nhiều lần không tạo trùng.
//
//   node tools/buildHighLevelSets.mjs "D:/IELTS/Reading/high_level_card"
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? "D:/IELTS/Reading/high_level_card";
const OUT = "public/high-level-sets.json";
const HEADERS = ["word", "ipa", "meaningVi", "definitionEn", "exampleEn", "exampleVi", "partOfSpeech", "level"];

// Cùng quy tắc với src/utils/csv.ts (dấu ngoặc kép, "" là dấu nháy kép).
function parseCsvRows(input) {
  const rows = [];
  let row = [];
  let current = "";
  let quoted = false;
  const pushCell = () => { row.push(current.trim()); current = ""; };
  const pushRow = () => { if (row.some((cell) => cell.length > 0)) rows.push(row); row = []; };
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"' && next === '"') { current += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) pushCell();
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      pushCell();
      pushRow();
    } else current += char;
  }
  pushCell();
  pushRow();
  return rows;
}

const files = fs.readdirSync(dir).filter((f) => /^high_level_\d+_.+\.csv$/.test(f)).sort();
const sets = files.map((file) => {
  const [, number, slug] = file.match(/^high_level_(\d+)_(.+)\.csv$/);
  const rows = parseCsvRows(fs.readFileSync(path.join(dir, file), "utf8").replace(/^\uFEFF/, ""))
    .filter((values, index) => !(index === 0 && values[0].toLowerCase() === "word"));
  const cards = rows
    .map((values) => Object.fromEntries(HEADERS.map((key, i) => [key, values[i] ?? ""])))
    .filter((row) => row.word && row.meaningVi)
    .map((row, index) => ({
      id: `hl-${number}-${String(index + 1).padStart(2, "0")}`,
      word: row.word,
      ipa: row.ipa,
      meaningVi: row.meaningVi,
      definitionEn: row.definitionEn,
      exampleEn: row.exampleEn,
      exampleVi: row.exampleVi,
      partOfSpeech: row.partOfSpeech || "word",
      level: row.level || "C1",
      synonyms: [],
      antonyms: [],
      status: "new",
      mistakeCount: 0,
      correctCount: 0,
      starred: false,
    }));
  if (cards.length !== 20) throw new Error(`${file}: ${cards.length} thẻ (cần 20)`);
  return {
    id: `high-level-${number}`,
    title: `high_level_${number}_${slug}`,
    description: "Từ vựng nâng cao, thành ngữ, từ đa nghĩa và nghĩa hiếm hay gặp trong IELTS Reading (20 từ).",
    tags: ["High-Level"],
    cards,
  };
});

const total = sets.reduce((sum, set) => sum + set.cards.length, 0);
fs.writeFileSync(OUT, `${JSON.stringify({ listId: "high_level", sets }, null, 1)}\n`, "utf8");
console.log(`đã ghi ${OUT}: ${sets.length} set, ${total} thẻ`);
