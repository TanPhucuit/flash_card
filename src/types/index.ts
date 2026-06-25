export type CardStatus = "new" | "learning" | "review" | "mastered" | "difficult";
export type StudyMode = "flashcards" | "learn" | "write" | "spell" | "test" | "match";

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
}

export interface StudyResult {
  id: string;
  setId: string;
  mode: StudyMode;
  totalQuestions: number;
  correctAnswers: number;
  wrongAnswers: number;
  accuracy: number;
  studiedAt: string;
}

export interface AppSettings {
  theme: "light" | "dark";
  voiceURI: string;
}

export interface AppData {
  sets: VocabularySet[];
  results: StudyResult[];
  settings: AppSettings;
  matchBestTimes: Record<string, number>;
}
