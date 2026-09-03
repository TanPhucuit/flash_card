import { readFileSync, writeFileSync } from "fs";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && n === '"') { cur += '"'; i++; }
    else if (c === '"') q = !q;
    else if (c === "," && !q) { row.push(cur); cur = ""; }
    else if ((c === "\n" || c === "\r") && !q) {
      if (c === "\r" && n === "\n") i++;
      row.push(cur);
      if (row.some((x) => x.length)) rows.push(row);
      row = []; cur = "";
    } else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); if (row.some((x) => x.length)) rows.push(row); }
  return rows;
}

const octRows = parseCsv(readFileSync("exports/ielts_1000_new/cefr_src/octanove_c1c2.csv", "utf8").replace(/^﻿/, ""));
const [, ...octData] = octRows;

const cardsDump = JSON.parse(readFileSync("exports/ielts_1000_new/cefr_src/cards_dump.json", "utf8"));
const [, ...cardRows] = cardsDump;
const existing = new Set(cardRows.map((r) => (r[2] || "").toLowerCase().trim()).filter(Boolean));

// One entry per unique headword, preferring the first POS listed (Octanove
// lists a word once per sense/POS; a study set only needs the word once).
const byWord = new Map();
for (const [headword, pos, cefr] of octData) {
  const key = headword.toLowerCase().trim();
  if (!key || existing.has(key)) continue;
  if (!/^[a-z][a-z '-]*$/i.test(key)) continue; // skip anything non-alphabetic
  if (!byWord.has(key)) byWord.set(key, { word: headword.trim(), pos: pos.trim(), level: cefr.trim() });
}

const candidates = Array.from(byWord.values());
console.log("candidates after dedup against existing bank:", candidates.length);

// Interleave C1/C2 so the final 1000 aren't front-loaded with all of one level.
const c1 = candidates.filter((c) => c.level === "C1");
const c2 = candidates.filter((c) => c.level === "C2");
console.log("available C1:", c1.length, "C2:", c2.length);

const picked = [];
let i = 0, j = 0;
while (picked.length < 1000 && (i < c1.length || j < c2.length)) {
  if (i < c1.length) picked.push(c1[i++]);
  if (picked.length < 1000 && j < c2.length) picked.push(c2[j++]);
}

console.log("picked:", picked.length);
writeFileSync("exports/ielts_1000_new/candidates.json", JSON.stringify(picked, null, 1));
