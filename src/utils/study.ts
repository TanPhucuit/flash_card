import { CardStatus, ListeningStudyResult, StudyResult, VocabularyCard, VocabularySet, VocabularyStudyMode } from "../types";

export function formatDate(value?: string) {
  if (!value) return "Chưa học";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(value));
}

export function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

export function getSetProgress(set: VocabularySet) {
  return percent(set.cards.filter((card) => card.status === "mastered").length, set.cards.length);
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

function nextStatus(card: VocabularyCard, correct: boolean): CardStatus {
  if (!correct) return card.mistakeCount + 1 >= 2 ? "difficult" : "review";
  const correctCount = card.correctCount + 1;
  if (correctCount >= 3 && card.mistakeCount <= 1) return "mastered";
  return "learning";
}

export function updateCardStudy(card: VocabularyCard, correct: boolean): VocabularyCard {
  const today = new Date();
  const correctCount = card.correctCount + (correct ? 1 : 0);
  const mistakeCount = card.mistakeCount + (correct ? 0 : 1);
  const delay = !correct ? 0 : correctCount === 1 ? 1 : correctCount === 2 ? 3 : 7;
  return {
    ...card,
    correctCount,
    mistakeCount,
    status: nextStatus(card, correct),
    lastStudiedAt: today.toISOString(),
    nextReviewAt: addDays(today, delay),
  };
}

export function updateSetCard(set: VocabularySet, cardId: string, updater: (card: VocabularyCard) => VocabularyCard): VocabularySet {
  const now = new Date().toISOString();
  return {
    ...set,
    cards: set.cards.map((card) => (card.id === cardId ? updater(card) : card)),
    updatedAt: now,
    lastStudiedAt: now,
  };
}

export function shuffle<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function preferredCards(cards: VocabularyCard[]) {
  const weight: Record<CardStatus, number> = { difficult: 0, new: 1, learning: 2, review: 3, mastered: 4 };
  return [...cards].sort((a, b) => weight[a.status] - weight[b.status]);
}

export function levenshtein(a: string, b: string) {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  const matrix = Array.from({ length: left.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= right.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      matrix[i][j] = left[i - 1] === right[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
    }
  }
  return matrix[left.length][right.length];
}

export function createResult(setId: string, mode: VocabularyStudyMode, total: number, correct: number, wrongCardIds: string[] = []): StudyResult {
  return {
    id: crypto.randomUUID(),
    setId,
    mode,
    totalQuestions: total,
    correctAnswers: correct,
    wrongAnswers: Math.max(0, total - correct),
    accuracy: percent(correct, total),
    studiedAt: new Date().toISOString(),
    wrongCardIds: [...new Set(wrongCardIds)],
  };
}

export function createListeningResult(accuracy: number): ListeningStudyResult {
  return {
    id: crypto.randomUUID(),
    mode: "listening",
    accuracy: Math.max(0, Math.min(100, Math.round(accuracy))),
    studiedAt: new Date().toISOString(),
  };
}
