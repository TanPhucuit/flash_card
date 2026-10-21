// Builds IELTS-style passages from compact source files in tools/ieltsPassages
// and appends them to public/reading-library.json (ids "nl3-...").
//
// Source file shape:
//   { title, sourceNote, sections: [{ letter, text }], groups: [Group, ...] }
// Group kinds (each group becomes one "Questions x-y" block):
//   headings  { headings: [{ text, para: "B" | null }], explain: { B: "..." } }
//             explanations may use {h} (this paragraph's numeral) and {i:n}
//             (numeral of headings[n]) because the list is shuffled here.
//   matchinfo { items: [{ q, a: "D", e }] }                 paragraph letters
//   features  { listTitle, people: ["..."], items: [{ q, a: <index into people>, e }] }
//   endings   { endings: ["..."], items: [{ q, a: <index into endings>, e }] }
//   wordbank  { title, words: ["..."], items: [{ q, a: <index into words>, e }] }
//   tfng/ynng { items: [{ q, a: "TRUE" | "FALSE" | "NOT GIVEN" (YES/NO...), e }] }
//   mcq       { items: [{ q, options: ["...", x4], a: <index>, e }] }
//   gap       { form: "sentences" | "notes" | "summary" | "table", title?, limit, items: [{ q, a, e }] }
//   short     { limit, items: [{ q, a, e }] }
// People, endings, words and mcq options are shuffled here, so explanations
// must cite their content, never a letter.
//
// Usage: node tools/buildIeltsPassages.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';

const LIBRARY = 'public/reading-library.json';
const DIR = 'tools/ieltsPassages';
const ROM = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
const LETTERS = 'ABCDEFGHIJKL'.split('');
const LIMIT_WORDS = { ONE: 1, TWO: 2, THREE: 3 };

const book = JSON.parse(fs.readFileSync(LIBRARY, 'utf8'));
const existingTitles = new Set(book.passages.map((p) => p.title.toLowerCase()));
const existingIds = new Set(book.passages.map((p) => p.id));

const wc = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (s) => s.toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ');

