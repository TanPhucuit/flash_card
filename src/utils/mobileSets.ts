import { VocabularyCard, VocabularySet } from "../types";

export const MOBILE_SET_LIMIT = 30;

/** Các Mobile Set theo thứ tự tạo, đúng như màn hình "Thêm từ" trên điện thoại. */
export function getMobileSets(sets: VocabularySet[]): VocabularySet[] {
  return sets.filter((set) => set.tags.includes("Mobile")).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type AddToMobileSetResult =
  | { status: "added"; set: VocabularySet }
  | { status: "duplicate"; set: VocabularySet };

/**
 * Thêm một từ vào Mobile Set đang dùng (set đầu tiên còn dưới 30 từ), hoặc tạo
 * Mobile Set mới khi set hiện tại đã đầy. Từ đã có trong bất kỳ Mobile Set nào
 * (không phân biệt hoa thường) thì không thêm lần nữa.
 */
export function addToMobileSet(
  sets: VocabularySet[],
  upsertSet: (set: VocabularySet) => void,
  entry: { word: string; meaningVi?: string; definitionEn?: string },
): AddToMobileSetResult {
  const mobileSets = getMobileSets(sets);
  const key = entry.word.trim().toLowerCase();
  const existing = mobileSets.find((set) => set.cards.some((card) => card.word.trim().toLowerCase() === key));
  if (existing) return { status: "duplicate", set: existing };

  const activeSet = mobileSets.find((set) => set.cards.length < MOBILE_SET_LIMIT);
  const now = new Date().toISOString();
  const nextNumber = mobileSets.length + 1;
  const targetSet: VocabularySet = activeSet ?? {
    id: `mobile-set-${nextNumber}`,
    title: `Mobile Set ${nextNumber}`,
    description: "Bộ từ được thêm nhanh từ giao diện điện thoại.",
    tags: ["Mobile"],
    cards: [],
    createdAt: now,
    updatedAt: now,
  };

  const card: VocabularyCard = {
    id: crypto.randomUUID(),
    word: entry.word.trim(),
    ipa: "",
    meaningVi: entry.meaningVi?.trim() ?? "",
    definitionEn: entry.definitionEn?.trim() ?? "",
    exampleEn: "",
    exampleVi: "",
    partOfSpeech: "word",
    level: "Mobile",
    synonyms: [],
    antonyms: [],
    status: "new",
    mistakeCount: 0,
    correctCount: 0,
    starred: false,
  };
  const saved: VocabularySet = { ...targetSet, cards: [...targetSet.cards, card], updatedAt: now };
  upsertSet(saved);
  return { status: "added", set: saved };
}
