import { ReadingQuestion } from "../types/reading";
import { isAnswerCorrect } from "./readingPdf";

/**
 * Chấm cả bài một lần, vì có câu không chấm độc lập được: với cặp "Choose TWO
 * letters", mỗi câu chấp nhận một trong hai chữ cái đúng theo thứ tự bất kỳ,
 * nhưng chọn cùng một chữ cái cho cả hai câu chỉ được tính một điểm.
 */
export function gradeQuestions(questions: ReadingQuestion[], answers: Record<string, string>): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const pairs = new Map<string, ReadingQuestion[]>();
  for (const question of questions) {
    if (!question.answer) continue;
    if (question.pair) pairs.set(question.pair, [...(pairs.get(question.pair) ?? []), question]);
    else result.set(question.id, isAnswerCorrect(answers[question.id] ?? "", question.answer));
  }
  for (const group of pairs.values()) {
    const used = new Set<string>();
    for (const question of group) {
      const given = (answers[question.id] ?? "").trim().toUpperCase();
      const ok = Boolean(given) && isAnswerCorrect(given, question.answer) && !used.has(given);
      if (ok) used.add(given);
      result.set(question.id, ok);
    }
  }
  return result;
}
