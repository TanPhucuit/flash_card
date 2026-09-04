// Đổ MỘT bài đọc ra dạng dễ đọc để soạn phần giải thích: nguyên văn bài, rồi
// danh sách câu hỏi kèm đáp án đúng. Dùng: node tools/dumpPassage.mjs <index>
import fs from 'node:fs';

const book = JSON.parse(fs.readFileSync('public/reading-library.json', 'utf8'));
const index = Number(process.argv[2]);
const passage = book.passages[index];

console.log(`### [${index}] ${passage.title}\n`);
console.log(passage.text);
console.log('\n--- QUESTIONS ---');

let lastInstruction = '';
for (const q of passage.questions) {
  if (q.instruction && q.instruction !== lastInstruction) {
    console.log(`\n[RUBRIC] ${q.instruction}\n`);
    lastInstruction = q.instruction;
  }
  const opts = q.options?.length && q.options.some((o) => o.length > 4) ? `\n     options: ${q.options.join(' | ')}` : '';
  console.log(`${q.number}. (${q.type}) ${q.prompt}${opts}\n     => ${q.answer}   [id ${q.id}]`);
}
