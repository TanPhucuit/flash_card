import { VocabularyCard } from "../types";

const headers = ["word", "ipa", "meaningVi", "definitionEn", "exampleEn", "exampleVi", "partOfSpeech", "level"];

function parseCsvRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let quoted = false;

  const pushCell = () => {
    row.push(current.trim());
    current = "";
  };
  const pushRow = () => {
    if (row.some((cell) => cell.length > 0)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      pushCell();
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      pushCell();
      pushRow();
    } else {
      current += char;
    }
  }

  pushCell();
  pushRow();
  return rows;
}

export function parseCardsCsv(csv: string): VocabularyCard[] {
  return parseCsvRows(csv.replace(/^\uFEFF/, ""))
    .filter((values, index) => !(index === 0 && values[0]?.toLowerCase() === "word"))
    .map((values) => {
      const row = Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""]));
      return {
        id: crypto.randomUUID(),
        word: row.word,
        ipa: row.ipa,
        meaningVi: row.meaningVi,
        definitionEn: row.definitionEn,
        exampleEn: row.exampleEn,
        exampleVi: row.exampleVi,
        partOfSpeech: row.partOfSpeech || "word",
        level: row.level || "A1",
        synonyms: [],
        antonyms: [],
        status: "new",
        mistakeCount: 0,
        correctCount: 0,
        starred: false,
      } satisfies VocabularyCard;
    })
    .filter((card) => card.word && card.meaningVi);
}

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
