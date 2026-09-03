import { syncStarSets, isStarSet, STAR_SET_SIZE } from "../src/utils/starSets";
import { AppData, VocabularyCard, VocabularySet } from "../src/types";

const card = (id: string, starred = false): VocabularyCard => ({
  id, word: `w${id}`, ipa: "", meaningVi: "", definitionEn: "", exampleEn: "", exampleVi: "",
  partOfSpeech: "noun", level: "B1", synonyms: [], antonyms: [],
  status: "new", mistakeCount: 0, correctCount: 0, starred,
});

const makeSet = (id: string, title: string, cards: VocabularyCard[]): VocabularySet => ({
  id, title, description: "", tags: [], cards, createdAt: "", updatedAt: "",
});

const base = (sets: VocabularySet[]): AppData => ({
  sets, results: [], matchBestTimes: {}, settings: { theme: "light", voiceURI: "" },
});

const starTitles = (d: AppData) => d.sets.filter(isStarSet).map((s) => `${s.title}(${s.cards.length})`);

// 1. Chua co tu nao gan sao -> khong co set sao
let data = syncStarSets(base([makeSet("s1", "Unit 1", [card("a"), card("b")])]));
console.log("1. khong sao      ->", starTitles(data).length === 0 ? "OK (khong tao set)" : "SAI");

// 2. 25 tu gan sao -> chia thanh star_01 (20) + star_02 (5)
const many = Array.from({ length: 25 }, (_, i) => card(`c${i}`, true));
data = syncStarSets(base([makeSet("s1", "Unit 1", many)]));
console.log("2. 25 tu sao      ->", JSON.stringify(starTitles(data)));

// 3. Them 1 tu nua -> star_02 thanh 6, star_01 KHONG doi thu tu
const before = data.sets.filter(isStarSet)[0].cards.map((c) => c.id);
const withOneMore = base([makeSet("s1", "Unit 1", [...many, card("c25", true)])]);
data = syncStarSets(withOneMore);
const after = data.sets.filter(isStarSet)[0].cards.map((c) => c.id);
console.log("3. them 1 tu       ->", JSON.stringify(starTitles(data)),
  "| star_01 giu nguyen:", JSON.stringify(before) === JSON.stringify(after) ? "OK" : "SAI");

// 4. Vuot 40 tu -> tu dong tao star_03
const forty1 = Array.from({ length: 41 }, (_, i) => card(`d${i}`, true));
data = syncStarSets(base([makeSet("s1", "Unit 1", forty1)]));
console.log("4. 41 tu sao       ->", JSON.stringify(starTitles(data)));

// 5. Bo sao trong chinh set sao -> go sao o the GOC va tu bien mat
const starSet = data.sets.filter(isStarSet)[0];
const mutated: AppData = {
  ...data,
  sets: data.sets.map((s) =>
    s.id === starSet.id ? { ...s, cards: s.cards.map((c, i) => (i === 0 ? { ...c, starred: false } : c)) } : s,
  ),
};
const afterUnstar = syncStarSets(mutated);
const sourceStillStarred = afterUnstar.sets.find((s) => s.id === "s1")!.cards.find((c) => c.id === "d0")!.starred;
const totalStar = afterUnstar.sets.filter(isStarSet).reduce((n, s) => n + s.cards.length, 0);
console.log("5. bo sao trong set sao -> the goc con sao:", sourceStillStarred ? "SAI" : "OK",
  "| tong tu sao:", totalStar, totalStar === 40 ? "(OK)" : "(SAI)");

// 6. Khong tu nhan chinh set sao lam nguon (khong nhan doi vo han)
const twice = syncStarSets(syncStarSets(base([makeSet("s1", "Unit 1", many)])));
const total2 = twice.sets.filter(isStarSet).reduce((n, s) => n + s.cards.length, 0);
console.log("6. chay 2 lan      ->", total2 === 25 ? "OK (van 25)" : `SAI (${total2})`);

// 7. Tien do hoc trong set sao duoc giu qua moi lan dung lai
const withProgress: AppData = {
  ...twice,
  sets: twice.sets.map((s) =>
    isStarSet(s) ? { ...s, cards: s.cards.map((c, i) => (i === 0 ? { ...c, correctCount: 7 } : c)) } : s,
  ),
};
const rebuilt = syncStarSets(withProgress);
const kept = rebuilt.sets.filter(isStarSet)[0].cards[0].correctCount;
console.log("7. giu tien do     ->", kept === 7 ? "OK (correctCount=7)" : `SAI (${kept})`);

console.log("\nSTAR_SET_SIZE =", STAR_SET_SIZE);
