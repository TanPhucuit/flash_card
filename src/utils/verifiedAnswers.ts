import { ReadingBook } from "../types/reading";
import { VERIFIED_ANSWER_KEYS, VerifiedPassageKey } from "../data/answerKeys";

// Áp bảng đáp án đã kiểm chứng lên cuốn sách vừa tách từ PDF.
//
// Việc dò đáp án ngay trong PDF không đáng tin với các trang key nhiều cột (xem
// data/answerKeys.ts), nên khi có bảng đã kiểm chứng cho cuốn sách này thì lấy
// nó làm nguồn đúng và ghi đè lên đáp án OCR đoán được.

export interface VerifiedApplyReport {
  bookTitle: string;
  matchedPassages: number;
  filledAnswers: number;
  /** Bài đọc tách được nhưng không tìm thấy trong bảng đã kiểm chứng. */
  unmatchedPassages: string[];
}

const normalise = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Ghép một bài đọc đã tách với một mục trong bảng đã kiểm chứng.
 *
 * Không ghép theo tiêu đề đã tách được: OCR thường trả về "passage below." hay
 * nguyên câu đầu tiên thay vì tên bài. Thay vào đó dò tên bài (ví dụ "Leisure
 * Time") ngay trong phần chữ của bài — tên bài luôn được in làm tiêu đề nên
 * gần như chắc chắn có mặt ở đó. Tên dài được ưu tiên để "Glass" không cướp
 * mất bài của một tiêu đề dài hơn có chứa từ đó.
 */
function findKey(
  passageTitle: string,
  passageText: string,
  candidates: VerifiedPassageKey[],
  used: Set<VerifiedPassageKey>,
): VerifiedPassageKey | null {
  const haystack = normalise(`${passageTitle} ${passageText.slice(0, 1200)}`);
  const group = passageTitle.match(/^(Day \d+|Test \d+)/)?.[1] ?? "";

  const byName = candidates
    .filter((candidate) => !used.has(candidate))
    .map((candidate) => ({ candidate, needle: normalise(candidate.passage) }))
    .filter(({ needle }) => needle.length >= 4 && haystack.includes(needle))
    .sort((a, b) => b.needle.length - a.needle.length);

  if (!byName.length) return null;
  // Ưu tiên mục cùng "Day", nhưng KHÔNG bắt buộc: nhãn Day tách từ PDF hay bị
  // sai vì tiêu đề chạy trang của trang bên cạnh lẫn vào. Tên bài đọc trùng
  // khớp đã là bằng chứng đủ mạnh, chặn thêm theo Day chỉ làm mất match đúng.
  const sameGroup = group ? byName.find((entry) => entry.candidate.group === group) : undefined;
  return (sameGroup ?? byName[0]).candidate;
}

export function applyVerifiedAnswers(book: ReadingBook): VerifiedApplyReport | null {
  const verified = VERIFIED_ANSWER_KEYS.find((entry) => entry.bookMatch.test(book.title));
  if (!verified) return null;

  const used = new Set<VerifiedPassageKey>();
  const unmatchedPassages: string[] = [];
  let matchedPassages = 0;
  let filledAnswers = 0;

  for (const passage of book.passages) {
    const key = findKey(passage.title, passage.text, verified.passages, used);
    if (!key) {
      unmatchedPassages.push(passage.title);
      continue;
    }
    used.add(key);
    matchedPassages += 1;

    for (const question of passage.questions) {
      const answer = key.answers[String(question.number)];
      if (!answer) continue;
      question.answer = answer;
      filledAnswers += 1;
    }

    // Bảng đã kiểm chứng là nguồn đúng, nên nếu nó có câu mà phần tách câu hỏi
    // bỏ sót thì bổ sung vào — người học vẫn làm và vẫn được chấm câu đó.
    const existing = new Set(passage.questions.map((question) => question.number));
    for (const [label, answer] of Object.entries(key.answers)) {
      const number = Number(label);
      if (!Number.isFinite(number) || existing.has(number)) continue;
      passage.questions.push({
        id: `${passage.id}-v${label}`,
        number,
        type: "short",
        prompt: `Câu ${label}`,
        answer,
      });
      filledAnswers += 1;
    }
    passage.questions.sort((a, b) => a.number - b.number);
  }

  return { bookTitle: verified.title, matchedPassages, filledAnswers, unmatchedPassages };
}
