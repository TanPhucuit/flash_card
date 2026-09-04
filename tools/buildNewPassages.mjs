// Ghép các bài đọc mới (soạn thủ công, không sao chép nguyên văn Wikipedia) vào
// public/reading-library.json, nối tiếp 52 bài cũ. Mỗi bài nguồn nằm ở
// tools/newPassages/<NN>-<slug>.json với cấu trúc:
//   { title, sections: [{letter, text}], questions: [...] }
// questions giữ nguyên hình dạng ReadingQuestion (đã có "explanation").
// Dùng: node tools/buildNewPassages.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';

const LIBRARY = 'public/reading-library.json';
const DIR = 'tools/newPassages';

const book = JSON.parse(fs.readFileSync(LIBRARY, 'utf8'));
const existingIds = new Set(book.passages.map((p) => p.id));
const existingTitles = new Set(book.passages.map((p) => p.title.toLowerCase()));

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
let nextOrder = Math.max(...book.passages.map((p) => p.order)) + 1;
let added = 0;
const problems = [];

for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const slug = file.replace(/\.json$/, '');
  const id = `nl2-${slug}`;
  if (existingIds.has(`${id}-p1`)) continue; // đã ghép trước đó

  if (existingTitles.has(raw.title.toLowerCase())) {
    problems.push(`${file}: trùng tiêu đề với bài đã có — ${raw.title}`);
    continue;
  }
  if (!raw.sections?.length || !raw.questions?.length) {
    problems.push(`${file}: thiếu sections hoặc questions`);
    continue;
  }
  const missingExplain = raw.questions.filter((q) => q.answer && !q.explanation);
  if (missingExplain.length) {
    problems.push(`${file}: ${missingExplain.length} câu chưa có explanation`);
  }
  const numbers = raw.questions.map((q) => q.number);
  const expected = Array.from({ length: numbers.length }, (_, i) => i + 1);
  if (JSON.stringify(numbers) !== JSON.stringify(expected)) {
    problems.push(`${file}: số câu hỏi không liên tục 1..${numbers.length} — thấy ${numbers.join(',')}`);
  }

  const text = raw.sections.map((s) => `${s.letter}\n${s.text}`).join('\n\n')
    + (raw.sourceNote ? `\n\n— ${raw.sourceNote}` : '');

  const passage = {
    id: `${id}-p1`,
    order: nextOrder++,
    title: raw.title,
    text,
    questions: raw.questions.map((q, i) => ({ ...q, id: `${id}-q${i + 1}` })),
  };
  book.passages.push(passage);
  existingIds.add(id);
  existingTitles.add(raw.title.toLowerCase());
  added += 1;
}

console.log(`đã thêm ${added} bài mới, tổng cộng ${book.passages.length} bài`);
if (problems.length) {
  console.log('CẢNH BÁO:');
  problems.forEach((p) => console.log(' - ' + p));
}

if (process.argv.includes('--write')) {
  fs.writeFileSync(LIBRARY, `${JSON.stringify(book, null, 2)}\n`, 'utf8');
  console.log(`đã ghi ${LIBRARY}`);
}
