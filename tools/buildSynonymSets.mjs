// Dựng public/synonym-sets.json từ tools/synonymPhrases/*.txt.
//
// Mỗi cụm đồng nghĩa (vd. "insurmountable obstacle" = "big problem") tách thành 3 thẻ:
//   1. cụm đầy đủ  -> nghĩa là cụm đồng nghĩa tiếng Anh ("big problem")
//   2. từ thứ nhất -> nghĩa tiếng Việt ("không thể vượt qua")
//   3. từ thứ hai  -> nghĩa tiếng Việt ("chướng ngại vật")
// 100 cụm = 300 thẻ, xáo ngẫu nhiên vào 15 set × 20 thẻ. Ba thẻ của cùng một cụm
// luôn nằm ở ba set KHÁC NHAU, để trong một lượt học không thẻ nào gợi ý lộ đáp án
// của thẻ kia.
//
//   node tools/buildSynonymSets.mjs [existing-cloud-backup.json]
import fs from "node:fs";
import path from "node:path";

const DIR = "tools/synonymPhrases";
const OUT = "public/synonym-sets.json";
const SET_COUNT = 15;
const SET_SIZE = 20;
const GROUPS = SET_COUNT * SET_SIZE / 3; // 100

function readGroups(file) {
  return fs.readFileSync(path.join(DIR, file), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line, index) => {
      const f = line.split("|");
      if (f.length !== 16) throw new Error(`${file} dòng ${index + 1}: ${f.length} cột (cần 16) — ${f[0]}`);
      const [phrase, synonym, w1, ipa1, pos1, vi1, def1, w2, ipa2, pos2, vi2, def2, defPhrase, exampleEn, exampleVi, level] = f.map((x) => x.trim());
      const g = { phrase, synonym, parts: [
        { word: w1, ipa: ipa1, pos: pos1, vi: vi1, def: def1 },
        { word: w2, ipa: ipa2, pos: pos2, vi: vi2, def: def2 },
      ], defPhrase, exampleEn, exampleVi, level };
      const missing = Object.entries({ phrase, synonym, w1, ipa1, vi1, def1, w2, ipa2, vi2, def2, defPhrase, exampleEn, exampleVi }).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) throw new Error(`${file}: "${phrase}" thiếu ${missing.join(", ")}`);
      const inExample = (w) => new RegExp(`\\b${w.replace(/-/g, "[- ]?")}`, "i").test(exampleEn);
      if (!inExample(w1) || !inExample(w2)) console.warn(`  ! ví dụ của "${phrase}" không chứa đủ cả hai từ`);
      return g;
    });
}

const main = ["part1.txt", "part2.txt", "part3.txt", "part4.txt"].flatMap(readGroups);
const reserve = ["reserve.txt", "reserve2.txt"].flatMap(readGroups);

// Từ đã có trong dữ liệu (bản sao lưu cloud) và trong bộ high-level.
const existing = new Set();
const backup = process.argv[2];
if (backup && fs.existsSync(backup)) {
  for (const set of JSON.parse(fs.readFileSync(backup, "utf8")).sets) for (const c of set.cards) existing.add(c.word.trim().toLowerCase());
}
if (fs.existsSync("public/high-level-sets.json")) {
  for (const set of JSON.parse(fs.readFileSync("public/high-level-sets.json", "utf8")).sets) for (const c of set.cards) existing.add(c.word.trim().toLowerCase());
}
const clash = (g) => [g.phrase, ...g.parts.map((p) => p.word)].filter((w) => existing.has(w.toLowerCase()));

// Thay các cụm có từ trùng bằng cụm dự phòng không trùng; bổ sung cho đủ 100.
const used = new Set();
const chosen = [];
const spare = reserve.filter((g) => !clash(g).length);
const take = (g) => {
  const keys = [g.phrase, ...g.parts.map((p) => p.word)].map((w) => w.toLowerCase());
  if (keys.some((k) => used.has(k))) return false;
  keys.forEach((k) => used.add(k));
  chosen.push(g);
  return true;
};
const replaced = [];
for (const g of main) {
  if (clash(g).length && spare.length) {
    const swap = spare.shift();
    if (take(swap)) { replaced.push(`${g.phrase} -> ${swap.phrase}`); continue; }
  }
  if (!take(g)) throw new Error(`Từ trùng giữa các cụm: ${g.phrase}`);
}
while (chosen.length < GROUPS && spare.length) take(spare.shift());
while (chosen.length < GROUPS && reserve.length) { const g = reserve.shift(); if (!chosen.includes(g)) take(g); }
if (chosen.length !== GROUPS) throw new Error(`Có ${chosen.length} cụm, cần ${GROUPS}`);