function shuffled(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const isMonotonic = (idx) =>
  idx.length >= 3 && (idx.every((v, i) => i === 0 || v > idx[i - 1]) || idx.every((v, i) => i === 0 || v < idx[i - 1]));
const isProgression = (idx) => idx.length >= 3 && idx.every((v, i) => i < 2 || v - idx[i - 1] === idx[1] - idx[0]);
const predictable = (idx) => isMonotonic(idx) || isProgression(idx) || (idx.length >= 3 && new Set(idx).size === 1);

// Shuffle a list so that the resulting answer letters do not form an easy pattern.
function shuffleForAnswers(n, answerIdx) {
  for (let tries = 0; tries < 5000; tries += 1) {
    const order = shuffled(n); // order[newPos] = oldIdx
    const newPos = new Array(n);
    order.forEach((oldIdx, pos) => { newPos[oldIdx] = pos; });
    const mapped = answerIdx.map((i) => newPos[i]);
    if (!predictable(mapped) || n < 3) return { order, newPos };
  }
  throw new Error('could not find an unpredictable order');
}

const mcqLetterCount = {};
const range = (a, b) => (a === b ? `Question ${a}` : `Questions ${a}-${b}`);

function buildPassage(file, raw, problems) {
  const letters = raw.sections.map((s) => s.letter);
  const lastLetter = letters[letters.length - 1];
  const paraCount = letters.length;
  const text = raw.sections.map((s) => `${s.letter}\n${s.text}`).join('\n\n');
  const lowerText = norm(text);
  const questions = [];
  let n = 1;

  const push = (q) => { questions.push({ ...q, number: n }); n += 1; };
  // Độ dài cụm dài nhất mà câu hỏi chép nguyên văn từ bài. IELTS thật chủ yếu
  // diễn đạt lại (đồng nghĩa, đổi cấu trúc) để buộc người đọc nhận ra hai cách
  // nói cùng một ý; chỉ vài câu dễ giữ gần nguyên văn.
  const toWords = (s) => norm(s).replace(/_{3,}/g, ' ').replace(/\((first|second|third) letter\)/g, ' ').replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  const textJoined = ` ${toWords(text).join(' ')} `;
  const longestRun = (prompt) => {
    const words = toWords(prompt);
    let best = 0;
    let bestText = '';
    for (let i = 0; i < words.length; i += 1) {
      for (let j = i + best + 1; j <= words.length; j += 1) {
        const piece = words.slice(i, j).join(' ');
        if (!textJoined.includes(` ${piece} `)) break;
        best = j - i;
        bestText = piece;
      }
    }
    return { best, bestText };
  };
  const need = (cond, msg) => { if (!cond) problems.push(`${file}: ${msg}`); };

  // --- structure checks
  const total = raw.sections.reduce((sum, s) => sum + wc(s.text), 0);
  need(total >= 700 && total <= 950, `độ dài ${total} từ (cần 700-950)`);
  raw.sections.forEach((s) => {
    const w = wc(s.text);
    need(w >= 60 && w <= 180, `đoạn ${s.letter} dài ${w} từ (cần 60-180)`);
  });
  need(paraCount >= 6 && paraCount <= 8, `${paraCount} đoạn (cần 6-8)`);

  for (const g of raw.groups) {
    const start = n;
    const count = g.kind === 'headings'
      ? g.headings.filter((h) => h.para).length
      : g.kind === 'mcq2' || g.kind === 'mcq3'
        ? g.items.reduce((sum, it) => sum + it.a.length, 0)
        : g.items.length;
    const end = start + count - 1;
    const head = range(start, end);

    if (g.kind === 'headings') {
      const assigned = g.headings.map((h, i) => ({ ...h, i })).filter((h) => h.para)
        .sort((a, b) => letters.indexOf(a.para) - letters.indexOf(b.para));
      need(g.headings.length > assigned.length, 'headings: cần nhiều heading hơn số đoạn');
      const { order, newPos } = shuffleForAnswers(g.headings.length, assigned.map((h) => h.i));
      const numeralOf = (i) => ROM[newPos[i]];
      const list = order.map((oldIdx, pos) => `${ROM[pos]}\t${g.headings[oldIdx].text}`).join('\n');
      const instruction = `${head}\nReading Passage has ${paraCount} paragraphs, A-${lastLetter}.\nChoose the correct heading for ${assigned.length === paraCount ? 'each paragraph' : `paragraphs ${assigned[0].para}-${assigned[assigned.length - 1].para}`} from the list of headings below.\nWrite the correct number, i-${ROM[g.headings.length - 1]}, as your answer.\n\nList of Headings\n${list}`;
      assigned.forEach((h, k) => {
        const e = (g.explain?.[h.para] ?? '')
          .replace(/\{h\}/g, numeralOf(h.i))
          .replace(/\{i:(\d+)\}/g, (_, d) => numeralOf(Number(d)));
        need(e, `headings: thiếu giải thích đoạn ${h.para}`);
        push({ type: 'matching', instruction: k === 0 ? instruction : undefined, prompt: `Paragraph ${h.para}`, options: ROM.slice(0, g.headings.length), answer: numeralOf(h.i), explanation: e });
      });
    } else if (g.kind === 'matchinfo') {
      const instruction = `${head}\nReading Passage has ${paraCount} paragraphs, A-${lastLetter}.\nWhich paragraph contains the following information?\nWrite the correct letter, A-${lastLetter}, as your answer.\nNB You may use any letter more than once.`;
      need(!predictable(g.items.map((it) => letters.indexOf(it.a))), 'matchinfo: đáp án theo quy luật dễ đoán');
      g.items.forEach((it, k) => {
        need(letters.includes(it.a), `matchinfo: đáp án ${it.a} không phải đoạn hợp lệ`);
        push({ type: 'matching', instruction: k === 0 ? instruction : undefined, prompt: it.q, options: letters, answer: it.a, explanation: it.e });
      });
    } else if (g.kind === 'features' || g.kind === 'endings' || g.kind === 'wordbank') {
      const listItems = g.kind === 'features' ? g.people : g.kind === 'endings' ? g.endings : g.words;
      const { order, newPos } = shuffleForAnswers(listItems.length, g.items.map((it) => it.a));
      const L = LETTERS.slice(0, listItems.length);
      const list = order.map((oldIdx, pos) => `${L[pos]}\t${listItems[oldIdx]}`).join('\n');
      const lastL = L[L.length - 1];
      let instruction;
      if (g.kind === 'features') {
        instruction = `${head}\nLook at the following statements and the list of ${(g.listTitle ?? 'people').toLowerCase()} below.\nMatch each statement with the correct ${g.singular ?? 'person'}, A-${lastL}.\nWrite the correct letter, A-${lastL}, as your answer.\nNB You may use any letter more than once.\n\nList of ${g.listTitle ?? 'People'}\n${list}`;
        need(listItems.length >= 3, 'features: cần ít nhất 3 người');
      } else if (g.kind === 'endings') {
        instruction = `${head}\nComplete each sentence with the correct ending, A-${lastL}, below.\nWrite the correct letter, A-${lastL}, as your answer.\n\n${list}`;
        need(listItems.length > g.items.length, 'endings: cần nhiều phần kết hơn số câu');
      } else {
        instruction = `${head}\nComplete the ${g.form ?? 'summary'} using the list of words, A-${lastL}, below.\nWrite the correct letter, A-${lastL}, as your answer.\n\n${g.title ? `${g.title}\n\n` : ''}${list}`;
        need(listItems.length > g.items.length, 'wordbank: cần nhiều từ hơn số chỗ trống');
      }
      g.items.forEach((it, k) => {
        need(Number.isInteger(it.a) && it.a >= 0 && it.a < listItems.length, `${g.kind}: chỉ số đáp án sai ở câu "${it.q.slice(0, 30)}"`);
        push({ type: 'matching', instruction: k === 0 ? instruction : undefined, prompt: it.q, options: L, answer: L[newPos[it.a]], explanation: it.e });
      });
    } else if (g.kind === 'tfng' || g.kind === 'ynng') {
      const labels = g.kind === 'tfng' ? ['TRUE', 'FALSE', 'NOT GIVEN'] : ['YES', 'NO', 'NOT GIVEN'];
      const instruction = g.kind === 'tfng'
        ? `${head}\nDo the following statements agree with the information given in Reading Passage?\nWrite\nTRUE if the statement agrees with the information\nFALSE if the statement contradicts the information\nNOT GIVEN if there is no information on this`
        : `${head}\nDo the following statements agree with the claims of the writer in Reading Passage?\nWrite\nYES if the statement agrees with the claims of the writer\nNO if the statement contradicts the claims of the writer\nNOT GIVEN if it is impossible to say what the writer thinks about this`;
      const used = new Set(g.items.map((it) => it.a));
      if (g.items.length >= 4) need(labels.every((l) => used.has(l)), `${g.kind}: nhóm ${g.items.length} câu phải có đủ ${labels.join('/')}`);
      g.items.forEach((it, k) => {
        need(labels.includes(it.a), `${g.kind}: đáp án lạ ${it.a}`);
        push({ type: g.kind, instruction: k === 0 ? instruction : undefined, prompt: it.q, answer: it.a, explanation: it.e });
      });
    } else if (g.kind === 'mcq') {
      const instruction = `${head}\nChoose the correct letter, A, B, C or D.`;
      g.items.forEach((it, k) => {
        need(it.options.length === 4, 'mcq: cần đúng 4 phương án');
        const lengths = it.options.map((o) => o.length);
        const others = Math.max(...lengths.filter((_, i) => i !== it.a));
        need(lengths[it.a] <= others * 1.3, `mcq: đáp án đúng dài vượt trội ở câu "${it.q.slice(0, 40)}" (dễ đoán)`);
        // Xáo ngẫu nhiên nhưng không để một chữ cái làm đáp án quá nhiều lần so
        // với các chữ khác trên toàn bộ thư viện — lệch kiểu "hay là A" cũng là
        // một cách đoán mò.
        let order;
        let newPos;
        for (let tries = 0; tries < 200; tries += 1) {
          order = shuffled(4);
          newPos = new Array(4);
          order.forEach((oldIdx, pos) => { newPos[oldIdx] = pos; });
          const letter = LETTERS[newPos[it.a]];
          if ((mcqLetterCount[letter] ?? 0) <= Math.min(...LETTERS.slice(0, 4).map((l) => mcqLetterCount[l] ?? 0)) + 1) break;
        }
        mcqLetterCount[LETTERS[newPos[it.a]]] = (mcqLetterCount[LETTERS[newPos[it.a]]] ?? 0) + 1;
        const options = order.map((oldIdx, pos) => `${LETTERS[pos]} ${it.options[oldIdx]}`);
        push({ type: 'mcq', instruction: k === 0 ? instruction : undefined, prompt: it.q, options, answer: LETTERS[newPos[it.a]], explanation: it.e });
      });
    } else if (g.kind === 'mcq2' || g.kind === 'mcq3') {
      // Multiple choice, more than one answer: "Choose TWO letters, A-E" hoặc
      // "Choose THREE letters, A-G". Mỗi đáp án là một câu (một điểm), mọi câu
      // trong nhóm có đáp án "X/Y(/Z)" và được chấm chung (thứ tự tuỳ ý,
      // không dùng lặp một chữ cái).
      const picks = g.kind === 'mcq2' ? 2 : 3;
      const optionCount = g.kind === 'mcq2' ? 5 : 7;
      const word = picks === 2 ? 'TWO' : 'THREE';
      const ordinals = ['first', 'second', 'third'];
      let qn = start;
      g.items.forEach((it) => {
        need(it.options.length === optionCount && it.a.length === picks && new Set(it.a).size === picks, `${g.kind}: cần ${optionCount} phương án và ${picks} đáp án khác nhau`);
        const { order, newPos } = shuffleForAnswers(optionCount, it.a);
        const lastL = LETTERS[optionCount - 1];
        const list = order.map((oldIdx, pos) => `${LETTERS[pos]}\t${it.options[oldIdx]}`).join('\n');
        const correctLetters = it.a.map((i) => LETTERS[newPos[i]]).sort();
        const lengths = it.options.map((o) => o.length);
        const wrongMax = Math.max(...lengths.filter((_, i) => !it.a.includes(i)));
        need(Math.min(...it.a.map((i) => lengths[i])) <= wrongMax * 1.3, `${g.kind}: đáp án đúng dài vượt trội ở "${it.q.slice(0, 40)}"`);
        const instruction = `${range(qn, qn + picks - 1)}\nChoose ${word} letters, A-${lastL}.\n\n${it.q}\n\n${list}`;
        const pair = `pair-${qn}`;
        for (let k = 0; k < picks; k += 1) {
          push({ type: 'mcq', instruction: k === 0 ? instruction : undefined, prompt: `${it.q} (${ordinals[k]} letter)`, options: LETTERS.slice(0, optionCount), answer: correctLetters.join('/'), explanation: it.e, pair });
        }
        qn += picks;
      });
    } else if (g.kind === 'gap' || g.kind === 'short') {
      const max = LIMIT_WORDS[(g.limit.match(/ONE|TWO|THREE/) ?? ['TWO'])[0]];
      const intro = g.form === 'diagram' ? 'Label the diagram below.' : `Complete the ${g.form ?? 'sentences'} below.`;
      const instruction = g.kind === 'gap'
        ? `${head}\n${intro}\nChoose ${g.limit} from the passage for each answer.${g.title ? `\n\n${g.title}` : ''}${g.diagram ? `\n\n${g.diagram}` : ''}`
        : `${head}\nAnswer the questions below.\nChoose ${g.limit} from the passage for each answer.`;
      g.items.forEach((it, k) => {
        it.a.split('/').forEach((variant) => {
          const v = variant.trim();
          need(lowerText.includes(norm(v)), `${g.kind}: đáp án "${v}" không có nguyên văn trong bài`);
          const words = v.split(/\s+/).filter((w) => !/^\d[\d,.]*$/.test(w)).length;
          need(words <= max, `${g.kind}: đáp án "${v}" vượt giới hạn ${g.limit}`);
        });
        if (g.kind === 'gap') need(/_{3,}/.test(it.q), `gap: câu "${it.q.slice(0, 30)}" thiếu chỗ trống ______`);
        push({ type: g.kind, instruction: k === 0 ? instruction : undefined, prompt: it.q, answer: it.a, explanation: it.e });
      });
    } else {
      problems.push(`${file}: dạng câu hỏi lạ ${g.kind}`);
    }
  }

  need(questions.length === 13 || questions.length === 14, `${questions.length} câu (cần 13-14)`);
  let easy = 0;
  const seenPairs = new Set();
  questions.forEach((q) => {
    if (q.type === 'matching' && /^Paragraph [A-H]$/.test(q.prompt)) return;
    if (q.pair) { if (seenPairs.has(q.pair)) return; seenPairs.add(q.pair); }
    const { best, bestText } = longestRun(q.prompt);
    if (best >= 9) problems.push(`${file}: câu ${q.number} chép nguyên ${best} từ ("${bestText}") — quá lộ, cần diễn đạt lại`);
    else if (best >= 5) easy += 1;
  });
  need(easy >= 2 && easy <= 4, `có ${easy} câu dễ (chép ≥5 từ); cần 2-4 câu dễ, còn lại phải diễn đạt lại`);
  questions.forEach((q) => need(q.explanation && q.explanation.length > 20, `câu ${q.number} thiếu giải thích`));
  return { text: raw.sourceNote ? `${text}\n\n— ${raw.sourceNote}` : text, questions };
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const problems = [];
let nextOrder = Math.max(...book.passages.map((p) => p.order)) + 1;
let added = 0;
const stats = { types: {}, tf: {}, yn: {}, mcq: {}, formats: {} };

for (const file of files) {
  const slug = file.replace(/\.json$/, '');
  const id = `nl3-${slug}`;
  if (existingIds.has(`${id}-p1`)) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  if (existingTitles.has(raw.title.toLowerCase())) {
    problems.push(`${file}: trùng tiêu đề "${raw.title}"`);
    continue;
  }
  const { text, questions } = buildPassage(file, raw, problems);
  raw.groups.forEach((g) => {
    const key = g.kind === 'gap' ? `gap:${g.form ?? 'sentences'}` : g.kind === 'wordbank' ? `wordbank:${g.form ?? 'summary'}` : g.kind;
    stats.formats[key] = (stats.formats[key] ?? 0) + 1;
  });
  questions.forEach((q) => {
    stats.types[q.type] = (stats.types[q.type] ?? 0) + 1;
    if (q.type === 'tfng') stats.tf[q.answer] = (stats.tf[q.answer] ?? 0) + 1;
    if (q.type === 'ynng') stats.yn[q.answer] = (stats.yn[q.answer] ?? 0) + 1;
    if (q.type === 'mcq') stats.mcq[q.answer] = (stats.mcq[q.answer] ?? 0) + 1;
  });
  book.passages.push({
    id: `${id}-p1`,
    order: nextOrder++,
    title: raw.title,
    text,
    questions: questions.map((q, i) => {
      const out = { id: `${id}-q${i + 1}`, number: q.number, type: q.type, prompt: q.prompt, answer: q.answer, explanation: q.explanation };
      if (q.pair) out.pair = `${id}-${q.pair}`;
      if (q.instruction) out.instruction = q.instruction;
      if (q.options) out.options = q.options;
      return out;
    }),
  });
  existingTitles.add(raw.title.toLowerCase());
  added += 1;
}

console.log(`đã dựng ${added} bài mới (tổng ${book.passages.length})`);
console.log('dạng câu:', stats.types, '| TF/NG:', stats.tf, '| Y/N/NG:', stats.yn, '| MCQ:', stats.mcq);
// 14 dạng chính thức của IELTS.org (Academic Reading Sample Tasks), tách cả
// các biến thể con: MC một / nhiều đáp án, summary lấy từ bài / chọn từ danh sách...
const ALL_FORMATS = ['mcq', 'mcq2', 'mcq3', 'tfng', 'ynng', 'matchinfo', 'headings', 'features', 'endings', 'gap:sentences', 'gap:summary', 'wordbank:summary', 'gap:notes', 'gap:table', 'gap:flow-chart', 'wordbank:flow-chart', 'gap:diagram', 'short'];
console.log('số nhóm theo dạng IELTS:', stats.formats);
const missingFormats = ALL_FORMATS.filter((f) => !stats.formats[f]);
console.log(missingFormats.length ? `CHƯA CÓ dạng: ${missingFormats.join(', ')}` : 'Đã bao phủ đủ mọi dạng câu hỏi IELTS Reading.');
if (problems.length) {
  console.log(`CẢNH BÁO (${problems.length}):`);
  problems.forEach((p) => console.log(' - ' + p));
}
if (process.argv.includes('--write')) {
  if (problems.length && !process.argv.includes('--force')) {
    console.log('Không ghi vì còn cảnh báo (thêm --force để ghi bất chấp).');
    process.exit(1);
  }
  fs.writeFileSync(LIBRARY, `${JSON.stringify(book, null, 2)}\n`, 'utf8');
  console.log(`đã ghi ${LIBRARY}`);
}
