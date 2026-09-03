import * as XLSX from "xlsx";
import { AnswerKeyRow } from "./verifiedAnswers";

// Đọc file đáp án (Excel/CSV/TSV) người dùng tải lên thành AnswerKeyRow[].
//
// Khuôn cột — group | passage | question | answer — đúng như
// tools/answer_key_to_excel.py ở D:\project\OCR_image_to_pdf đã sinh ra, để
// một file người dùng tự chép tay bằng Claude (theo PROMPT_ANSWER_KEY.txt ở
// đó) dùng lại được luôn, không cần đổi khuôn.

const HEADER_ALIASES: Record<string, keyof AnswerKeyRow> = {
  group: "group",
  day: "group",
  test: "group",
  passage: "passage",
  title: "passage",
  question: "question",
  no: "question",
  number: "question",
  answer: "answer",
  key: "answer",
};

function normaliseHeader(value: unknown): keyof AnswerKeyRow | null {
  const key = String(value ?? "").trim().toLowerCase();
  return HEADER_ALIASES[key] ?? null;
}

export interface AnswerKeyFileResult {
  rows: AnswerKeyRow[];
  /** Cột không nhận diện được, để báo cho người dùng biết file có đúng khuôn không. */
  unknownColumns: string[];
}

export async function parseAnswerKeyFile(file: File): Promise<AnswerKeyFileResult> {
  const isText = /\.(csv|tsv|txt)$/i.test(file.name);
  const workbook = isText
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { rows: [], unknownColumns: [] };

  // header: 1 -> array-of-arrays, so the header row's own wording (which
  // varies: "Question" vs "No", "Answer" vs "Key"...) can be normalised
  // rather than trusted verbatim as object keys.
  const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  if (!table.length) return { rows: [], unknownColumns: [] };

  const headerRow = table[0];
  const columns = headerRow.map(normaliseHeader);
  const unknownColumns = headerRow.filter((_, index) => !columns[index]).map((value) => String(value ?? "").trim()).filter(Boolean);

  const rows: AnswerKeyRow[] = [];
  for (const dataRow of table.slice(1)) {
    const record: Partial<AnswerKeyRow> = {};
    columns.forEach((column, index) => {
      if (!column) return;
      const value = dataRow[index];
      if (value === undefined || value === null || value === "") return;
      (record as Record<string, unknown>)[column] = value;
    });
    if (record.passage && record.question !== undefined && record.answer) {
      rows.push({ group: record.group ? String(record.group) : "", passage: String(record.passage), question: record.question, answer: String(record.answer) });
    }
  }

  return { rows, unknownColumns };
}
