// Gắn phần giải thích tiếng Việt đã soạn vào thư viện bài đọc.
// tools/explanations/<index bài>.json là map "số câu hỏi" -> giải thích.
// Dùng: node tools/mergeExplanations.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';

const LIBRARY = 'public/reading-library.json';
const DIR = 'tools/explanations';

const book = JSON.parse(fs.readFileSync(LIBRARY, 'utf8'));
let attached = 0;
let missing = 0;
const gaps = [];

book.passages.forEach((passage, index) => {
  const file = path.join(DIR, `${index}.json`);
  const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  passage.questions.forEach((question) => {
    const text = map[String(question.number)];
    if (typeof text === 'string' && text.trim()) {
      question.explanation = text.trim();
      attached += 1;
    } else {
      missing += 1;
      gaps.push(`${index}:${passage.title} q${question.number}`);
    }
  });
});

console.log(`đã gắn ${attached} giải thích, còn thiếu ${missing}`);
if (gaps.length) console.log('thiếu:', gaps.slice(0, 20).join(', '), gaps.length > 20 ? `... (+${gaps.length - 20})` : '');

if (process.argv.includes('--write')) {
  fs.writeFileSync(LIBRARY, `${JSON.stringify(book, null, 2)}\n`, 'utf8');
  console.log(`đã ghi ${LIBRARY}`);
}
