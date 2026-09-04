export type CardStatus = "new" | "learning" | "review" | "mastered" | "difficult";
export type VocabularyStudyMode = "flashcards" | "learn" | "write" | "spell" | "test" | "match";
export type StudyMode = VocabularyStudyMode | "listening";
export type LearnDirection = "eng-eng" | "viet-eng" | "eng-viet";
export const LEARN_DIRECTIONS: LearnDirection[] = ["eng-eng", "viet-eng", "eng-viet"];

export interface VocabularyCard {
  id: string;
  word: string;
  ipa: string;
  meaningVi: string;
  definitionEn: string;
  exampleEn: string;
  exampleVi: string;
  partOfSpeech: string;
  level: string;
  synonyms: string[];
  antonyms: string[];
  status: CardStatus;
  mistakeCount: number;
  correctCount: number;
  starred: boolean;
  lastStudiedAt?: string;
  nextReviewAt?: string;
}

export interface VocabularySet {
  id: string;
  title: string;
  description: string;
  tags: string[];
  cards: VocabularyCard[];
  createdAt: string;
  updatedAt: string;
  lastStudiedAt?: string;
  /** Danh sách (thư mục) chứa set này — xem src/utils/setLists.ts. */
  listId?: string;
  /**
   * Id task bên Life Management, MỘT id cho mỗi chế độ học: cùng một set nằm
   * dưới cả bốn node chế độ (LEARN ENG_ENG / VIET_ENG / ENG_VIET / WRITING)
   * nên mỗi chế độ là một task riêng, đánh dấu hoàn thành độc lập với nhau.
   * Khoá là SetModeKey — xem src/utils/study.ts.
   */
  lifeManagementTaskIds?: Record<string, string>;
}

/**
 * Một "danh sách" là một nhóm các set, ví dụ "c1_c2" hay "15_day_practice".
 * Đây thuần là một cách gom nhóm để duyệt — không ảnh hưởng gì tới nội dung
 * hay tiến độ học của set bên trong.
 */
export interface VocabularySetList {
  id: string;
  title: string;
  createdAt: string;
  /** Id task tương ứng bên Life Management (node CHA của các set trong nó). */
  lifeManagementTaskId?: string;
}

export interface VocabularyStudyResult {
  id: string;
  setId: string;
  mode: VocabularyStudyMode;
  totalQuestions: number;
  correctAnswers: number;
  wrongAnswers: number;
  accuracy: number;
  studiedAt: string;
  wrongCardIds?: string[];
  direction?: LearnDirection;
}

export interface ListeningStudyResult {
  id: string;
  mode: "listening";
  accuracy: number;
  studiedAt: string;
}

export type StudyResult = VocabularyStudyResult | ListeningStudyResult;

export interface AppSettings {
  theme: "light" | "dark";
  voiceURI: string;
}

export interface AppData {
  sets: VocabularySet[];
  results: StudyResult[];
  settings: AppSettings;
  matchBestTimes: Record<string, number>;
  lists: VocabularySetList[];
}
