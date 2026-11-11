import { LEARN_DIRECTIONS, LearnDirection, VocabularyCard, VocabularySet } from "../types";

/**
 * Set TRẮC NGHIỆM (ôn giữa kỳ): mỗi thẻ là một câu hỏi nhiều lựa chọn thay vì
 * một từ vựng. Chúng được lưu y như flashcard bình thường, và CỐ TÌNH dùng lại
 * đúng các cột đã có để schema Google Sheet (api/_googleSheets.js) không phải
 * đổi — thêm cột mới ở đó nghĩa là động vào đường đồng bộ của TOÀN BỘ dữ liệu.
 *
 *   word         -> câu hỏi
 *   meaningVi    -> đáp án đúng (mặt sau flashcard)
 *   definitionEn -> giải thích (nếu nguồn có)
 *   synonyms     -> TOÀN BỘ các lựa chọn, theo thứ tự gốc (gồm cả đáp án đúng)
 *   level        -> chủ đề / mục / mức độ (nếu có)
 *   partOfSpeech -> "quiz" — dấu nhận biết một thẻ là câu trắc nghiệm
 *
 * Kết quả Learn của set trắc nghiệm ghi với direction = "quiz".
 * Gói dựng sẵn được tạo bởi tools/buildQuizSets.mjs theo đúng cách mã hoá này.
 */
export const QUIZ_MARKER = "quiz";
export const QUIZ_DIRECTION: LearnDirection = "quiz";

export function isQuizCard(card: Pick<VocabularyCard, "partOfSpeech" | "synonyms">): boolean {
  return card.partOfSpeech === QUIZ_MARKER && Array.isArray(card.synonyms) && card.synonyms.length >= 2;
}

/** Set rỗng không bao giờ được coi là set trắc nghiệm. Một thẻ thường lẫn vào là đủ để quay về luồng từ vựng. */
export function isQuizSet(set: Pick<VocabularySet, "cards">): boolean {
  return set.cards.length > 0 && set.cards.every(isQuizCard);
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  answer: string;
  explanation: string;
  topic: string;
  /** Câu Đúng/Sai (hai lựa chọn) — giữ nguyên thứ tự, không xáo. */
  trueFalse: boolean;
}

export function quizOf(card: VocabularyCard): QuizQuestion {
  // Đáp án đúng luôn nằm trong danh sách lựa chọn: dữ liệu bị sửa tay mà thiếu
  // nó thì thêm vào cuối thay vì để câu hỏi không có đáp án nào đúng.
  const options = card.synonyms.includes(card.meaningVi) ? card.synonyms : [...card.synonyms, card.meaningVi];
  const topic = card.level && card.level.toLowerCase() !== QUIZ_MARKER ? card.level : "";
  return {
    question: card.word,
    options,
    answerIndex: options.indexOf(card.meaningVi),
    answer: card.meaningVi,
    explanation: card.definitionEn,
    topic,
    trueFalse: options.length === 2,
  };
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/** Các lựa chọn để hiển thị: xáo ngẫu nhiên (học nội dung, không học thuộc vị trí A/B/C/D), trừ câu Đúng/Sai. */
export function quizChoices(card: VocabularyCard): string[] {
  const quiz = quizOf(card);
  return quiz.trueFalse ? quiz.options : shuffled(quiz.options);
}

/** Các hướng Learn phải hoàn thành để set được tính là "đã học": 1 với set trắc nghiệm, 3 với set từ vựng. */
export function requiredLearnDirections(set: Pick<VocabularySet, "cards">): LearnDirection[] {
  return isQuizSet(set) ? [QUIZ_DIRECTION] : LEARN_DIRECTIONS;
}

/** Đơn vị đếm trong giao diện: "câu" với set trắc nghiệm, "từ" với set từ vựng. */
export function cardUnit(set: Pick<VocabularySet, "cards">): "câu" | "từ" {
  return isQuizSet(set) ? "câu" : "từ";
}
