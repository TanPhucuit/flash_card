import { CardStatus, LEARN_DIRECTIONS, LearnDirection, ListeningStudyResult, StudyResult, VocabularyCard, VocabularySet, VocabularyStudyMode } from "../types";

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

export function isSetFullyMastered(set: VocabularySet, results: StudyResult[]): boolean {
  if (!set.cards.length) return false;
  const relevant = results.filter((r) => r.mode !== "listening" && "setId" in r && r.setId === set.id);
  const learnPerfect = (direction: LearnDirection) => relevant.some((r) => r.mode === "learn" && "direction" in r && r.direction === direction && r.accuracy === 100);
  const writePerfect = relevant.some((r) => r.mode === "write" && r.accuracy === 100);
  return LEARN_DIRECTIONS.every(learnPerfect) && writePerfect;
}

export function getMasteryStatusCounts(sets: VocabularySet[], results: StudyResult[]): Record<CardStatus, number> {
  const counts: Record<CardStatus, number> = { mastered: 0, review: 0, learning: 0, difficult: 0, new: 0 };
  sets.forEach((set) => {
    if (isSetFullyMastered(set, results)) {
      counts.mastered += set.cards.length;
    } else {
      set.cards.forEach((card) => { counts[card.status] += 1; });
    }
  });
  return counts;
}

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DailyLearnedWords {
  day: number;
  dateKey: string;
  value: number;
}

export function getLearnedWordsByDay(sets: VocabularySet[], results: StudyResult[], month: Date = new Date()): DailyLearnedWords[] {
  const setById = new Map(sets.map((set) => [set.id, set]));
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const seenPerDay = new Map<string, Set<string>>();
  const totalsPerDay = new Map<string, number>();

  results.forEach((r) => {
    if (r.mode !== "learn" && r.mode !== "write") return;
    if (!("setId" in r)) return;
    const set = setById.get(r.setId);
    if (!set || !set.cards.length) return;
    if (r.totalQuestions < set.cards.length) return;
    const studiedDate = new Date(r.studiedAt);
    if (studiedDate.getFullYear() !== year || studiedDate.getMonth() !== monthIndex) return;
    const key = dayKey(r.studiedAt);
    const seenSets = seenPerDay.get(key) ?? new Set<string>();
    if (seenSets.has(r.setId)) return;
    seenSets.add(r.setId);
    seenPerDay.set(key, seenSets);
    totalsPerDay.set(key, (totalsPerDay.get(key) ?? 0) + set.cards.length);
  });

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const days: DailyLearnedWords[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    days.push({ day, dateKey: key, value: totalsPerDay.get(key) ?? 0 });
  }
  return days;
}

export function getLearnedWordsByWeek(days: DailyLearnedWords[]): { label: string; value: number }[] {
  const weeks: { label: string; value: number }[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const value = days.slice(i, i + 7).reduce((sum, day) => sum + day.value, 0);
    weeks.push({ label: `Tuần ${weeks.length + 1}`, value });
  }
  return weeks;
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

export function createResult(setId: string, mode: VocabularyStudyMode, total: number, correct: number, wrongCardIds: string[] = [], direction?: LearnDirection): StudyResult {
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
    direction,
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