const stillClashing = chosen.filter((g) => clash(g).length);
console.log(`cụm: ${chosen.length} | thay do trùng từ đã có: ${replaced.length}`);
replaced.forEach((line) => console.log(`   ${line}`));
if (stillClashing.length) console.log(`còn ${stillClashing.length} cụm có từ trùng dữ liệu cũ: ${stillClashing.map((g) => `${g.phrase} [${clash(g).join(", ")}]`).join("; ")}`);

// ---- thẻ
const cards = [];
chosen.forEach((g, gi) => {
  const n = String(gi + 1).padStart(3, "0");
  const base = { exampleEn: g.exampleEn, exampleVi: g.exampleVi, level: g.level, synonyms: [], antonyms: [], status: "new", mistakeCount: 0, correctCount: 0, starred: false };
  const innerIpa = (ipa) => ipa.replace(/^\/|\/$/g, "");
  cards.push({ ...base, group: gi, id: `syn-${n}-a`, word: g.phrase, ipa: `/${innerIpa(g.parts[0].ipa)} ${innerIpa(g.parts[1].ipa)}/`, meaningVi: g.synonym, definitionEn: g.defPhrase, partOfSpeech: "phrase" });
  g.parts.forEach((p, i) => cards.push({ ...base, group: gi, id: `syn-${n}-${i ? "c" : "b"}`, word: p.word, ipa: p.ipa, meaningVi: p.vi, definitionEn: p.def, partOfSpeech: p.pos || "word" }));
});

// ---- chia vào các set: mỗi cụm vào 3 set khác nhau, ưu tiên set còn nhiều chỗ nhất
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const buckets = Array.from({ length: SET_COUNT }, () => []);
for (const gi of shuffle(chosen.map((_, i) => i))) {
  const groupCards = shuffle(cards.filter((c) => c.group === gi));
  const order = shuffle(buckets.map((_, i) => i)).sort((a, b) => (SET_SIZE - buckets[b].length) - (SET_SIZE - buckets[a].length));
  groupCards.forEach((card, k) => buckets[order[k]].push(card));
}
buckets.forEach(shuffle);

// ---- kiểm tra
buckets.forEach((b, i) => { if (b.length !== SET_SIZE) throw new Error(`set ${i + 1} có ${b.length} thẻ`); });
buckets.forEach((b, i) => { const gs = b.map((c) => c.group); if (new Set(gs).size !== gs.length) throw new Error(`set ${i + 1} chứa hai thẻ cùng cụm`); });
const allWords = cards.map((c) => c.word.toLowerCase());
if (new Set(allWords).size !== allWords.length) throw new Error("có từ trùng trong 300 thẻ");
if (new Set(cards.map((c) => c.id)).size !== cards.length) throw new Error("trùng id thẻ");

const sets = buckets.map((bucket, i) => {
  const n = String(i + 1).padStart(2, "0");
  return {
    id: `synonym-${n}`,
    title: `synonym_phrases_${n}`,
    description: "Cụm từ nâng cao đồng nghĩa hay dùng trong IELTS: cụm → cách nói đơn giản, và từng từ thành phần → nghĩa tiếng Việt (20 thẻ).",
    tags: ["Synonym"],
    cards: bucket.map(({ group, ...card }) => card),
  };
});
fs.writeFileSync(OUT, `${JSON.stringify({ listId: "synonym_phrases", sets }, null, 1)}\n`, "utf8");
console.log(`đã ghi ${OUT}: ${sets.length} set, ${cards.length} thẻ (${chosen.length} cụm × 3)`);

// Kiểm tra độ phân tán: khoảng cách vị trí giữa các thẻ cùng cụm là bao nhiêu set
const where = new Map();
buckets.forEach((b, si) => b.forEach((c) => where.set(c.group, [...(where.get(c.group) ?? []), si])));
console.log("mỗi cụm nằm ở 3 set khác nhau:", [...where.values()].every((s) => new Set(s).size === 3));
