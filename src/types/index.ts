export type CardStatus = "new" | "learning" | "review" | "mastered" | "difficult";
export type VocabularyStudyMode = "flashcards" | "learn" | "write" | "spell" | "test" | "match";
export type StudyMode = VocabularyStudyMode | "listening";

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
}
