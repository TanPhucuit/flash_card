// Dựng public/quiz-sets.json từ tools/quizSets/*.xlsx.
//
// Mỗi file Excel = một bộ trắc nghiệm = một set. Sheet "Danh Sách Câu Hỏi" có hàng
// tiêu đề bắt đầu bằng "STT" (cùng bố cục file Nhom10-WebService-Quiz.xlsx):
//   STT | Chủ Đề / Mức Độ | Câu Hỏi | Lựa Chọn A | B | C | D | Đáp Án Đúng (A-D) | Giải Thích | Ghi Chú
// Sheet "Thông Tin" cho tên bộ và mô tả.
//
// Mỗi câu thành MỘT thẻ, mã hoá vào các cột sẵn có (xem src/utils/quiz.ts):
//   word = câu hỏi | meaningVi = đáp án đúng | definitionEn = giải thích
//   synonyms = mọi lựa chọn theo thứ tự gốc | level = chủ đề | partOfSpeech = "quiz"
//
// Sửa nội dung: sửa file Excel trong tools/quizSets rồi chạy lại
//   node tools/buildQuizSets.mjs
// Id set và id thẻ cố định, nhưng "Nhập" trong Settings chỉ thêm set còn thiếu —
// muốn nạp bản đã sửa thì xoá set cũ trong app trước.
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const DIR = "tools/quizSets";
const OUT = "public/quiz-sets.json";
const LIST_ID = "quiz_midterm";
const LETTERS = "ABCD";

const clean = (value) => String(value ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

function sheetRows(workbook, name, file) {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`${file}: thiếu sheet "${name}"`);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
}

function readSet(file) {
  const workbook = XLSX.read(fs.readFileSync(path.join(DIR, file)), { type: "buffer" });

  const info = new Map(sheetRows(workbook, "Thông Tin", file).map((row) => [clean(row[0]), clean(row[1])]));
  const title = info.get("Tên bộ");
  const description = info.get("Mô tả") ?? "";
  if (!title) throw new Error(`${file}: sheet "Thông Tin" thiếu "Tên bộ"`);

  const rows = sheetRows(workbook, "Danh Sách Câu Hỏi", file);
  const header = rows.findIndex((row) => clean(row[0]) === "STT");
  if (header < 0) throw new Error(`${file}: không thấy hàng tiêu đề "STT"`);

  const slug = file.split("_")[0].toLowerCase();
  const setId = `quiz-midterm-${slug}`;
  const problems = [];
  const cards = [];
  const seenQuestions = new Set();

  rows.slice(header + 1).forEach((row, index) => {
    const label = `${file} dòng ${header + index + 2}`;
    const number = Number(row[0]);
    const question = clean(row[2]);
    const options = [row[3], row[4], row[5], row[6]].map(clean);
    const letter = clean(row[7]).toUpperCase();
    if (!question) { problems.push(`${label}: thiếu câu hỏi`); return; }
    if (!Number.isInteger(number) || number < 1) problems.push(`${label}: STT không hợp lệ (${row[0]})`);

    // Lựa chọn phải liền nhau từ A (câu Đúng/Sai chỉ có A, B).
    const used = options.findIndex((option) => !option) === -1 ? 4 : options.findIndex((option) => !option);
    if (options.slice(used).some(Boolean)) problems.push(`${label}: lựa chọn bị ngắt quãng`);
    const choices = options.slice(0, used);
    if (choices.length < 2) { problems.push(`${label}: cần ít nhất 2 lựa chọn`); return; }
    if (new Set(choices).size !== choices.length) problems.push(`${label}: có lựa chọn trùng nhau`);

    const answerIndex = LETTERS.indexOf(letter);
    if (answerIndex < 0 || answerIndex >= choices.length) { problems.push(`${label}: đáp án "${letter}" không nằm trong ${choices.length} lựa chọn`); return; }
    if (seenQuestions.has(question)) problems.push(`${label}: câu hỏi trùng`);
    seenQuestions.add(question);

    cards.push({
      id: `${setId}-q${String(number).padStart(2, "0")}`,
      word: question,
      ipa: "",
      meaningVi: choices[answerIndex],
      definitionEn: clean(row[8]),
      exampleEn: "",
      exampleVi: "",
      partOfSpeech: "quiz",
      level: clean(row[1]) || "Quiz",
      synonyms: choices,
      antonyms: [],
      status: "new",
      mistakeCount: 0,
      correctCount: 0,
      starred: false,
    });
  });

  if (!cards.length) problems.push(`${file}: không có câu hỏi nào`);
  const ids = new Set(cards.map((card) => card.id));
  if (ids.size !== cards.length) problems.push(`${file}: STT bị trùng`);
  return { set: { id: setId, title, description, tags: ["Quiz", "Giữa kỳ"], cards }, problems };
}

const files = fs.readdirSync(DIR).filter((name) => name.toLowerCase().endsWith(".xlsx") && !name.startsWith("~$")).sort();
if (!files.length) throw new Error(`Không có file .xlsx nào trong ${DIR}`);

const sets = [];
const allProblems = [];
for (const file of files) {
  const { set, problems } = readSet(file);
  sets.push(set);
  allProblems.push(...problems);
  console.log(`${String(set.cards.length).padStart(3)} câu  ${set.title}`);
}
if (new Set(sets.map((set) => set.id)).size !== sets.length) allProblems.push("Id set bị trùng giữa các file");

if (allProblems.length) {
  console.error(`\n${allProblems.length} vấn đề:`);
  allProblems.forEach((problem) => console.error(`  - ${problem}`));
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify({ listId: LIST_ID, sets }));
const total = sets.reduce((sum, set) => sum + set.cards.length, 0);
console.log(`\nĐã ghi ${OUT}: ${sets.length} bộ, ${total} câu (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
