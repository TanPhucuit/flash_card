import { ChangeEvent, FormEvent, TouchEvent as ReactTouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DataApi, ReadingDataApi } from "../App";
import { Button, Card, EmptyState, Icon, Input, PageTitle, ProgressBar, Select, Textarea } from "../components/ui";
import { ColumnChart, HorizontalBarChart, StatusDonutChart, TrendLineChart } from "../components/charts";
import { useSpeech } from "../hooks/useSpeech";
import { AppData, LEARN_DIRECTIONS, LearnDirection, StudyResult, VocabularyCard, VocabularySet, VocabularyStudyMode } from "../types";
import { downloadJson, parseCardsCsv } from "../utils/csv";
import { getStorageDiagnostics, STORAGE_BACKUP_KEY, STORAGE_KEY } from "../utils/storage";
import { isStarSet } from "../utils/starSets";
import { syncSetListToLifeManagement } from "../utils/lifeManagementSync";
import { createResult, formatDate, getLearnedWordsByDay, getLearnedWordsByWeek, getMasteryStatusCounts, getSetProgress, levenshtein, percent, shuffle, updateCardStudy, updateSetCard } from "../utils/study";

type PageProps = { api: DataApi };
// Trang danh sách cần thêm cấu hình Life Management, vốn nằm trong dữ liệu
// Reading — dùng chung một cấu hình thay vì bắt người dùng khai báo hai lần.
type SetsPageProps = PageProps & { reading: ReadingDataApi };

const MAX_MIX_SETS = 3;

const emptyCard = (): VocabularyCard => ({
  id: crypto.randomUUID(),
  word: "",
  ipa: "",
  meaningVi: "",
  definitionEn: "",
  exampleEn: "",
  exampleVi: "",
  partOfSpeech: "noun",
  level: "A1",
  synonyms: [],
  antonyms: [],
  status: "new",
  mistakeCount: 0,
  correctCount: 0,
  starred: false,
});

function getSet(api: DataApi, setId?: string) {
  return api.data.sets.find((set) => set.id === setId);
}

function modePath(setId: string, mode: VocabularyStudyMode) {
  return `/study/${setId}/${mode}`;
}

function playCorrectChime(audio: { current: AudioContext | null }) {
  try {
    const context = audio.current ?? new AudioContext();
    audio.current = context;
    if (context.state === "suspended") void context.resume();
    const startAt = context.currentTime;
    const pitchVariation = (Math.random() - 0.5) * 4;
    const master = context.createGain();
    master.gain.setValueAtTime(0.72, startAt);
    master.connect(context.destination);

    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const noteStart = startAt + index * 0.075;
      const duration = index === 2 ? 0.38 : 0.3;
      const bell = context.createOscillator();
      const shimmer = context.createOscillator();
      const bellGain = context.createGain();
      const shimmerGain = context.createGain();

      bell.type = "triangle";
      bell.frequency.value = frequency;
      bell.detune.value = pitchVariation;
      shimmer.type = "sine";
      shimmer.frequency.value = frequency * 2;
      shimmer.detune.value = pitchVariation;

      bellGain.gain.setValueAtTime(0.0001, noteStart);
      bellGain.gain.exponentialRampToValueAtTime(0.09, noteStart + 0.018);
      bellGain.gain.exponentialRampToValueAtTime(0.0001, noteStart + duration);
      shimmerGain.gain.setValueAtTime(0.0001, noteStart);
      shimmerGain.gain.exponentialRampToValueAtTime(0.018, noteStart + 0.012);
      shimmerGain.gain.exponentialRampToValueAtTime(0.0001, noteStart + duration * 0.72);

      bell.connect(bellGain);
      shimmer.connect(shimmerGain);
      bellGain.connect(master);
      shimmerGain.connect(master);
      bell.start(noteStart);
      shimmer.start(noteStart);
      bell.stop(noteStart + duration + 0.02);
      shimmer.stop(noteStart + duration + 0.02);
    });
  } catch (error) {
    console.warn("Correct-answer sound is unavailable.", error);
  }
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="font-label-caps text-label-caps uppercase text-on-surface-variant dark:text-white/60">{label}</span>
        <Icon name={icon} className="text-primary" />
      </div>
      <div className="mt-md font-headline-lg text-3xl font-bold">{value}</div>
    </Card>
  );
}

function SetCard({ set, results, onDelete }: { set: VocabularySet; results: StudyResult[]; onDelete: () => void }) {
  const progress = getSetProgress(set, results);
  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-start justify-between gap-md">
        <div>
          <h2 className="font-headline-md text-xl font-semibold">{set.title}</h2>
          <p className="mt-xs line-clamp-2 text-on-surface-variant dark:text-white/65">{set.description || "Chưa có mô tả."}</p>
        </div>
        <span className="rounded-full bg-primary-fixed px-sm py-xs text-sm font-semibold text-primary">{set.cards.length} từ</span>
      </div>
      <div className="flex flex-wrap gap-xs">
        {set.tags.map((tag) => <span key={tag} className="rounded-full bg-surface-container px-sm py-xs text-sm text-on-surface-variant dark:bg-white/10 dark:text-white/70">{tag}</span>)}
      </div>
      <div>
        <div className="mb-xs flex justify-between text-sm text-on-surface-variant dark:text-white/60"><span>Tiến độ</span><span>{progress}%</span></div>
        <ProgressBar value={progress} />
      </div>
      <div className="text-sm text-on-surface-variant dark:text-white/60">Học gần nhất: {formatDate(set.lastStudiedAt)}</div>
      <div className="grid grid-cols-1 gap-sm sm:grid-cols-3">
        <Link to={`/sets/${set.id}`} className="contents"><Button className="w-full"><Icon name="play_arrow" /> Study</Button></Link>
        <Link to={`/sets/${set.id}/edit`} className="contents"><Button variant="secondary" className="w-full"><Icon name="edit" /> Edit</Button></Link>
        <Button variant="danger" onClick={onDelete}><Icon name="delete" /> Delete</Button>
      </div>
    </Card>
  );
}

export function MobileAppPage({ api }: PageProps) {
  const [view, setView] = useState<"add" | "sets" | "study" | "learn" | "learnPicker" | "mixPicker" | "mix">("add");
  const [learnDirection, setLearnDirection] = useState<LearnDirection | null>(null);
  const [libraryMode, setLibraryMode] = useState<"flashcard" | "learn">("flashcard");
  const [form, setForm] = useState({
    word: "",
    definitionEn: "",
  });
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedSetId, setSelectedSetId] = useState("");
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [flashcardCards, setFlashcardCards] = useState<VocabularyCard[]>([]);
  const [learnCards, setLearnCards] = useState<VocabularyCard[]>([]);
  const [learnIndex, setLearnIndex] = useState(0);
  const [learnCorrect, setLearnCorrect] = useState(0);
  const [learnWrongCardIds, setLearnWrongCardIds] = useState<string[]>([]);
  const [learnFeedback, setLearnFeedback] = useState<{ choice: string; correct: boolean } | null>(null);
  const [mixQuery, setMixQuery] = useState("");
  const [mixPickerIds, setMixPickerIds] = useState<string[]>([]);
  const [mixQueue, setMixQueue] = useState<{ card: VocabularyCard; setId: string }[]>([]);
  const [mixIndex, setMixIndex] = useState(0);
  const [mixCorrect, setMixCorrect] = useState(0);
  const [mixWrongCardIds, setMixWrongCardIds] = useState<string[]>([]);
  const [mixFeedback, setMixFeedback] = useState<{ choice: string; correct: boolean } | null>(null);
  const touchStartX = useRef<number | null>(null);
  const swiped = useRef(false);
  const learnTimer = useRef<number | undefined>(undefined);
  const mixTimer = useRef<number | undefined>(undefined);
  const correctAudio = useRef<AudioContext | null>(null);
  const { speak } = useSpeech(api.data.settings.voiceURI);

  const mobileSets = useMemo(
    () => api.data.sets
      .filter((set) => set.tags.includes("Mobile"))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [api.data.sets],
  );
  const activeSet = mobileSets.find((set) => set.cards.length < 30) ?? mobileSets[mobileSets.length - 1];
  const nextSetNumber = mobileSets.length + (activeSet && activeSet.cards.length < 30 ? 0 : 1);
  const activeCount = activeSet && activeSet.cards.length < 30 ? activeSet.cards.length : 0;
  const learningSets = useMemo(
    () => [...api.data.sets]
      .filter((set) => set.cards.length > 0 && `${set.title} ${set.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [api.data.sets, query],
  );
  const selectedSet = api.data.sets.find((set) => set.id === selectedSetId);
  const activeCard = flashcardCards[cardIndex];
  const activeLearnCard = learnCards[learnIndex];
  const learnDirectionPrompt = activeLearnCard && learnDirection ? quizletPrompt(activeLearnCard, learnDirection) : null;
  const learnPrompt = learnDirectionPrompt?.text ?? "";
  const learnCompletedDirections = useMemo(() => {
    const done = new Set<LearnDirection>();
    api.data.results.forEach((r) => {
      if (r.mode === "learn" && "setId" in r && r.setId === selectedSetId && r.direction) done.add(r.direction);
    });
    return done;
  }, [api.data.results, selectedSetId]);
  const learnChoices = useMemo(() => {
    if (!selectedSet || !activeLearnCard || !learnDirection) return [];
    const field = quizletPrompt(activeLearnCard, learnDirection).answerField;
    const distractors = shuffle(selectedSet.cards)
      .filter((card) => card.id !== activeLearnCard.id && card[field].trim() && card[field] !== activeLearnCard[field])
      .map((card) => card[field])
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 3);
    return shuffle([activeLearnCard[field], ...distractors]);
  }, [activeLearnCard?.id, selectedSetId, learnDirection]);

  const mixPickerSets = useMemo(
    () => [...api.data.sets]
      .filter((set) => set.cards.length > 0 && `${set.title} ${set.tags.join(" ")}`.toLowerCase().includes(mixQuery.trim().toLowerCase()))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [api.data.sets, mixQuery],
  );
  const mixSelectedSets = useMemo(
    () => mixPickerIds.map((id) => api.data.sets.find((set) => set.id === id)).filter((set): set is VocabularySet => Boolean(set)),
    [mixPickerIds, api.data.sets],
  );
  const mixPool = useMemo(
    () => mixSelectedSets.flatMap((set) => set.cards.map((card) => ({ card, setId: set.id }))),
    [mixSelectedSets],
  );
  const activeMixItem = mixQueue[mixIndex];
  const mixPrompt = activeMixItem?.card.definitionEn || activeMixItem?.card.meaningVi || activeMixItem?.card.exampleEn || "";
  const mixChoices = useMemo(() => {
    if (!activeMixItem) return [];
    const distractors = shuffle(mixPool)
      .filter((item) => item.card.id !== activeMixItem.card.id && item.card.word.trim() && item.card.word !== activeMixItem.card.word)
      .map((item) => item.card.word)
      .filter((word, index, words) => words.indexOf(word) === index)
      .slice(0, 3);
    return shuffle([activeMixItem.card.word, ...distractors]);
  }, [activeMixItem?.card.id, mixPool]);
  const mixTitleLabel = mixSelectedSets.length > 1
    ? `${mixSelectedSets[0]?.title} +${mixSelectedSets.length - 1} bộ khác`
    : mixSelectedSets[0]?.title ?? "";

  useEffect(() => {
    if (!flashcardCards.length) return;
    setCardIndex((current) => Math.min(current, flashcardCards.length - 1));
  }, [flashcardCards.length]);

  useEffect(() => () => {
    if (learnTimer.current) window.clearTimeout(learnTimer.current);
    if (mixTimer.current) window.clearTimeout(mixTimer.current);
    correctAudio.current?.close();
  }, []);

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function addWord(event: FormEvent) {
    event.preventDefault();
    const word = form.word.trim();
    const definitionEn = form.definitionEn.trim();
    if (!word || !definitionEn) {
      setMessage("Cần nhập từ tiếng Anh và nghĩa tiếng Anh.");
      return;
    }

    const now = new Date().toISOString();
    const targetSet = activeSet && activeSet.cards.length < 30
      ? activeSet
      : {
          id: `mobile-set-${nextSetNumber}`,
          title: `Mobile Set ${nextSetNumber}`,
          description: "Bộ từ được thêm nhanh từ giao diện điện thoại.",
          tags: ["Mobile"],
          cards: [],
          createdAt: now,
          updatedAt: now,
        } satisfies VocabularySet;

    const card: VocabularyCard = {
      id: crypto.randomUUID(),
      word,
      ipa: "",
      meaningVi: "",
      definitionEn,
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

    const savedSet: VocabularySet = {
      ...targetSet,
      cards: [...targetSet.cards, card],
      updatedAt: now,
    };
    api.upsertSet(savedSet);
    setForm({ word: "", definitionEn: "" });
    const successLog = `${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} - Đã thêm "${word}" = "${definitionEn}" vào ${savedSet.title} (${savedSet.cards.length}/30).`;
    setMessage(successLog);
    setLogs((current) => [successLog, ...current].slice(0, 8));
  }

  function clearLearnTimer() {
    if (learnTimer.current) window.clearTimeout(learnTimer.current);
    learnTimer.current = undefined;
  }

  function openSet(set: VocabularySet) {
    if (!set.cards.length) return;
    clearLearnTimer();
    setSelectedSetId(set.id);
    if (libraryMode === "learn") {
      setView("learnPicker");
    } else {
      setFlashcardCards(shuffle(set.cards));
      setCardIndex(0);
      setFlipped(false);
      setView("study");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function switchView(nextView: "add" | "sets") {
    clearLearnTimer();
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openLibrary(mode: "flashcard" | "learn") {
    setLibraryMode(mode);
    setQuery("");
    switchView("sets");
  }

  function startMobileLearn(direction: LearnDirection) {
    if (!selectedSet) return;
    clearLearnTimer();
    setLearnDirection(direction);
    setLearnCards(shuffle(selectedSet.cards));
    setLearnIndex(0);
    setLearnCorrect(0);
    setLearnWrongCardIds([]);
    setLearnFeedback(null);
    setView("learn");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToLearnPicker() {
    clearLearnTimer();
    setView("learnPicker");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function restartLearn() {
    if (!selectedSet) return;
    clearLearnTimer();
    setLearnCards(shuffle(selectedSet.cards));
    setLearnIndex(0);
    setLearnCorrect(0);
    setLearnWrongCardIds([]);
    setLearnFeedback(null);
  }

  function chooseLearnAnswer(choice: string) {
    if (!selectedSet || !activeLearnCard || !learnDirection || learnFeedback) return;
    const answerField = quizletPrompt(activeLearnCard, learnDirection).answerField;
    const correct = choice === activeLearnCard[answerField];
    const nextCorrect = learnCorrect + (correct ? 1 : 0);
    setLearnFeedback({ choice, correct });
    if (correct) {
      setLearnCorrect(nextCorrect);
      playCorrectChime(correctAudio);
    } else {
      setLearnWrongCardIds((current) => current.includes(activeLearnCard.id) ? current : [...current, activeLearnCard.id]);
    }
    api.updateSet(selectedSet.id, (current) => updateSetCard(current, activeLearnCard.id, (card) => updateCardStudy(card, correct)));

    learnTimer.current = window.setTimeout(() => {
      if (learnIndex === learnCards.length - 1) {
        const wrongCardIds = correct ? learnWrongCardIds : [...new Set([...learnWrongCardIds, activeLearnCard.id])];
        api.setData((current) => ({ ...current, results: [createResult(selectedSet.id, "learn", learnCards.length, nextCorrect, wrongCardIds, learnDirection), ...current.results] }));
      }
      setLearnFeedback(null);
      setLearnIndex((current) => current + 1);
      learnTimer.current = undefined;
    }, 720);
  }

  function clearMixTimer() {
    if (mixTimer.current) window.clearTimeout(mixTimer.current);
    mixTimer.current = undefined;
  }

  function openMixPicker() {
    clearMixTimer();
    setMixQuery("");
    setView("mixPicker");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleMixSet(setId: string) {
    setMixPickerIds((current) => {
      if (current.includes(setId)) return current.filter((id) => id !== setId);
      if (current.length >= MAX_MIX_SETS) return current;
      return [...current, setId];
    });
  }

  function startMix() {
    if (!mixPool.length) return;
    clearMixTimer();
    setMixQueue(shuffle(mixPool));
    setMixIndex(0);
    setMixCorrect(0);
    setMixWrongCardIds([]);
    setMixFeedback(null);
    setView("mix");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function restartMix() {
    if (!mixPool.length) return;
    clearMixTimer();
    setMixQueue(shuffle(mixPool));
    setMixIndex(0);
    setMixCorrect(0);
    setMixWrongCardIds([]);
    setMixFeedback(null);
  }

  function chooseMixAnswer(choice: string) {
    if (!activeMixItem || mixFeedback) return;
    const correct = choice === activeMixItem.card.word;
    const nextCorrect = mixCorrect + (correct ? 1 : 0);
    setMixFeedback({ choice, correct });
    if (correct) {
      setMixCorrect(nextCorrect);
      playCorrectChime(correctAudio);
    } else {
      setMixWrongCardIds((current) => current.includes(activeMixItem.card.id) ? current : [...current, activeMixItem.card.id]);
    }
    api.updateSet(activeMixItem.setId, (current) => updateSetCard(current, activeMixItem.card.id, (card) => updateCardStudy(card, correct)));

    mixTimer.current = window.setTimeout(() => {
      if (mixIndex === mixQueue.length - 1) {
        const wrongCardIds = correct ? mixWrongCardIds : [...new Set([...mixWrongCardIds, activeMixItem.card.id])];
        api.setData((current) => ({ ...current, results: [createResult(mixPickerIds.join(","), "learn", mixQueue.length, nextCorrect, wrongCardIds), ...current.results] }));
      }
      setMixFeedback(null);
      setMixIndex((current) => current + 1);
      mixTimer.current = undefined;
    }, 720);
  }

  function moveCard(offset: number) {
    if (!flashcardCards.length) return;
    const nextIndex = Math.max(0, Math.min(flashcardCards.length - 1, cardIndex + offset));
    if (nextIndex === cardIndex) return;
    setFlipped(false);
    setCardIndex(nextIndex);
  }

  function startSwipe(event: ReactTouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
    swiped.current = false;
  }

  function endSwipe(event: ReactTouchEvent) {
    if (touchStartX.current === null) return;
    const distance = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(distance) < 48) return;
    swiped.current = true;
    moveCard(distance < 0 ? 1 : -1);
  }

  if (view === "study" && selectedSet && activeCard) {
    return (
      <main className="mobile-app-shell min-h-screen overflow-x-hidden bg-[#f4f5fb] text-on-background dark:bg-[#17191a] dark:text-white">
        <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-container-margin pb-[max(20px,env(safe-area-inset-bottom))]">
          <header className="sticky top-0 z-20 -mx-container-margin flex items-center gap-sm border-b border-surface-variant bg-[#f4f5fb]/95 px-container-margin py-md backdrop-blur dark:border-white/10 dark:bg-[#17191a]/95">
            <button
              type="button"
              aria-label="Quay lại danh sách học phần"
              onClick={() => switchView("sets")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-on-surface shadow-level-1 active:scale-95 dark:bg-white/10 dark:text-white"
            >
              <Icon name="arrow_back" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate font-headline-md text-lg font-bold">{selectedSet.title}</div>
              <div className="text-sm text-on-surface-variant dark:text-white/60">{cardIndex + 1} / {flashcardCards.length}</div>
            </div>
            <button
              type="button"
              aria-label={`Phát âm ${activeCard.word}`}
              onClick={() => speak(activeCard.word)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-level-2 active:scale-95"
            >
              <Icon name="volume_up" />
            </button>
          </header>

          <div className="py-md">
            <ProgressBar value={percent(cardIndex + 1, flashcardCards.length)} />
          </div>

          <div className="flex flex-1 flex-col justify-center pb-md">
            <div
              key={activeCard.id}
              role="button"
              tabIndex={0}
              aria-label={flipped ? "Mặt nghĩa của flashcard. Chạm để xem từ." : "Mặt từ của flashcard. Chạm để xem nghĩa."}
              onClick={() => {
                if (swiped.current) {
                  swiped.current = false;
                  return;
                }
                setFlipped((current) => !current);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setFlipped((current) => !current);
                }
              }}
              onTouchStart={startSwipe}
              onTouchEnd={endSwipe}
              className="mobile-flashcard relative h-[min(58dvh,520px)] min-h-[360px] w-full cursor-pointer select-none outline-none [perspective:1200px] focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <div className={`card-flip relative h-full w-full ${flipped ? "flipped" : ""}`}>
                <article className="card-face absolute inset-0 flex flex-col items-center justify-center rounded-[28px] border border-surface-variant bg-white p-xl text-center shadow-[0_18px_50px_rgba(53,37,205,0.12)] dark:border-white/10 dark:bg-[#242728]">
                  <span className="mb-lg rounded-full bg-primary-fixed px-md py-xs text-sm font-bold uppercase tracking-wide text-primary">{activeCard.partOfSpeech || "word"}</span>
                  <h1 className="break-words font-display-word text-4xl font-bold leading-tight text-on-surface dark:text-white">{activeCard.word}</h1>
                  {activeCard.ipa ? <p className="mt-md text-xl text-on-surface-variant dark:text-white/60">{activeCard.ipa}</p> : null}
                  <p className="absolute bottom-lg text-sm font-semibold text-on-surface-variant dark:text-white/50">Chạm để xem nghĩa</p>
                </article>
                <article className="card-face card-back absolute inset-0 flex flex-col rounded-[28px] border border-primary/20 bg-primary-fixed p-xl text-left shadow-[0_18px_50px_rgba(53,37,205,0.16)] dark:border-primary/30 dark:bg-[#29264a]">
                  <div className="flex-1 overflow-y-auto">
                    <div className="text-sm font-bold uppercase tracking-wide text-primary dark:text-[#c9c5ff]">{activeCard.meaningVi ? "Nghĩa tiếng Việt" : "Meaning English"}</div>
                    <h2 className="mt-sm break-words font-translation-text text-3xl font-bold leading-tight text-primary dark:text-white">{activeCard.meaningVi || activeCard.definitionEn}</h2>
                    {activeCard.meaningVi && activeCard.definitionEn ? <p className="mt-lg text-lg leading-relaxed text-on-surface dark:text-white/85">{activeCard.definitionEn}</p> : null}
                    {activeCard.exampleEn ? (
                      <div className="mt-lg rounded-2xl bg-white/70 p-md dark:bg-white/10">
                        <p className="italic leading-relaxed">{activeCard.exampleEn}</p>
                        {activeCard.exampleVi ? <p className="mt-sm text-on-surface-variant dark:text-white/65">{activeCard.exampleVi}</p> : null}
                      </div>
                    ) : null}
                  </div>
                  <p className="pt-md text-center text-sm font-semibold text-primary dark:text-[#c9c5ff]">Chạm để xem lại từ</p>
                </article>
              </div>
            </div>
            <p className="mt-md text-center text-xs font-semibold text-on-surface-variant dark:text-white/50">Vuốt sang trái/phải để chuyển thẻ</p>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] gap-sm">
            <Button type="button" variant="secondary" disabled={cardIndex === 0} onClick={() => moveCard(-1)} className="min-h-12 px-sm"><Icon name="chevron_left" /> Trước</Button>
            <Button type="button" variant="secondary" onClick={() => speak(activeCard.word)} className="h-12 w-12 rounded-full px-0" aria-label="Phát âm"><Icon name="volume_up" /></Button>
            <Button type="button" disabled={cardIndex === flashcardCards.length - 1} onClick={() => moveCard(1)} className="min-h-12 px-sm">Tiếp <Icon name="chevron_right" /></Button>
          </div>
        </div>
      </main>
    );
  }

  if (view === "learnPicker" && selectedSet) {
    return (
      <main className="mobile-app-shell min-h-screen overflow-x-hidden bg-[#f4f5fb] text-on-background dark:bg-[#17191a] dark:text-white">
        <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-container-margin pb-[max(20px,env(safe-area-inset-bottom))]">
          <header className="sticky top-0 z-20 -mx-container-margin flex items-center gap-sm border-b border-surface-variant bg-[#f4f5fb]/95 px-container-margin py-md backdrop-blur dark:border-white/10 dark:bg-[#17191a]/95">
            <button
              type="button"
              aria-label="Quay lại danh sách học phần"
              onClick={() => openLibrary("learn")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-on-surface shadow-level-1 active:scale-95 dark:bg-white/10 dark:text-white"
            >
              <Icon name="arrow_back" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate font-headline-md text-lg font-bold">{selectedSet.title}</div>
              <div className="text-sm text-on-surface-variant dark:text-white/60">Chọn chế độ Learn</div>
            </div>
          </header>
          <p className="py-md text-sm text-on-surface-variant dark:text-white/60">Hoàn thành cả 3 chế độ để bộ từ được tính là đã học xong.</p>
          <div className="grid gap-sm">
            {LEARN_DIRECTIONS.map((direction) => {
              const meta = DIRECTION_META[direction];
              const done = learnCompletedDirections.has(direction);
              return (
                <button
                  type="button"
                  key={direction}
                  onClick={() => startMobileLearn(direction)}
                  className={`flex items-center gap-md rounded-2xl border-2 bg-white p-md text-left shadow-level-1 transition active:scale-[0.98] dark:bg-[#242728] ${done ? "border-emerald-500" : "border-surface-variant dark:border-white/10"}`}
                >
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-primary-fixed text-primary"}`}>
                    <Icon name={done ? "check_circle" : meta.icon} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-lg">{meta.label}</strong>
                    <span className="mt-xs block text-sm text-on-surface-variant dark:text-white/60">{meta.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </main>
    );
  }

  if (view === "learn" && selectedSet && learnDirection) {
    const learnComplete = learnIndex >= learnCards.length;
    return (
      <main className="mobile-app-shell min-h-screen overflow-x-hidden bg-[#f4f5fb] text-on-background dark:bg-[#17191a] dark:text-white">
        <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-container-margin pb-[max(20px,env(safe-area-inset-bottom))]">
          <header className="sticky top-0 z-20 -mx-container-margin flex items-center gap-sm border-b border-surface-variant bg-[#f4f5fb]/95 px-container-margin py-md backdrop-blur dark:border-white/10 dark:bg-[#17191a]/95">
            <button
              type="button"
              aria-label="Quay lại chọn chế độ"
              onClick={backToLearnPicker}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-on-surface shadow-level-1 active:scale-95 dark:bg-white/10 dark:text-white"
            >
              <Icon name="arrow_back" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate font-headline-md text-lg font-bold">{selectedSet.title}</div>
              <div className="text-sm text-on-surface-variant dark:text-white/60">Learn · {DIRECTION_META[learnDirection].label}</div>
            </div>
            <span className="flex h-11 min-w-11 items-center justify-center rounded-full bg-emerald-600 px-sm font-bold text-white">{learnCorrect}</span>
          </header>

          {learnComplete ? (
            <section className="mobile-learn-enter flex flex-1 flex-col items-center justify-center py-xl text-center">
              <span className="mobile-learn-success flex h-24 w-24 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_18px_44px_rgba(5,150,105,0.28)]"><Icon name="check" className="text-5xl" /></span>
              <h1 className="mt-lg font-headline-lg text-3xl font-bold">Hoàn thành</h1>
              <p className="mt-sm text-lg text-on-surface-variant dark:text-white/65">Bạn trả lời đúng {learnCorrect}/{learnCards.length} câu.</p>
              <div className="mt-xl grid w-full gap-sm">
                <Button type="button" onClick={restartLearn} className="min-h-14 text-lg"><Icon name="refresh" /> Học lại</Button>
                <Button type="button" variant="secondary" onClick={backToLearnPicker} className="min-h-14"><Icon name="swap_horiz" /> Đổi chế độ</Button>
                <Button type="button" variant="secondary" onClick={() => openLibrary("learn")} className="min-h-14"><Icon name="library_books" /> Chọn set khác</Button>
              </div>
            </section>
          ) : activeLearnCard ? (
            <>
              <div className="py-md">
                <div className="mb-sm flex items-center justify-between text-sm font-bold text-on-surface-variant dark:text-white/60">
                  <span>{learnIndex + 1} / {learnCards.length}</span>
                  <span>{percent(learnIndex, learnCards.length)}%</span>
                </div>
                <ProgressBar value={percent(learnIndex, learnCards.length)} />
              </div>

              <section key={activeLearnCard.id} className={`mobile-learn-enter relative flex flex-1 flex-col rounded-[28px] border bg-white p-lg shadow-[0_18px_50px_rgba(15,23,42,0.08)] transition-colors dark:bg-[#242728] ${learnFeedback?.correct ? "mobile-learn-correct border-emerald-500" : "border-surface-variant dark:border-white/10"}`}>
                {learnFeedback?.correct ? <span className="mobile-learn-success absolute right-md top-md flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-white shadow-level-2"><Icon name="check" /></span> : null}
                <div className="flex items-center gap-sm text-sm font-bold text-on-surface-variant dark:text-white/65">
                  <span>{learnDirectionPrompt?.label}</span>
                  <button type="button" onClick={() => speak(learnPrompt)} aria-label="Phát nội dung câu hỏi" className="flex h-9 w-9 items-center justify-center rounded-full text-primary active:bg-primary-fixed dark:text-[#c9c5ff]"><Icon name="volume_up" className="text-xl" /></button>
                </div>
                <p className="mt-lg min-h-28 break-words text-2xl font-medium leading-relaxed text-[#101936] dark:text-white">{learnPrompt}</p>

                <div className="mt-auto pt-xl">
                  <h2 className="mb-md text-sm font-bold text-on-surface-variant dark:text-white/65">Chọn một đáp án</h2>
                  <div className="grid gap-sm">
                    {learnChoices.map((choice, index) => {
                      const isAnswer = choice === activeLearnCard[learnDirectionPrompt!.answerField];
                      const isWrongChoice = Boolean(learnFeedback && learnFeedback.choice === choice && !learnFeedback.correct);
                      const showCorrect = Boolean(learnFeedback && isAnswer);
                      return (
                        <button
                          type="button"
                          key={choice}
                          disabled={Boolean(learnFeedback)}
                          onClick={() => chooseLearnAnswer(choice)}
                          className={`flex min-h-16 items-center gap-md rounded-2xl border-2 px-md text-left text-lg font-semibold transition-all duration-200 active:scale-[0.98] disabled:cursor-default ${
                            showCorrect
                              ? "mobile-learn-choice-correct border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                              : isWrongChoice
                                ? "border-red-400 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200"
                                : learnFeedback
                                  ? "border-surface-variant bg-white opacity-45 dark:border-white/10 dark:bg-white/5"
                                  : "border-[#e0e4ee] bg-white text-[#17223f] shadow-[0_2px_8px_rgba(15,23,42,0.03)] dark:border-white/10 dark:bg-white/5 dark:text-white"
                          }`}
                        >
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${showCorrect ? "bg-emerald-600 text-white" : isWrongChoice ? "bg-red-500 text-white" : "bg-[#eef1f7] text-[#5f6b88] dark:bg-white/10 dark:text-white/70"}`}>{showCorrect ? <Icon name="check" className="text-lg" /> : index + 1}</span>
                          <span className="min-w-0 flex-1 break-words">{choice}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" disabled={Boolean(learnFeedback)} onClick={() => chooseLearnAnswer("__dont_know__")} className="mt-lg w-full py-sm text-center font-bold text-primary disabled:opacity-50 dark:text-[#c9c5ff]">Không biết?</button>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </main>
    );
  }

  if (view === "mixPicker") {
    return (
      <main className="mobile-app-shell min-h-screen overflow-x-hidden bg-[#f4f5fb] text-on-background dark:bg-[#17191a] dark:text-white">
        <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-container-margin pb-32">
          <header className="sticky top-0 z-20 -mx-container-margin mb-lg border-b border-surface-variant bg-[#f4f5fb]/95 px-container-margin py-md backdrop-blur dark:border-white/10 dark:bg-[#17191a]/95">
            <div className="min-w-0 flex-1">
              <h1 className="font-headline-md text-2xl font-bold text-primary dark:text-[#c9c5ff]">Mix Sets</h1>
              <p className="mt-xs text-sm text-on-surface-variant dark:text-white/60">Chọn tối đa {MAX_MIX_SETS} bộ (kể cả bộ đã học) để trộn ngẫu nhiên.</p>
            </div>
            <div className="relative mt-md">
              <Icon name="search" className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <Input value={mixQuery} onChange={(event) => setMixQuery(event.target.value)} placeholder="Tìm học phần..." className="min-h-12 pl-12" />
            </div>
            <div className="mt-sm text-sm font-bold text-primary dark:text-[#c9c5ff]">{mixPickerIds.length}/{MAX_MIX_SETS} bộ đã chọn · {mixPool.length} từ</div>
          </header>

          {mixPickerSets.length ? (
            <div className="flex-1 space-y-sm">
              {mixPickerSets.map((set) => {
                const checked = mixPickerIds.includes(set.id);
                const disabled = !checked && mixPickerIds.length >= MAX_MIX_SETS;
                return (
                  <button
                    type="button"
                    key={set.id}
                    disabled={disabled}
                    onClick={() => toggleMixSet(set.id)}
                    className={`flex w-full items-center gap-md rounded-2xl border-2 bg-white p-md text-left shadow-level-1 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 dark:bg-[#242728] ${checked ? "border-primary bg-primary-fixed dark:bg-primary/15" : "border-transparent dark:border-white/10"}`}
                  >
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 ${checked ? "border-primary bg-primary text-white" : "border-surface-variant text-transparent dark:border-white/20"}`}>
                      <Icon name="check" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-lg">{set.title}</strong>
                      <span className="mt-xs block text-sm text-on-surface-variant dark:text-white/60">{set.cards.length} từ · {getSetProgress(set, api.data.results)}% đã thuộc</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-outline-variant bg-white p-xl text-center dark:border-white/20 dark:bg-[#242728]">
              <Icon name="layers" className="text-5xl text-primary" />
              <h2 className="mt-md font-headline-md text-xl font-bold">Chưa có học phần phù hợp</h2>
              <p className="mt-sm text-sm text-on-surface-variant dark:text-white/60">Thử từ khóa khác.</p>
            </div>
          )}
        </div>

        <div className="fixed inset-x-0 bottom-16 z-30 border-t border-surface-variant bg-white/95 px-container-margin py-sm backdrop-blur dark:border-white/10 dark:bg-[#202324]/95">
          <div className="mx-auto max-w-md">
            <Button type="button" className="w-full py-md text-lg" disabled={!mixPickerIds.length} onClick={startMix}>
              <Icon name="play_arrow" /> Bắt đầu học trộn ({mixPool.length} từ)
            </Button>
          </div>
        </div>

        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-variant bg-white/95 backdrop-blur dark:border-white/10 dark:bg-[#202324]/95" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto grid max-w-md grid-cols-4 gap-xs px-container-margin pt-sm">
            <button type="button" onClick={() => switchView("add")} className="flex min-h-14 flex-col items-center justify-center gap-xs rounded-2xl text-xs font-bold text-on-surface-variant transition active:scale-95 dark:text-white/60"><Icon name="add_circle" /> Thêm từ</button>
            <button type="button" onClick={() => openLibrary("flashcard")} className="flex min-h-14 flex-col items-center justify-center gap-xs rounded-2xl text-xs font-bold text-on-surface-variant transition active:scale-95 dark:text-white/60"><Icon name="style" /> Flashcard</button>
            <button type="button" onClick={() => openLibrary("learn")} className="flex min-h-14 flex-col items-center justify-center gap-xs rounded-2xl text-xs font-bold text-on-surface-variant transition active:scale-95 dark:text-white/60"><Icon name="school" /> Learn</button>
            <button type="button" onClick={openMixPicker} className="flex min-h-14 flex-col items-center justify-center gap-xs rounded-2xl bg-primary-fixed text-xs font-bold text-primary transition active:scale-95 dark:bg-primary/25 dark:text-white"><Icon name="layers" /> Mix</button>
          </div>
        </nav>
      </main>
    );
  }

  if (view === "mix") {
    const mixComplete = mixIndex >= mixQueue.length;
    return (
      <main className="mobile-app-shell min-h-screen overflow-x-hidden bg-[#f4f5fb] text-on-background dark:bg-[#17191a] dark:text-white">
        <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-container-margin pb-[max(20px,env(safe-area-inset-bottom))]">
          <header className="sticky top-0 z-20 -mx-container-margin flex items-center gap-sm border-b border-surface-variant bg-[#f4f5fb]/95 px-container-margin py-md backdrop-blur dark:border-white/10 dark:bg-[#17191a]/95">
            <button
              type="button"
              aria-label="Quay lại danh sách trộn bộ"
              onClick={openMixPicker}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-on-surface shadow-level-1 active:scale-95 dark:bg-white/10 dark:text-white"
            >
              <Icon name="arrow_back" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate font-headline-md text-lg font-bold">{mixTitleLabel}</div>
              <div className="text-sm text-on-surface-variant dark:text-white/60">Mix · {mixSelectedSets.length} bộ</div>
            </div>
            <span className="flex h-11 min-w-11 items-center justify-center rounded-full bg-emerald-600 px-sm font-bold text-white">{mixCorrect}</span>
          </header>

          {mixComplete ? (
            <section className="mobile-learn-enter flex flex-1 flex-col items-center justify-center py-xl text-center">
              <span className="mobile-learn-success flex h-24 w-24 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_18px_44px_rgba(5,150,105,0.28)]"><Icon name="check" className="text-5xl" /></span>
              <h1 className="mt-lg font-headline-lg text-3xl font-bold">Hoàn thành</h1>
              <p className="mt-sm text-lg text-on-surface-variant dark:text-white/65">Bạn trả lời đúng {mixCorrect}/{mixQueue.length} câu.</p>
              <div className="mt-xl grid w-full gap-sm">
                <Button type="button" onClick={restartMix} className="min-h-14 text-lg"><Icon name="refresh" /> Học lại</Button>
                <Button type="button" variant="secondary" onClick={openMixPicker} className="min-h-14"><Icon name="layers" /> Chọn bộ khác</Button>
              </div>
            </section>
          ) : activeMixItem ? (
            <>
              <div className="py-md">
                <div className="mb-sm flex items-center justify-between text-sm font-bold text-on-surface-variant dark:text-white/60">
                  <span>{mixIndex + 1} / {mixQueue.length}</span>
                  <span>{percent(mixIndex, mixQueue.length)}%</span>
                </div>
                <ProgressBar value={percent(mixIndex, mixQueue.length)} />
              </div>

              <section key={activeMixItem.card.id} className={`mobile-learn-enter relative flex flex-1 flex-col rounded-[28px] border bg-white p-lg shadow-[0_18px_50px_rgba(15,23,42,0.08)] transition-colors dark:bg-[#242728] ${mixFeedback?.correct ? "mobile-learn-correct border-emerald-500" : "border-surface-variant dark:border-white/10"}`}>
                {mixFeedback?.correct ? <span className="mobile-learn-success absolute right-md top-md flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-white shadow-level-2"><Icon name="check" /></span> : null}
                <div className="flex items-center gap-sm text-sm font-bold text-on-surface-variant dark:text-white/65">
                  <span>{activeMixItem.card.definitionEn ? "Definition" : activeMixItem.card.meaningVi ? "Nghĩa" : "Example"}</span>
                  <button type="button" onClick={() => speak(mixPrompt)} aria-label="Phát nội dung câu hỏi" className="flex h-9 w-9 items-center justify-center rounded-full text-primary active:bg-primary-fixed dark:text-[#c9c5ff]"><Icon name="volume_up" className="text-xl" /></button>
                </div>
                <p className="mt-lg min-h-28 break-words text-2xl font-medium leading-relaxed text-[#101936] dark:text-white">{mixPrompt}</p>

                <div className="mt-auto pt-xl">
                  <h2 className="mb-md text-sm font-bold text-on-surface-variant dark:text-white/65">Chọn một đáp án</h2>
                  <div className="grid gap-sm">
                    {mixChoices.map((choice, index) => {
                      const isAnswer = choice === activeMixItem.card.word;
                      const isWrongChoice = Boolean(mixFeedback && mixFeedback.choice === choice && !mixFeedback.correct);
                      const showCorrect = Boolean(mixFeedback && isAnswer);
                      return (
                        <button
                          type="button"
                          key={choice}
                          disabled={Boolean(mixFeedback)}
                          onClick={() => chooseMixAnswer(choice)}
                          className={`flex min-h-16 items-center gap-md rounded-2xl border-2 px-md text-left text-lg font-semibold transition-all duration-200 active:scale-[0.98] disabled:cursor-default ${
                            showCorrect
                              ? "mobile-learn-choice-correct border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                              : isWrongChoice
                                ? "border-red-400 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200"
                                : mixFeedback
                                  ? "border-surface-variant bg-white opacity-45 dark:border-white/10 dark:bg-white/5"
                                  : "border-[#e0e4ee] bg-white text-[#17223f] shadow-[0_2px_8px_rgba(15,23,42,0.03)] dark:border-white/10 dark:bg-white/5 dark:text-white"
                          }`}
                        >
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${showCorrect ? "bg-emerald-600 text-white" : isWrongChoice ? "bg-red-500 text-white" : "bg-[#eef1f7] text-[#5f6b88] dark:bg-white/10 dark:text-white/70"}`}>{showCorrect ? <Icon name="check" className="text-lg" /> : index + 1}</span>
                          <span className="min-w-0 flex-1 break-words">{choice}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" disabled={Boolean(mixFeedback)} onClick={() => chooseMixAnswer("__dont_know__")} className="mt-lg w-full py-sm text-center font-bold text-primary disabled:opacity-50 dark:text-[#c9c5ff]">Không biết?</button>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="mobile-app-shell min-h-screen overflow-x-hidden bg-[#f4f5fb] text-on-background dark:bg-[#17191a] dark:text-white">
      <div className="mx-auto min-h-[100dvh] max-w-md px-container-margin pb-28">
        <header className="sticky top-0 z-20 -mx-container-margin mb-lg border-b border-surface-variant bg-[#f4f5fb]/95 px-container-margin py-md backdrop-blur dark:border-white/10 dark:bg-[#17191a]/95">
          <div className="flex items-center justify-between gap-md">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-on-surface-variant dark:text-white/50">Local English</div>
              <h1 className="font-headline-md text-2xl font-bold text-primary dark:text-[#c9c5ff]">{view === "add" ? "Thêm từ nhanh" : libraryMode === "learn" ? "Learn" : "Học Flashcard"}</h1>
            </div>
            <span className={`h-2.5 w-2.5 rounded-full ${api.syncState === "error" ? "bg-red-500" : api.syncState === "idle" ? "bg-emerald-500" : "animate-pulse bg-amber-500"}`} title={`Sync: ${api.syncState}`} />
          </div>
          {view === "add" ? (
            <div className="mt-xs text-sm text-on-surface-variant dark:text-white/60">
              {activeSet && activeSet.cards.length < 30 ? `${activeSet.title}: ${activeCount}/30` : `Sẽ tạo Mobile Set ${nextSetNumber}`}
            </div>
          ) : <p className="mt-xs text-sm text-on-surface-variant dark:text-white/60">{libraryMode === "learn" ? "Chọn set để luyện definition và từ vựng." : "Chọn một học phần để bắt đầu học."}</p>}
        </header>

        {view === "add" ? (
          <>
            <form onSubmit={addWord} className="space-y-md rounded-2xl border border-surface-variant bg-white p-lg shadow-level-1 dark:border-white/10 dark:bg-[#242728]">
              <label className="block">
                <span className="font-semibold">Word</span>
                <Input autoFocus value={form.word} onChange={(event) => updateField("word", event.target.value)} placeholder="abandon" autoCapitalize="none" autoCorrect="off" />
              </label>
              <label className="block">
                <span className="font-semibold">Meaning EN</span>
                <Input value={form.definitionEn} onChange={(event) => updateField("definitionEn", event.target.value)} placeholder="to leave something permanently" autoCapitalize="sentences" />
              </label>
              {message ? <div className="rounded-xl bg-primary-fixed p-md text-sm font-semibold text-primary">{message}</div> : null}
              {api.syncError ? <div className="rounded-xl bg-error-container p-md text-sm font-semibold text-red-900">{api.syncError}</div> : null}
              <Button type="submit" className="w-full py-md text-lg"><Icon name="add" /> Thêm từ</Button>
            </form>
            <section className="mt-lg rounded-2xl border border-surface-variant bg-white p-lg shadow-level-1 dark:border-white/10 dark:bg-[#242728]">
              <h2 className="font-headline-md text-lg font-semibold">Log thêm từ</h2>
              {logs.length ? (
                <div className="mt-md space-y-sm">
                  {logs.map((log, index) => (
                    <div key={`${log}-${index}`} className="rounded-xl bg-surface-container-low p-md text-sm text-on-surface-variant dark:bg-white/5 dark:text-white/65">{log}</div>
                  ))}
                </div>
              ) : <p className="mt-sm text-sm text-on-surface-variant dark:text-white/60">Chưa thêm từ nào trong phiên này.</p>}
            </section>
          </>
        ) : (
          <section>
            <div className="relative mb-md">
              <Icon name="search" className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm học phần..." className="min-h-12 pl-12" />
            </div>
            {learningSets.length ? (
              <div className="space-y-sm">
                {learningSets.map((set) => (
                  <button
                    type="button"
                    key={set.id}
                    onClick={() => openSet(set)}
                    className="flex w-full items-center gap-md rounded-2xl border border-surface-variant bg-white p-md text-left shadow-level-1 transition active:scale-[0.98] dark:border-white/10 dark:bg-[#242728]"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-fixed text-primary dark:bg-primary/25 dark:text-[#c9c5ff]"><Icon name={libraryMode === "learn" ? "school" : "style"} /></span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-lg">{set.title}</strong>
                      <span className="mt-xs block text-sm text-on-surface-variant dark:text-white/60">{set.cards.length} từ · {getSetProgress(set, api.data.results)}% đã thuộc</span>
                    </span>
                    <Icon name="chevron_right" className="shrink-0 text-on-surface-variant dark:text-white/50" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-outline-variant bg-white p-xl text-center dark:border-white/20 dark:bg-[#242728]">
                <Icon name={libraryMode === "learn" ? "school" : "style"} className="text-5xl text-primary" />
                <h2 className="mt-md font-headline-md text-xl font-bold">Chưa có học phần phù hợp</h2>
                <p className="mt-sm text-sm text-on-surface-variant dark:text-white/60">Thêm từ mới hoặc thử từ khóa khác.</p>
              </div>
            )}
          </section>
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-variant bg-white/95 backdrop-blur dark:border-white/10 dark:bg-[#202324]/95" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto grid max-w-md grid-cols-4 gap-xs px-container-margin pt-sm">
          <button type="button" onClick={() => switchView("add")} className={`flex min-h-14 flex-col items-center justify-center gap-xs rounded-2xl text-xs font-bold transition active:scale-95 ${view === "add" ? "bg-primary-fixed text-primary dark:bg-primary/25 dark:text-white" : "text-on-surface-variant dark:text-white/60"}`}><Icon name="add_circle" /> Thêm từ</button>
          <button type="button" onClick={() => openLibrary("flashcard")} className={`flex min-h-14 flex-col items-center justify-center gap-xs rounded-2xl text-xs font-bold transition active:scale-95 ${view === "sets" && libraryMode === "flashcard" ? "bg-primary-fixed text-primary dark:bg-primary/25 dark:text-white" : "text-on-surface-variant dark:text-white/60"}`}><Icon name="style" /> Flashcard</button>
          <button type="button" onClick={() => openLibrary("learn")} className={`flex min-h-14 flex-col items-center justify-center gap-xs rounded-2xl text-xs font-bold transition active:scale-95 ${view === "sets" && libraryMode === "learn" ? "bg-primary-fixed text-primary dark:bg-primary/25 dark:text-white" : "text-on-surface-variant dark:text-white/60"}`}><Icon name="school" /> Learn</button>
          <button type="button" onClick={openMixPicker} className="flex min-h-14 flex-col items-center justify-center gap-xs rounded-2xl text-xs font-bold text-on-surface-variant transition active:scale-95 dark:text-white/60"><Icon name="layers" /> Mix</button>
        </div>
      </nav>
    </main>
  );
}

export function DashboardPage({ api }: PageProps) {
  const navigate = useNavigate();
  const cards = api.data.sets.flatMap((set) => set.cards);
  const due = cards.filter((card) => card.nextReviewAt && new Date(card.nextReviewAt) <= new Date()).length;
  const masteredWords = useMemo(() => getMasteryStatusCounts(api.data.sets, api.data.results).mastered, [api.data.sets, api.data.results]);
  const recent = [...api.data.sets].sort((a, b) => (b.lastStudiedAt ?? b.updatedAt).localeCompare(a.lastStudiedAt ?? a.updatedAt)).slice(0, 3);
  return (
    <>
      <PageTitle title="Bảng điều khiển" subtitle="Học từ vựng local, không cần đăng nhập, dữ liệu nằm trong trình duyệt của bạn." action={<Button onClick={() => navigate("/sets/new")}><Icon name="add" /> Tạo học phần</Button>} />
      <div className="grid grid-cols-2 gap-md lg:grid-cols-4">
        <Stat label="Tổng số từ" value={cards.length} icon="dictionary" />
        <Stat label="Học phần" value={api.data.sets.length} icon="library_books" />
        <Stat label="Đã thuộc" value={masteredWords} icon="verified" />
        <Stat label="Ôn hôm nay" value={due} icon="event_repeat" />
      </div>
      <div className="mt-lg grid gap-lg lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <h2 className="font-headline-md text-headline-md">Hành động nhanh</h2>
        <div className="mt-md grid gap-md sm:grid-cols-3">
            <Button onClick={() => navigate("/sets/new")} className="min-h-28 flex-col"><Icon name="add_circle" /> Tạo bộ mới</Button>
            <Button variant="secondary" onClick={() => navigate("/sets")} className="min-h-28 flex-col"><Icon name="search" /> Tìm học phần</Button>
            <Button variant="secondary" onClick={() => navigate("/progress")} className="min-h-28 flex-col"><Icon name="leaderboard" /> Xem tiến độ</Button>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-headline-md text-headline-md">Học gần đây</h2>
            <Link className="font-semibold text-primary" to="/sets">Xem tất cả</Link>
          </div>
          <div className="mt-md space-y-sm">
            {recent.map((set) => (
              <button key={set.id} onClick={() => navigate(`/sets/${set.id}`)} className="w-full rounded-xl border border-surface-variant bg-surface-container-lowest p-md text-left transition hover:border-primary dark:border-white/10 dark:bg-white/5">
                <div className="flex justify-between gap-md"><strong>{set.title}</strong><span>{getSetProgress(set, api.data.results)}%</span></div>
                <ProgressBar value={getSetProgress(set, api.data.results)} />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

/**
 * "My Sets" có 3 tầng: TAB (cờ trạng thái: chưa hoàn thành / đã hoàn thành /
 * từ khó nhớ) → DANH SÁCH (thư mục người dùng tự đặt tên, ví dụ c1_c2) → SET.
 *
 * Hai tab đầu KHÔNG phải là danh sách — chúng lọc theo trạng thái học, và bên
 * trong mỗi tab đó là lưới các danh sách; bấm vào một danh sách mới thấy các
 * set thuộc danh sách đó (đã lọc theo đúng trạng thái của tab đang mở). Tab
 * "Từ khó nhớ" không có khái niệm danh sách — nó luôn hiển thị thẳng các bộ
 * sao tự dựng, vì bản thân nó cũng chỉ là một cờ trạng thái như hai tab kia.
 */
export function MySetsPage({ api, reading }: SetsPageProps) {
  const [activeTab, setActiveTab] = useState<"learning" | "completed" | "starred">("learning");
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creatingList, setCreatingList] = useState(false);
  const [newListTitle, setNewListTitle] = useState("");
  const [multiPickerOpen, setMultiPickerOpen] = useState(false);
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);
  const [wordCount, setWordCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const navigate = useNavigate();

  function switchTab(tab: "learning" | "completed" | "starred") {
    setActiveTab(tab);
    setSelectedListId(null);
    setQuery("");
    setSyncMessage("");
  }

  const learnedSetIds = useMemo(() => {
    const directionsBySet = new Map<string, Set<LearnDirection>>();
    api.data.results.forEach((r) => {
      if (r.mode !== "learn" || !("setId" in r) || !r.direction) return;
      const setId = r.setId;
      if (!directionsBySet.has(setId)) directionsBySet.set(setId, new Set());
      directionsBySet.get(setId)!.add(r.direction);
    });
    const completed = new Set<string>();
    directionsBySet.forEach((directions, setId) => {
      if (LEARN_DIRECTIONS.every((d) => directions.has(d))) completed.add(setId);
    });
    return completed;
  }, [api.data.results]);

  // Set thuộc tab đang mở — CHƯA lọc theo danh sách. Đây là nguồn để đếm số
  // học phần trên từng thẻ danh sách, và để lọc tiếp khi đã chọn một danh sách.
  const tabSets = useMemo(() => {
    if (activeTab === "starred") return api.data.sets.filter(isStarSet);
    return api.data.sets.filter((set) => {
      if (isStarSet(set)) return false;
      const isLearned = learnedSetIds.has(set.id);
      return activeTab === "completed" ? isLearned : !isLearned;
    });
  }, [api.data.sets, activeTab, learnedSetIds]);

  const selectedList = selectedListId ? api.data.lists.find((list) => list.id === selectedListId) ?? null : null;

  const listSets = useMemo(
    () => (selectedListId ? tabSets.filter((set) => set.listId === selectedListId) : []),
    [tabSets, selectedListId],
  );

  const filtered = listSets.filter((set) => `${set.title} ${set.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));

  const multiPoolTotal = useMemo(
    () => listSets.filter((set) => selectedSetIds.includes(set.id)).reduce((sum, set) => sum + set.cards.length, 0),
    [listSets, selectedSetIds],
  );

  useEffect(() => {
    setWordCount((current) => (multiPoolTotal === 0 ? 0 : current <= 0 || current > multiPoolTotal ? multiPoolTotal : current));
  }, [multiPoolTotal]);

  function toggleSetSelection(setId: string) {
    setSelectedSetIds((current) => {
      if (current.includes(setId)) return current.filter((id) => id !== setId);
      if (current.length >= MAX_MIX_SETS) return current;
      return [...current, setId];
    });
  }

  function startMultiLearn() {
    if (!selectedSetIds.length || wordCount < 1) return;
    navigate(`/study/multi/learn?sets=${selectedSetIds.join(",")}&count=${wordCount}`);
  }

  function submitNewList(event: FormEvent) {
    event.preventDefault();
    const title = newListTitle.trim();
    if (!title) return;
    const id = api.createList(title);
    setNewListTitle("");
    setCreatingList(false);
    setSelectedListId(id);
  }

  function removeList(list: { id: string; title: string }) {
    // Đếm trên TOÀN BỘ set của danh sách (mọi trạng thái), không chỉ những set
    // đang lọt vào tab hiện tại — danh sách "trông rỗng" ở tab Đã hoàn thành
    // vẫn có thể còn set Chưa hoàn thành bên trong.
    const setCount = api.data.sets.filter((set) => !isStarSet(set) && set.listId === list.id).length;
    if (setCount > 0) {
      alert(`Danh sách "${list.title}" còn ${setCount} học phần. Hãy chuyển hết học phần sang danh sách khác trước khi xoá.`);
      return;
    }
    if (confirm(`Xoá danh sách "${list.title}"?`)) api.deleteList(list.id);
  }

  function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedList) return;
    file.text().then((text) => {
      const cards = parseCardsCsv(text);
      if (!cards.length) {
        alert("CSV không có dòng hợp lệ. File cần có cột word và meaningVi.");
        event.target.value = "";
        return;
      }
      const now = new Date().toISOString();
      // Set import CSV bên trong một danh sách thì tự thuộc luôn danh sách đó.
      api.upsertSet({ id: crypto.randomUUID(), title: file.name.replace(/\.csv$/i, ""), description: "Được import từ CSV.", tags: ["Imported"], cards, createdAt: now, updatedAt: now, listId: selectedList.id });
      event.target.value = "";
    });
  }

  // Đồng bộ nguyên một danh sách sang Life Management theo cây ba tầng: danh
  // sách → bốn node chế độ học → từng set dưới mỗi chế độ, kèm trạng thái hoàn
  // thành của đúng cặp (set, chế độ). Luôn đẩy TOÀN BỘ set của danh sách
  // (không lọc theo tab đang mở) — cây bên kia phản ánh nội dung danh sách,
  // không phản ánh việc mình đang xem tab "chưa hoàn thành" hay "đã hoàn thành".
  async function syncListToLifeManagement() {
    if (!selectedList) return;
    const config = reading.data.lifeManagement;
    if (!config.baseUrl.trim()) {
      alert("Chưa cấu hình địa chỉ Life Management. Vào trang Reading → nút đồng bộ để khai báo.");
      return;
    }
    const setsOfList = api.data.sets.filter((set) => !isStarSet(set) && set.listId === selectedList.id);
    if (!setsOfList.length) {
      alert("Danh sách này chưa có học phần nào để đồng bộ.");
      return;
    }

    setSyncing(true);
    setSyncMessage("");
    try {
      const outcome = await syncSetListToLifeManagement(config, selectedList, setsOfList, api.data.results);
      api.markLifeManagementSynced(selectedList.id, outcome.listTaskId, outcome.setTaskIds);
      setSyncMessage(
        `Đã đồng bộ "${selectedList.title}": tạo mới ${outcome.createdCount} node, dùng lại ${outcome.reusedCount} node có sẵn`
        + `, đánh dấu hoàn thành ${outcome.completedCount} node.`,
      );
    } catch (error) {
      alert(`Chưa đồng bộ được sang Life Management:\n${error instanceof Error ? error.message : error}`);
    } finally {
      setSyncing(false);
    }
  }

  const headerAction = activeTab === "starred" ? undefined
    : selectedList ? (
      <div className="flex flex-wrap gap-sm">
        <Button variant="ghost" onClick={() => { setSelectedListId(null); setSyncMessage(""); }}><Icon name="arrow_back" /> Danh sách</Button>
        <Button variant="secondary" onClick={() => setMultiPickerOpen((value) => !value)}><Icon name="layers" /> Learn Mix Set</Button>
        <Button variant="secondary" disabled={syncing} onClick={syncListToLifeManagement}>
          <Icon name="sync" /> {syncing ? "Đang đồng bộ..." : "Đồng bộ Life Management"}
        </Button>
        <Button onClick={() => navigate(`/sets/new?listId=${selectedList.id}`)}><Icon name="add" /> Create New Set</Button>
      </div>
    ) : (
      <Button onClick={() => setCreatingList(true)}><Icon name="create_new_folder" /> Tạo danh sách mới</Button>
    );

  return (
    <>
      <PageTitle
        title={selectedList ? selectedList.title : "My Sets"}
        subtitle={selectedList ? "Quản lý các học phần trong danh sách này." : "Quản lý các bộ từ vựng đang lưu trên trình duyệt này."}
        action={headerAction}
      />
      <Card className="mb-lg">
        <div className="flex gap-sm border-b border-surface-variant dark:border-white/10">
          <button
            className={`px-md py-sm font-semibold transition ${activeTab === "learning" ? "border-b-2 border-primary text-primary" : "text-on-surface-variant dark:text-white/60"}`}
            onClick={() => switchTab("learning")}
          >
            Chưa hoàn thành
          </button>
          <button
            className={`px-md py-sm font-semibold transition ${activeTab === "completed" ? "border-b-2 border-primary text-primary" : "text-on-surface-variant dark:text-white/60"}`}
            onClick={() => switchTab("completed")}
          >
            Đã hoàn thành
          </button>
          <button
            className={`inline-flex items-center gap-xs px-md py-sm font-semibold transition ${activeTab === "starred" ? "border-b-2 border-primary text-primary" : "text-on-surface-variant dark:text-white/60"}`}
            onClick={() => switchTab("starred")}
          >
            <Icon name="star" filled className={activeTab === "starred" ? "text-amber-500" : ""} /> Từ khó nhớ
          </button>
        </div>
      </Card>

      {activeTab === "starred" ? (
        tabSets.length ? (
          <div className="grid gap-md lg:grid-cols-2 xl:grid-cols-3">
            {tabSets.map((set) => <SetCard key={set.id} set={set} results={api.data.results} onDelete={() => confirm(`Xóa "${set.title}"?`) && api.deleteSet(set.id)} />)}
          </div>
        ) : (
          <EmptyState title="Chưa có từ nào được đánh dấu" text="Bấm nút Star khi học Flashcards để thêm từ vào đây." />
        )
      ) : selectedList ? (
        <>
          {multiPickerOpen ? (
            <Card className="mb-lg space-y-md">
              <div className="flex items-center justify-between">
                <h2 className="font-headline-md text-lg font-bold">Trộn tối đa {MAX_MIX_SETS} bộ để học</h2>
                <Button variant="ghost" onClick={() => setMultiPickerOpen(false)}><Icon name="close" /></Button>
              </div>
              <p className="text-sm text-on-surface-variant dark:text-white/60">
                Chọn tối đa {MAX_MIX_SETS} bộ bất kỳ trong danh sách này (kể cả bộ đã học xong) để gộp lại và học chung. Thứ tự các từ trong phiên học sẽ được xáo trộn hoàn toàn ngẫu nhiên, không theo tuần tự từng bộ.
              </p>
              <div className="text-sm font-semibold text-primary">{selectedSetIds.length}/{MAX_MIX_SETS} bộ đã chọn</div>
              <div className="grid gap-sm md:grid-cols-2 lg:grid-cols-3">
                {listSets.map((set) => {
                  const checked = selectedSetIds.includes(set.id);
                  const disabled = !checked && selectedSetIds.length >= MAX_MIX_SETS;
                  return (
                    <label
                      key={set.id}
                      className={`flex items-center gap-sm rounded-xl border px-md py-sm transition ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${checked ? "border-primary bg-primary-fixed dark:bg-primary/15" : "border-surface-variant dark:border-white/10"}`}
                    >
                      <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleSetSelection(set.id)} />
                      <span className="min-w-0 flex-1 truncate font-semibold">{set.title}</span>
                      <span className="shrink-0 text-sm text-on-surface-variant dark:text-white/60">{set.cards.length} từ</span>
                    </label>
                  );
                })}
              </div>
              <div className="flex flex-col items-start gap-sm sm:flex-row sm:items-center">
                <label className="flex items-center gap-sm font-semibold">
                  Số lượng từ
                  <Input
                    type="number"
                    min={1}
                    max={multiPoolTotal || 1}
                    value={wordCount || ""}
                    onChange={(event) => setWordCount(Math.max(1, Math.min(multiPoolTotal, Number(event.target.value) || 1)))}
                    className="w-28"
                    disabled={!multiPoolTotal}
                  />
                </label>
                <span className="text-sm text-on-surface-variant dark:text-white/60">/ {multiPoolTotal} từ đã chọn</span>
                <Button className="sm:ml-auto" disabled={!selectedSetIds.length || !multiPoolTotal} onClick={startMultiLearn}>
                  <Icon name="play_arrow" /> Bắt đầu học
                </Button>
              </div>
            </Card>
          ) : null}
          {syncMessage ? (
            <div className="mb-lg rounded-xl bg-primary-fixed p-md font-semibold text-primary dark:bg-primary/15 dark:text-white">{syncMessage}</div>
          ) : null}
          <Card className="mb-lg">
            <div className="flex flex-col gap-md md:flex-row">
              <Input placeholder="Tìm theo tên bộ hoặc tag..." value={query} onChange={(event) => setQuery(event.target.value)} />
              <label className="inline-flex cursor-pointer items-center justify-center gap-sm rounded-xl border border-surface-variant bg-white px-lg py-sm font-semibold text-on-surface-variant transition hover:border-primary dark:bg-[#202324] dark:text-white/70">
                <Icon name="upload_file" /> Import CSV
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} />
              </label>
            </div>
          </Card>
          {filtered.length ? (
            <div className="grid gap-md lg:grid-cols-2 xl:grid-cols-3">
              {filtered.map((set) => <SetCard key={set.id} set={set} results={api.data.results} onDelete={() => confirm(`Xóa "${set.title}"?`) && api.deleteSet(set.id)} />)}
            </div>
          ) : (
            <EmptyState title="Chưa có học phần phù hợp trong danh sách này" text="Tạo học phần mới hoặc import CSV để bắt đầu." action={<Button onClick={() => navigate(`/sets/new?listId=${selectedList.id}`)}><Icon name="add" /> Tạo học phần</Button>} />
          )}
        </>
      ) : (
        <>
          {creatingList ? (
            <form onSubmit={submitNewList}>
              <Card className="mb-lg flex flex-col gap-sm sm:flex-row sm:items-center">
                <Input autoFocus placeholder="Tên danh sách, ví dụ: c1_c2" value={newListTitle} onChange={(event) => setNewListTitle(event.target.value)} className="flex-1" />
                <div className="flex gap-sm">
                  <Button type="submit"><Icon name="check" /> Tạo</Button>
                  <Button type="button" variant="ghost" onClick={() => { setCreatingList(false); setNewListTitle(""); }}>Huỷ</Button>
                </div>
              </Card>
            </form>
          ) : null}
          {api.data.lists.length ? (
            <div className="grid gap-md md:grid-cols-2 lg:grid-cols-3">
              {api.data.lists.map((list) => {
                const setsInTab = tabSets.filter((set) => set.listId === list.id);
                const wordsInTab = setsInTab.reduce((sum, set) => sum + set.cards.length, 0);
                return (
                  <Card key={list.id} className="flex flex-col gap-md">
                    <div className="flex items-start justify-between gap-md">
                      <h2 className="min-w-0 truncate font-headline-md text-xl font-semibold">{list.title}</h2>
                      <Button variant="ghost" onClick={() => removeList(list)}><Icon name="delete" /></Button>
                    </div>
                    <div className="text-sm text-on-surface-variant dark:text-white/60">
                      {setsInTab.length} học phần · {wordsInTab} từ
                      {list.lifeManagementTaskId ? " · đã đồng bộ Life Management" : ""}
                    </div>
                    <Button className="w-full" onClick={() => setSelectedListId(list.id)}><Icon name="folder_open" /> Mở danh sách</Button>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState title="Chưa có danh sách nào" text="Tạo danh sách đầu tiên để bắt đầu thêm học phần." action={<Button onClick={() => setCreatingList(true)}><Icon name="create_new_folder" /> Tạo danh sách mới</Button>} />
          )}
        </>
      )}
    </>
  );
}

export function CreateEditSetPage({ api }: PageProps) {
  const { setId } = useParams();
  const existing = getSet(api, setId);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const now = new Date().toISOString();
  // Set mới tạo trong ngữ cảnh một danh sách (bấm "Tạo set" từ bên trong danh
  // sách đó) thì tự nhận listId của danh sách đang mở qua ?listId=; set đã có
  // sẵn thì giữ nguyên listId cũ của nó, không đọc từ URL.
  const requestedListId = searchParams.get("listId");
  const [set, setSet] = useState<VocabularySet>(() => existing ?? {
    id: crypto.randomUUID(),
    title: "",
    description: "",
    tags: [],
    cards: [emptyCard()],
    createdAt: now,
    updatedAt: now,
    listId: requestedListId ?? api.data.lists[0]?.id,
  });
  const [tagText, setTagText] = useState(set.tags.join(", "));
  const [csv, setCsv] = useState("");
  const [csvMessage, setCsvMessage] = useState("");
  const pendingCardFocus = useRef<string | null>(null);

  useEffect(() => {
    const cardId = pendingCardFocus.current;
    if (!cardId) return;

    const frame = window.requestAnimationFrame(() => {
      const wordInput = document.getElementById(`card-word-${cardId}`) as HTMLInputElement | null;
      wordInput?.scrollIntoView({ behavior: "smooth", block: "center" });
      wordInput?.focus({ preventScroll: true });
      pendingCardFocus.current = null;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [set.cards.length]);

  if (setId && !existing) return <Navigate to="/sets" replace />;

  function updateCard(id: string, patch: Partial<VocabularyCard>) {
    setSet((current) => ({ ...current, cards: current.cards.map((card) => (card.id === id ? { ...card, ...patch } : card)) }));
  }

  function addCard() {
    const card = emptyCard();
    pendingCardFocus.current = card.id;
    setSet((current) => ({ ...current, cards: [...current.cards, card] }));
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!set.title.trim()) {
      alert("Vui lòng nhập tên học phần.");
      return;
    }
    const validCards = set.cards.filter((card) => card.word.trim() && (card.meaningVi.trim() || card.definitionEn.trim()));
    if (!validCards.length) {
      alert("Cần ít nhất một từ có English word và Meaning VI hoặc Meaning EN.");
      return;
    }
    const saved = { ...set, title: set.title.trim(), tags: tagText.split(",").map((tag) => tag.trim()).filter(Boolean), cards: validCards, updatedAt: new Date().toISOString() };
    api.upsertSet(saved);
    navigate(`/sets/${saved.id}`);
  }

  function addCsvCards(text: string) {
    const cards = parseCardsCsv(text);
    if (!cards.length) {
      setCsvMessage("Không tìm thấy dòng hợp lệ. CSV cần có cột word và meaningVi.");
      return;
    }
    setSet((current) => ({ ...current, cards: [...current.cards.filter((card) => card.word.trim() || card.meaningVi.trim()), ...cards] }));
    setCsv("");
    setCsvMessage(`Đã thêm ${cards.length} card từ CSV.`);
  }

  function importCardCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then(addCsvCards);
    event.target.value = "";
  }

  return (
    <form onSubmit={save}>
      <PageTitle title={existing ? "Chỉnh sửa học phần" : "Tạo học phần"} subtitle="Nhập từ vựng, ví dụ và metadata. Dữ liệu sẽ sync lên Google Sheet và lưu cache trên trình duyệt." action={<Button type="submit"><Icon name="save" /> Save Set</Button>} />
      <div className="grid gap-lg lg:grid-cols-[0.85fr_1.15fr]">
        <Card className="space-y-md">
          <label className="block"><span className="font-semibold">Title</span><Input value={set.title} onChange={(event) => setSet({ ...set, title: event.target.value })} /></label>
          <label className="block"><span className="font-semibold">Description</span><Textarea rows={4} value={set.description} onChange={(event) => setSet({ ...set, description: event.target.value })} /></label>
          <label className="block"><span className="font-semibold">Tags</span><Input placeholder="TOEIC, Business" value={tagText} onChange={(event) => setTagText(event.target.value)} /></label>
          {isStarSet(set) ? null : (
            <label className="block">
              <span className="font-semibold">Danh sách</span>
              <Select value={set.listId ?? ""} onChange={(event) => setSet({ ...set, listId: event.target.value })}>
                {api.data.lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}
              </Select>
            </label>
          )}
          <label className="block"><span className="font-semibold">Bulk import CSV</span><Textarea rows={7} placeholder="word,ipa,meaningVi,definitionEn,exampleEn,exampleVi,partOfSpeech,level" value={csv} onChange={(event) => { setCsv(event.target.value); setCsvMessage(""); }} /></label>
          <div className="flex flex-wrap gap-sm">
            <Button type="button" variant="secondary" onClick={() => addCsvCards(csv)}><Icon name="playlist_add" /> Add CSV Cards</Button>
            <label className="inline-flex cursor-pointer items-center justify-center gap-sm rounded-xl border border-surface-variant bg-white px-lg py-sm font-semibold text-on-surface-variant transition hover:border-primary dark:bg-[#202324] dark:text-white/70">
              <Icon name="upload_file" /> Choose CSV File
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={importCardCsvFile} />
            </label>
          </div>
          {csvMessage ? <div className="rounded-xl bg-primary-fixed p-md font-semibold text-primary">{csvMessage}</div> : null}
        </Card>
        <div className="space-y-md">
          <div className="flex items-center justify-between gap-sm">
            <h2 className="font-headline-md text-headline-md">Vocabulary Cards</h2>
            <span className="shrink-0 rounded-full bg-primary-fixed px-sm py-xs text-sm font-semibold text-primary">{set.cards.length} cards</span>
          </div>
          {set.cards.map((card, index) => (
            <Card key={card.id} className="space-y-sm">
              <div className="flex items-center justify-between"><strong>Card {index + 1}</strong><Button type="button" variant="ghost" onClick={() => setSet((current) => ({ ...current, cards: current.cards.filter((item) => item.id !== card.id) }))}><Icon name="close" /></Button></div>
              <div className="grid gap-sm md:grid-cols-2">
                <Input id={`card-word-${card.id}`} placeholder="word" value={card.word} onChange={(e) => updateCard(card.id, { word: e.target.value })} />
                <Input placeholder="ipa" value={card.ipa} onChange={(e) => updateCard(card.id, { ipa: e.target.value })} />
                <Input placeholder="meaningVi" value={card.meaningVi} onChange={(e) => updateCard(card.id, { meaningVi: e.target.value })} />
                <Input placeholder="definitionEn" value={card.definitionEn} onChange={(e) => updateCard(card.id, { definitionEn: e.target.value })} />
                <Input placeholder="exampleEn" value={card.exampleEn} onChange={(e) => updateCard(card.id, { exampleEn: e.target.value })} />
                <Input placeholder="exampleVi" value={card.exampleVi} onChange={(e) => updateCard(card.id, { exampleVi: e.target.value })} />
                <Input placeholder="partOfSpeech" value={card.partOfSpeech} onChange={(e) => updateCard(card.id, { partOfSpeech: e.target.value })} />
                <Input placeholder="level" value={card.level} onChange={(e) => updateCard(card.id, { level: e.target.value })} />
              </div>
            </Card>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={addCard}
            className="w-full border-2 border-dashed border-primary/40 bg-primary-fixed/30 py-lg text-primary hover:border-primary dark:bg-primary/15 dark:text-white"
          >
            <Icon name="add_circle" /> Add Card
          </Button>
        </div>
      </div>
    </form>
  );
}

export function SetDetailPage({ api }: PageProps) {
  const { setId } = useParams();
  const set = getSet(api, setId);
  const navigate = useNavigate();
  const { speak } = useSpeech(api.data.settings.voiceURI);
  if (!set) return <Navigate to="/sets" replace />;
  const modes: [VocabularyStudyMode, string, string][] = [["flashcards", "Flashcards", "style"], ["learn", "Learn", "school"], ["write", "Write", "edit_note"], ["match", "Match", "extension"]];
  return (
    <>
      <PageTitle title={set.title} subtitle={set.description} action={<Button variant="secondary" onClick={() => navigate(`/sets/${set.id}/edit`)}><Icon name="edit" /> Edit</Button>} />
      <Card className="mb-lg">
        <div className="mb-sm flex justify-between text-sm text-on-surface-variant dark:text-white/60"><span>{set.cards.length} từ</span><span>{getSetProgress(set, api.data.results)}% mastered</span></div>
        <ProgressBar value={getSetProgress(set, api.data.results)} />
        <div className="mt-md grid grid-cols-2 gap-sm sm:grid-cols-4">
          {modes.map(([mode, label, icon]) => <Button key={mode} variant="secondary" onClick={() => navigate(modePath(set.id, mode))} className="min-h-24 flex-col"><Icon name={icon} /> {label}</Button>)}
        </div>
      </Card>
      <Card>
        <h2 className="mb-md font-headline-md text-headline-md">Danh sách từ vựng</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="text-sm uppercase text-on-surface-variant dark:text-white/60"><tr><th className="py-sm">Word</th><th>IPA</th><th>Meaning</th><th>Type</th><th>Level</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {set.cards.map((card) => (
                <tr key={card.id} className="border-t border-surface-variant dark:border-white/10">
                  <td className="py-sm font-semibold">{card.word}</td><td>{card.ipa}</td><td>{card.meaningVi}</td><td>{card.partOfSpeech}</td><td>{card.level}</td><td>{card.status}</td>
                  <td className="flex gap-xs py-sm"><Button variant="ghost" onClick={() => speak(card.word)}><Icon name="volume_up" /></Button><Button variant="ghost" onClick={() => navigate(`/sets/${set.id}/edit`)}><Icon name="edit" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function StudyHeader({ set, title }: { set: VocabularySet; title: string }) {
  return (
    <div className="mb-lg flex flex-col justify-between gap-sm md:flex-row md:items-center">
      <Link to={`/sets/${set.id}`} className="inline-flex items-center gap-xs font-semibold text-on-surface-variant hover:text-primary dark:text-white/65"><Icon name="arrow_back" /> Back to set</Link>
      <h1 className="font-headline-md text-headline-md">{title}: {set.title}</h1>
    </div>
  );
}

export function FlashcardsPage({ api }: PageProps) {
  const { setId } = useParams();
  const set = getSet(api, setId);
  const [cards] = useState<VocabularyCard[]>(() => set ? shuffle(set.cards) : []);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const { speak } = useSpeech(api.data.settings.voiceURI);
  if (!set) return <Navigate to="/sets" replace />;
  const shuffledCard = cards[index] ?? cards[0];
  if (!shuffledCard) return <EmptyState title="Chưa có từ để học" text="Hãy thêm từ vào học phần trước." />;
  // `cards` chỉ giữ THỨ TỰ xáo trộn, chốt một lần lúc mount — nó không tự cập
  // nhật khi api.updateSet() ghi thay đổi (ví dụ bấm Star) vào set thật. Đọc
  // lại đúng bản ghi hiện tại từ set.cards theo id để nút Star đổi màu ngay,
  // thay vì tô theo bản chụp cũ chưa từng có starred: true.
  const card = set.cards.find((item) => item.id === shuffledCard.id) ?? shuffledCard;
  const mark = (correct: boolean) => {
    api.updateSet(set.id, (current) => updateSetCard(current, card.id, (item) => updateCardStudy(item, correct)));
    setFlipped(false);
    setIndex((value) => Math.min(cards.length - 1, value + 1));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space") { event.preventDefault(); setFlipped((value) => !value); }
      if (event.key === "ArrowRight") setIndex((value) => Math.min(cards.length - 1, value + 1));
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
      if (event.key.toLowerCase() === "k") mark(true);
      if (event.key.toLowerCase() === "d") mark(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <>
      <StudyHeader set={set} title="Flashcards" />
      <div className="mx-auto flex min-h-[calc(100vh-190px)] max-w-3xl flex-col justify-center">
        <div className="mb-md grid grid-cols-[auto_1fr] items-center gap-md"><span className="font-semibold">{index + 1}/{cards.length}</span><ProgressBar value={percent(index + 1, cards.length)} /></div>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setFlipped(!flipped)}
          onKeyDown={(event) => {
            if (event.key === "Enter") setFlipped(!flipped);
          }}
          className="perspective-1000 aspect-[4/3] w-full cursor-pointer text-left outline-none focus:ring-2 focus:ring-primary/30 md:aspect-[16/9]"
        >
          <div className={`card-flip relative h-full ${flipped ? "flipped" : ""}`}>
            <Card className="card-face absolute inset-0 flex flex-col items-center justify-center text-center shadow-level-2">
              <Button variant="ghost" onClick={(event) => { event.stopPropagation(); speak(card.word); }}><Icon name="volume_up" /></Button>
              <div className="px-md text-center font-display-word text-4xl font-bold md:text-display-word">{card.word}</div>
              <div className="mt-sm text-on-surface-variant dark:text-white/60">{card.ipa}</div>
            </Card>
            <Card className="card-face card-back absolute inset-0 flex flex-col justify-center shadow-level-2">
              <h2 className="font-translation-text text-2xl text-primary">{card.meaningVi}</h2>
              <p className="mt-md text-lg">{card.definitionEn}</p>
              <p className="mt-lg italic text-on-surface-variant dark:text-white/65">{card.exampleEn}</p>
              <p className="mt-xs text-on-surface-variant dark:text-white/65">{card.exampleVi}</p>
            </Card>
          </div>
        </div>
        <div className="mt-lg grid grid-cols-2 gap-sm md:grid-cols-5">
          <Button variant="secondary" onClick={() => setIndex(Math.max(0, index - 1))}><Icon name="chevron_left" /> Previous</Button>
          <Button variant="danger" onClick={() => mark(false)}>Don’t Know</Button>
          <Button onClick={() => setFlipped(!flipped)}>Flip</Button>
          <Button onClick={() => mark(true)}>Know</Button>
          {/* Ngôi sao được TÔ VÀNG ĐẶC khi từ đang được đánh dấu. Trạng thái
              đọc thẳng từ card.starred trong dữ liệu, nên mở lại thẻ này lần
              sau vẫn thấy đúng màu — không phải state cục bộ của trang.

              Trong chính bộ star thì không hiện nút này: mọi từ ở đây đã được
              gắn sao rồi, nút chỉ còn tác dụng bỏ sao — mà bỏ sao ngay trong
              bộ được dựng ra TỪ các từ gắn sao là thao tác tự mâu thuẫn, làm
              thẻ biến mất khỏi bộ đang học giữa chừng. */}
          {isStarSet(set) ? null : (
            <Button
              variant="secondary"
              aria-pressed={card.starred}
              aria-label={card.starred ? "Đã đánh dấu từ khó nhớ, bấm để bỏ đánh dấu" : "Đánh dấu từ khó nhớ"}
              className={card.starred ? "border-amber-400 text-amber-600 dark:text-amber-300" : ""}
              onClick={() => { api.updateSet(set.id, (current) => updateSetCard(current, card.id, (item) => ({ ...item, starred: !item.starred }))); }}
            >
              <Icon name="star" filled={card.starred} className={card.starred ? "text-amber-500" : ""} />
              {card.starred ? null : "Star"}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function answerChoices(pool: VocabularyCard[], card: VocabularyCard, field: "meaningVi" | "word") {
  const distractors = shuffle(pool.filter((item) => item.id !== card.id)).slice(0, 3).map((item) => item[field]);
  return shuffle([card[field], ...distractors]);
}

function QuizletProgress({ current, total, correct }: { current: number; total: number; correct?: number }) {
  const segments = Array.from({ length: Math.min(8, Math.max(4, total || 4)) });
  const completed = total ? Math.floor((current / total) * segments.length) : 0;
  return (
    <div className="mx-auto mb-lg flex max-w-6xl items-center gap-xs px-xs md:mb-xl md:gap-sm">
      {correct !== undefined ? <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-base font-bold text-white md:h-11 md:w-11 md:text-xl">{correct}</div> : null}
      <div className="flex flex-1 gap-sm">
        {segments.map((_, index) => (
          <div key={index} className="h-3 flex-1 overflow-hidden rounded-full bg-[#d7dbe6] dark:bg-white/15 md:h-5">
            <div className={`h-full rounded-full ${index < completed ? "bg-emerald-600" : "bg-transparent"}`} />
          </div>
        ))}
      </div>
      <div className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full bg-[#d7dbe6] px-sm text-base font-bold text-[#1f2b4d] dark:bg-white/15 dark:text-white md:h-11 md:min-w-11 md:text-xl">{total}</div>
    </div>
  );
}

function QuizletChoice({
  choice,
  index,
  selected,
  status = "default",
  onClick,
}: {
  choice: string;
  index: number;
  selected: boolean;
  status?: "default" | "correct" | "wrong" | "muted";
  onClick: () => void;
}) {
  const statusStyle = status === "correct"
    ? "learn-choice-correct border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
    : status === "wrong"
      ? "border-red-400 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200"
      : status === "muted"
        ? "border-[#e3e7ef] opacity-45 dark:border-white/10"
        : selected
          ? "border-primary bg-primary-fixed dark:bg-primary/25"
          : "border-[#e3e7ef] dark:border-white/10";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status !== "default"}
      className={`flex min-h-[64px] items-center gap-md rounded-xl border-2 bg-white px-md text-left text-lg text-[#17223f] transition hover:border-primary hover:shadow-level-1 disabled:cursor-default dark:bg-[#202324] dark:text-white md:min-h-[74px] md:px-lg md:text-xl ${statusStyle}`}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base font-bold ${status === "correct" ? "bg-emerald-600 text-white" : status === "wrong" ? "bg-red-500 text-white" : "bg-[#eef1f7] text-[#5f6b88] dark:bg-white/10 dark:text-white/70"}`}>{status === "correct" ? <Icon name="check" className="text-lg" /> : index + 1}</span>
      <span>{choice}</span>
    </button>
  );
}

const DIRECTION_META: Record<LearnDirection, { label: string; description: string; icon: string }> = {
  "eng-eng": { label: "Anh - Anh", description: "Đọc định nghĩa tiếng Anh, chọn từ tiếng Anh đúng.", icon: "menu_book" },
  "viet-eng": { label: "Việt - Anh", description: "Đọc nghĩa tiếng Việt, chọn từ tiếng Anh đúng.", icon: "translate" },
  "eng-viet": { label: "Anh - Việt", description: "Đọc từ tiếng Anh, chọn nghĩa tiếng Việt đúng.", icon: "swap_horiz" },
};

function quizletPrompt(card: VocabularyCard, direction: LearnDirection) {
  if (direction === "eng-eng") {
    return {
      label: "Definition (EN)",
      text: card.definitionEn || card.exampleEn || card.word,
      secondaryText: undefined as string | undefined,
      answerField: "word" as const,
    };
  }
  if (direction === "viet-eng") {
    return {
      label: "Nghĩa (VI)",
      text: card.meaningVi || card.definitionEn || card.word,
      secondaryText: undefined as string | undefined,
      answerField: "word" as const,
    };
  }
  return { label: "Từ (EN)", text: card.word, secondaryText: undefined as string | undefined, answerField: "meaningVi" as const };
}

function DirectionPicker({ completed, onChoose }: { completed: Set<LearnDirection>; onChoose: (direction: LearnDirection) => void }) {
  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-md text-center font-headline-md text-headline-md">Chọn chế độ Learn</h2>
      <p className="mb-lg text-center text-on-surface-variant dark:text-white/65">Hoàn thành cả 3 chế độ để bộ từ được tính là đã học xong.</p>
      <div className="grid gap-md sm:grid-cols-3">
        {LEARN_DIRECTIONS.map((direction) => {
          const meta = DIRECTION_META[direction];
          const done = completed.has(direction);
          return (
            <button
              key={direction}
              type="button"
              onClick={() => onChoose(direction)}
              className={`flex flex-col items-center gap-sm rounded-2xl border-2 bg-white p-lg text-center shadow-level-1 transition hover:border-primary dark:bg-[#232627] ${done ? "border-emerald-500" : "border-surface-variant dark:border-white/10"}`}
            >
              <span className={`flex h-12 w-12 items-center justify-center rounded-full ${done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-primary-fixed text-primary"}`}>
                <Icon name={done ? "check_circle" : meta.icon} />
              </span>
              <strong className="text-lg">{meta.label}</strong>
              <span className="text-sm text-on-surface-variant dark:text-white/60">{meta.description}</span>
              {done ? <span className="text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-300">Đã hoàn thành</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LearnPage({ api }: PageProps) {
  const { setId } = useParams();
  const set = getSet(api, setId);
  const [direction, setDirection] = useState<LearnDirection | null>(null);
  const [queue, setQueue] = useState<VocabularyCard[]>(() => set ? shuffle(set.cards) : []);
  const [current, setCurrent] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrongCardIds, setWrongCardIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ choice: string; correct: boolean; message: string } | null>(null);
  const correctAudio = useRef<AudioContext | null>(null);
  const feedbackTimer = useRef<number | undefined>(undefined);
  const { speak } = useSpeech(api.data.settings.voiceURI);
  const activeChoiceCard = queue[current];
  const choices = useMemo(
    () => set && activeChoiceCard && direction ? answerChoices(set.cards, activeChoiceCard, quizletPrompt(activeChoiceCard, direction).answerField) : [],
    [set?.id, activeChoiceCard?.id, direction],
  );
  const completedDirections = useMemo(() => {
    const done = new Set<LearnDirection>();
    api.data.results.forEach((r) => {
      if (r.mode === "learn" && "setId" in r && r.setId === set?.id && r.direction) done.add(r.direction);
    });
    return done;
  }, [api.data.results, set?.id]);
  useEffect(() => () => {
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    correctAudio.current?.close();
  }, []);
  if (!set) return <Navigate to="/sets" replace />;
  const activeSet = set;
  const card = queue[current];
  function startDirection(nextDirection: LearnDirection) {
    setDirection(nextDirection);
    setQueue(shuffle(activeSet.cards));
    setCurrent(0);
    setCorrect(0);
    setWrongCardIds([]);
    setFeedback(null);
  }
  function retryLearn() {
    setQueue(shuffle(activeSet.cards));
    setCurrent(0);
    setCorrect(0);
    setWrongCardIds([]);
    setFeedback(null);
  }
  function backToPicker() {
    setDirection(null);
  }
  if (!direction) {
    return (
      <>
        <div className="mb-lg"><Link to={`/sets/${activeSet.id}`} className="inline-flex items-center gap-xs font-semibold text-[#586383] hover:text-primary dark:text-white/65"><Icon name="arrow_back" /> {activeSet.title}</Link></div>
        <DirectionPicker completed={completedDirections} onChoose={startDirection} />
      </>
    );
  }
  if (!card) return <Summary set={activeSet} mode="learn" total={queue.length || activeSet.cards.length} correct={correct} wrongCardIds={wrongCardIds} onRetry={retryLearn} onChangeMode={backToPicker} api={api} direction={direction} />;
  const prompt = quizletPrompt(card, direction);
  function choose(value: string) {
    if (feedback) return;
    const ok = value === card[prompt.answerField];
    setFeedback({ choice: value, correct: ok, message: ok ? "Correct!" : `Đáp án: ${card[prompt.answerField]}` });
    if (ok) {
      setCorrect((n) => n + 1);
      playCorrectChime(correctAudio);
    } else {
      setWrongCardIds((items) => items.includes(card.id) ? items : [...items, card.id]);
    }
    api.updateSet(activeSet.id, (currentSet) => updateSetCard(currentSet, card.id, (item) => updateCardStudy(item, ok)));
    feedbackTimer.current = window.setTimeout(() => {
      setFeedback(null);
      setCurrent((n) => n + 1);
      feedbackTimer.current = undefined;
    }, 720);
  }
  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-md flex items-center justify-between md:mb-lg">
        <button type="button" onClick={backToPicker} className="inline-flex items-center gap-xs font-semibold text-[#586383] hover:text-primary dark:text-white/65"><Icon name="arrow_back" /> {DIRECTION_META[direction].label}</button>
        <div className="max-w-[55vw] truncate text-right font-semibold text-[#586383] dark:text-white/65 md:max-w-none">{activeSet.title}</div>
      </div>
      <QuizletProgress current={current} total={queue.length} correct={correct} />
      <section className={`relative mx-auto max-w-6xl rounded-2xl border bg-white px-md py-lg shadow-[0_12px_32px_rgba(15,23,42,0.06)] dark:bg-[#232627] md:min-h-[560px] md:px-2xl md:py-xl ${feedback?.correct ? "learn-answer-correct border-emerald-500" : "border-[#e4e8f0] dark:border-white/10"}`}>
        {feedback?.correct ? <span className="learn-success absolute right-lg top-lg flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-level-2"><Icon name="check" /></span> : null}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-sm font-bold text-[#4b587c] dark:text-white/70">
            <span>{prompt.label}</span>
            <button type="button" onClick={() => speak(prompt.text)} className="rounded-full p-1 hover:bg-surface-container dark:hover:bg-white/10"><Icon name="volume_up" className="text-xl" /></button>
          </div>
          <div className="text-[#7a86a5]">{current + 1} / {queue.length}</div>
        </div>
        <div className="mt-lg min-h-20 leading-relaxed md:mt-xl md:min-h-28">
          <div className="text-xl text-[#0f1b3d] dark:text-white md:text-3xl">{prompt.text}</div>
          {prompt.secondaryText ? <div className="mt-xs text-lg font-semibold text-primary dark:text-[#c3c0ff] md:text-xl">{prompt.secondaryText}</div> : null}
        </div>
        <div className="mt-xl md:mt-2xl">
          <h2 className="mb-md font-bold text-[#4b587c] dark:text-white/70">Choose an answer</h2>
          <div className="grid gap-md md:grid-cols-2">
            {choices.map((choice, index) => {
              const status = !feedback
                ? "default"
                : choice === card[prompt.answerField]
                  ? "correct"
                  : feedback.choice === choice
                    ? "wrong"
                    : "muted";
              return <QuizletChoice key={`${choice}-${index}`} choice={choice} index={index} selected={false} status={status} onClick={() => choose(choice)} />;
            })}
          </div>
        </div>
        <div className="mt-lg flex flex-col-reverse items-stretch gap-md sm:flex-row sm:items-center sm:justify-end sm:gap-lg">
          {feedback ? <div className={`mr-auto rounded-xl px-md py-sm font-semibold ${feedback.correct ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200"}`}>{feedback.message}</div> : null}
          <button type="button" disabled={Boolean(feedback)} onClick={() => choose("__dont_know__")} className="font-bold text-[#4255ff] hover:underline disabled:opacity-50">Don&apos;t know?</button>
        </div>
      </section>
    </div>
  );
}

export function MultiSetLearnPage({ api }: PageProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setIds = useMemo(() => (searchParams.get("sets") ?? "").split(",").filter(Boolean), [searchParams]);
  const requestedCount = Number(searchParams.get("count") ?? "0");
  const [direction, setDirection] = useState<LearnDirection | null>(null);

  const selectedSets = useMemo(
    () => setIds.map((id) => api.data.sets.find((set) => set.id === id)).filter((set): set is VocabularySet => Boolean(set)),
    [setIds, api.data.sets],
  );
  const pool = useMemo(
    () => selectedSets.flatMap((set) => set.cards.map((card) => ({ card, setId: set.id }))),
    [selectedSets],
  );
  const count = Math.max(1, Math.min(requestedCount || pool.length, pool.length || 1));

  const [queue, setQueue] = useState(() => shuffle(pool).slice(0, count));
  const [current, setCurrent] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [feedback, setFeedback] = useState<{ choice: string; correct: boolean; message: string } | null>(null);
  const correctAudio = useRef<AudioContext | null>(null);
  const feedbackTimer = useRef<number | undefined>(undefined);
  const { speak } = useSpeech(api.data.settings.voiceURI);
  const activeItem = queue[current];
  const choices = useMemo(
    () => activeItem && direction ? answerChoices(pool.map((item) => item.card), activeItem.card, quizletPrompt(activeItem.card, direction).answerField) : [],
    [activeItem?.card.id, pool, direction],
  );

  useEffect(() => () => {
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    correctAudio.current?.close();
  }, []);

  if (!selectedSets.length || !pool.length) return <Navigate to="/sets" replace />;

  function startDirection(nextDirection: LearnDirection) {
    setDirection(nextDirection);
    setQueue(shuffle(pool).slice(0, count));
    setCurrent(0);
    setCorrect(0);
    setFeedback(null);
  }

  function retry() {
    setQueue(shuffle(pool).slice(0, count));
    setCurrent(0);
    setCorrect(0);
    setFeedback(null);
  }

  if (!direction) {
    return (
      <>
        <div className="mb-lg"><Link to="/sets" className="inline-flex items-center gap-xs font-semibold text-[#586383] hover:text-primary dark:text-white/65"><Icon name="arrow_back" /> Learn Mix Set</Link></div>
        <DirectionPicker completed={new Set()} onChoose={startDirection} />
      </>
    );
  }

  const item = queue[current];
  if (!item) return <MultiSummary api={api} setIds={setIds} total={queue.length} correct={correct} onRetry={retry} direction={direction} />;
  const card = item.card;
  const prompt = quizletPrompt(card, direction);

  function choose(value: string) {
    if (feedback) return;
    const ok = value === card[prompt.answerField];
    setFeedback({ choice: value, correct: ok, message: ok ? "Correct!" : `Đáp án: ${card[prompt.answerField]}` });
    if (ok) {
      setCorrect((n) => n + 1);
      playCorrectChime(correctAudio);
    }
    api.updateSet(item.setId, (currentSet) => updateSetCard(currentSet, card.id, (cardItem) => updateCardStudy(cardItem, ok)));
    feedbackTimer.current = window.setTimeout(() => {
      setFeedback(null);
      setCurrent((n) => n + 1);
      feedbackTimer.current = undefined;
    }, 720);
  }

  const titleLabel = selectedSets.length > 1
    ? `${selectedSets[0].title} +${selectedSets.length - 1} bộ khác`
    : selectedSets[0].title;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-md flex items-center justify-between md:mb-lg">
        <Link to="/sets" className="inline-flex items-center gap-xs font-semibold text-[#586383] hover:text-primary dark:text-white/65"><Icon name="arrow_back" /> {DIRECTION_META[direction].label}</Link>
        <div className="max-w-[55vw] truncate text-right font-semibold text-[#586383] dark:text-white/65 md:max-w-none">{titleLabel}</div>
      </div>
      <QuizletProgress current={current} total={queue.length} correct={correct} />
      <section className={`relative mx-auto max-w-6xl rounded-2xl border bg-white px-md py-lg shadow-[0_12px_32px_rgba(15,23,42,0.06)] dark:bg-[#232627] md:min-h-[560px] md:px-2xl md:py-xl ${feedback?.correct ? "learn-answer-correct border-emerald-500" : "border-[#e4e8f0] dark:border-white/10"}`}>
        {feedback?.correct ? <span className="learn-success absolute right-lg top-lg flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-level-2"><Icon name="check" /></span> : null}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-sm font-bold text-[#4b587c] dark:text-white/70">
            <span>{prompt.label}</span>
            <button type="button" onClick={() => speak(prompt.text)} className="rounded-full p-1 hover:bg-surface-container dark:hover:bg-white/10"><Icon name="volume_up" className="text-xl" /></button>
          </div>
          <div className="text-[#7a86a5]">{current + 1} / {queue.length}</div>
        </div>
        <div className="mt-lg min-h-20 leading-relaxed md:mt-xl md:min-h-28">
          <div className="text-xl text-[#0f1b3d] dark:text-white md:text-3xl">{prompt.text}</div>
          {prompt.secondaryText ? <div className="mt-xs text-lg font-semibold text-primary dark:text-[#c3c0ff] md:text-xl">{prompt.secondaryText}</div> : null}
        </div>
        <div className="mt-xl md:mt-2xl">
          <h2 className="mb-md font-bold text-[#4b587c] dark:text-white/70">Choose an answer</h2>
          <div className="grid gap-md md:grid-cols-2">
            {choices.map((choice, index) => {
              const status = !feedback
                ? "default"
                : choice === card[prompt.answerField]
                  ? "correct"
                  : feedback.choice === choice
                    ? "wrong"
                    : "muted";
              return <QuizletChoice key={`${choice}-${index}`} choice={choice} index={index} selected={false} status={status} onClick={() => choose(choice)} />;
            })}
          </div>
        </div>
        <div className="mt-lg flex flex-col-reverse items-stretch gap-md sm:flex-row sm:items-center sm:justify-end sm:gap-lg">
          {feedback ? <div className={`mr-auto rounded-xl px-md py-sm font-semibold ${feedback.correct ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200"}`}>{feedback.message}</div> : null}
          <button type="button" disabled={Boolean(feedback)} onClick={() => choose("__dont_know__")} className="font-bold text-[#4255ff] hover:underline disabled:opacity-50">Don&apos;t know?</button>
        </div>
      </section>
    </div>
  );
}

function MultiSummary({ api, setIds, total, correct, onRetry, direction }: PageProps & { setIds: string[]; total: number; correct: number; onRetry: () => void; direction?: LearnDirection }) {
  const navigate = useNavigate();
  useEffect(() => {
    api.setData((current) => ({ ...current, results: [createResult(setIds.join(","), "learn", total, correct, [], direction), ...current.results] }));
  }, []);
  return (
    <Card className="mx-auto max-w-xl text-center">
      <Icon name="verified" className="text-5xl text-primary" />
      <h1 className="mt-md font-headline-lg text-headline-lg">Hoàn thành</h1>
      <p className="mt-sm text-on-surface-variant dark:text-white/65">Đúng {correct}/{total} câu. Accuracy {percent(correct, total)}%.</p>
      <div className="mt-lg flex justify-center gap-sm"><Button onClick={onRetry}>Làm lại</Button><Button variant="secondary" onClick={() => navigate("/sets")}>Về My Sets</Button></div>
    </Card>
  );
}

function Summary({ api, set, mode, total, correct, wrongCardIds = [], onRetry, onChangeMode, direction }: PageProps & { set: VocabularySet; mode: VocabularyStudyMode; total: number; correct: number; wrongCardIds?: string[]; onRetry?: () => void; onChangeMode?: () => void; direction?: LearnDirection }) {
  const navigate = useNavigate();
  useEffect(() => {
    api.setData((current) => ({ ...current, results: [createResult(set.id, mode, total, correct, wrongCardIds, direction), ...current.results] }));
  }, []);
  return (
    <Card className="mx-auto max-w-xl text-center">
      <Icon name="verified" className="text-5xl text-primary" />
      <h1 className="mt-md font-headline-lg text-headline-lg">Hoàn thành</h1>
      <p className="mt-sm text-on-surface-variant dark:text-white/65">Đúng {correct}/{total} câu. Accuracy {percent(correct, total)}%.</p>
      {direction ? <p className="mt-xs text-sm font-semibold text-primary">Chế độ: {DIRECTION_META[direction].label}</p> : null}
      <div className="mt-lg flex flex-wrap justify-center gap-sm">
        <Button onClick={() => onRetry ? onRetry() : navigate(modePath(set.id, mode))}>Làm lại</Button>
        {onChangeMode ? <Button variant="secondary" onClick={onChangeMode}>Đổi chế độ</Button> : null}
        <Button variant="secondary" onClick={() => navigate(`/sets/${set.id}`)}>Về học phần</Button>
      </div>
    </Card>
  );
}

export function WritePage({ api }: PageProps) {
  const { setId } = useParams();
  const set = getSet(api, setId);
  const [queue, setQueue] = useState<VocabularyCard[]>(() => set ? shuffle(set.cards) : []);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; correct: boolean } | null>(null);
  const [answered, setAnswered] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [wrongCardIds, setWrongCardIds] = useState<string[]>([]);
  const [usedHint, setUsedHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  if (!set) return <Navigate to="/sets" replace />;
  const activeSet = set;
  if (!activeSet.cards.length) return <EmptyState title="Chưa có từ" text="Hãy thêm từ vào bộ này." />;
  const card = queue[index];

  function restart() {
    setQueue(shuffle(activeSet.cards));
    setIndex(0);
    setAnswer("");
    setFeedback(null);
    setAnswered(false);
    setCorrect(0);
    setWrongCardIds([]);
    setUsedHint(false);
  }

  if (!card) return <Summary set={activeSet} mode="write" total={queue.length} correct={correct} wrongCardIds={wrongCardIds} onRetry={restart} api={api} />;

  function check() {
    if (answered) return;
    const distance = levenshtein(answer, card.word);
    const ok = distance === 0 && !usedHint;
    setAnswered(true);
    setFeedback(ok ? { text: "Correct!", correct: true } : { text: `Đáp án: ${card.word}`, correct: false });
    if (ok) setCorrect((n) => n + 1);
    else setWrongCardIds((items) => (items.includes(card.id) ? items : [...items, card.id]));
    api.updateSet(activeSet.id, (current) => updateSetCard(current, card.id, (item) => updateCardStudy(item, ok)));
  }

  function next() {
    setIndex((n) => n + 1);
    setAnswer("");
    setFeedback(null);
    setAnswered(false);
    setUsedHint(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleEnter() {
    if (!answered) check();
    else next();
  }

  return (
    <>
      <StudyHeader set={activeSet} title="Write" />
      <div className="mx-auto max-w-2xl">
        <div className="mb-md flex items-center justify-between text-sm font-semibold text-on-surface-variant dark:text-white/60">
          <span>{index + 1}/{queue.length}</span>
          <span>{correct} đúng</span>
        </div>
        <ProgressBar value={percent(index, queue.length)} />
        <Card className="mt-md space-y-md">
          <div className="space-y-xs">
            {card.definitionEn ? <p className="text-on-surface-variant dark:text-white/70">{card.definitionEn}</p> : null}
            <h2 className="font-translation-text text-2xl text-primary">{card.meaningVi || card.definitionEn || card.exampleEn || card.word}</h2>
          </div>
          <Input
            ref={inputRef}
            autoFocus
            value={answer}
            disabled={answered}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Gõ từ tiếng Anh..."
            onKeyDown={(e) => e.key === "Enter" && handleEnter()}
          />
          <div className="flex flex-wrap gap-sm">
            {!answered ? (
              <>
                <Button onClick={check}>Check Answer</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setUsedHint(true);
                    setAnswer(card.word.slice(0, Math.ceil(card.word.length / 2)));
                  }}
                >
                  Hint
                </Button>
              </>
            ) : (
              <Button onClick={next}>{index === queue.length - 1 ? "Xem kết quả" : "Next"} <Icon name="arrow_forward" /></Button>
            )}
          </div>
          {feedback ? (
            <div className={`rounded-xl p-md font-semibold ${feedback.correct ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200"}`}>
              {feedback.text}
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}


const MATCH_BATCH_SIZE = 10;

function matchDisplayText(card: VocabularyCard) {
  return card.meaningVi || card.definitionEn || card.exampleEn || card.word;
}

export function MatchPage({ api }: PageProps) {
  const { setId } = useParams();
  const set = getSet(api, setId);
  const [order, setOrder] = useState<VocabularyCard[]>(() => set ? shuffle(set.cards) : []);
  const batches = useMemo(() => {
    const chunks: VocabularyCard[][] = [];
    for (let i = 0; i < order.length; i += MATCH_BATCH_SIZE) chunks.push(order.slice(i, i + MATCH_BATCH_SIZE));
    return chunks.length ? chunks : [[]];
  }, [order]);
  const [batchIndex, setBatchIndex] = useState(0);
  const cards = batches[batchIndex] ?? [];
  const [right, setRight] = useState<VocabularyCard[]>(() => shuffle(cards));
  const [leftPick, setLeftPick] = useState("");
  const [matched, setMatched] = useState<string[]>([]);
  const [wrong, setWrong] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const mistakesRef = useRef(0);
  const mistakeCardIdsRef = useRef<string[]>([]);
  const resultSavedRef = useRef(false);
  if (!set) return <Navigate to="/sets" replace />;
  const activeSet = set;
  if (!activeSet.cards.length) return <EmptyState title="Chưa có từ" text="Hãy thêm từ vào bộ này." />;
  useEffect(() => {
    setRight(shuffle(cards));
    setMatched([]);
    setLeftPick("");
    setSeconds(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchIndex, order]);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [batchIndex]);
  useEffect(() => {
    if (cards.length && matched.length === cards.length) api.recordMatchTime(activeSet.id, seconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched.length]);
  function pickMeaning(card: VocabularyCard) {
    if (!leftPick) return;
    if (leftPick === card.id) {
      setMatched((items) => [...items, card.id]);
      api.updateSet(activeSet.id, (current) => updateSetCard(current, card.id, (item) => updateCardStudy(item, true)));
      setLeftPick("");
    } else {
      mistakesRef.current += 1;
      if (!mistakeCardIdsRef.current.includes(leftPick)) mistakeCardIdsRef.current = [...mistakeCardIdsRef.current, leftPick];
      setWrong(true);
      setTimeout(() => setWrong(false), 260);
    }
  }
  const complete = cards.length > 0 && matched.length === cards.length;
  const isLastBatch = batchIndex === batches.length - 1;
  const totalWords = order.length;
  const wordsDone = Math.min(batchIndex * MATCH_BATCH_SIZE + matched.length, totalWords);
  useEffect(() => {
    if (!isLastBatch || !complete || resultSavedRef.current) return;
    resultSavedRef.current = true;
    const attempts = totalWords + mistakesRef.current;
    api.setData((current) => ({ ...current, results: [createResult(activeSet.id, "match", attempts, totalWords, mistakeCardIdsRef.current), ...current.results] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLastBatch, complete]);
  function restartAll() {
    setOrder(shuffle(activeSet.cards));
    setBatchIndex(0);
    mistakesRef.current = 0;
    mistakeCardIdsRef.current = [];
    resultSavedRef.current = false;
  }
  return (
    <>
      <StudyHeader set={activeSet} title="Match Game" />
      <Card className={`mx-auto max-w-5xl ${wrong ? "shake" : ""}`}>
        <div className="mb-sm grid grid-cols-3 gap-sm text-center text-sm font-semibold md:text-base"><span>Time: {seconds}s</span><span>Score: {matched.length}/{cards.length}</span><span>Best: {api.data.matchBestTimes[activeSet.id] ? `${api.data.matchBestTimes[activeSet.id]}s` : "-"}</span></div>
        <div className="mb-md text-center text-sm font-semibold text-on-surface-variant dark:text-white/60">Khung {batchIndex + 1}/{batches.length} · Đã học {wordsDone}/{totalWords} từ</div>
        <p className="mb-md text-center text-xs text-on-surface-variant dark:text-white/50">Chọn một từ tiếng Anh, sau đó chọn nghĩa tương ứng.</p>
        <div className="grid gap-md md:grid-cols-2">
          <div className="grid gap-sm">{cards.map((card) => <Button key={card.id} disabled={matched.includes(card.id)} variant={leftPick === card.id ? "primary" : "secondary"} onClick={() => setLeftPick(card.id)} className="min-h-14 whitespace-normal break-words text-center">{card.word}</Button>)}</div>
          <div className="grid gap-sm">{right.map((card) => <Button key={card.id} disabled={matched.includes(card.id)} variant="secondary" onClick={() => pickMeaning(card)} className="min-h-14 whitespace-normal break-words text-center">{matchDisplayText(card)}</Button>)}</div>
        </div>
        {complete ? (
          <div className="mt-lg rounded-2xl bg-primary-fixed p-lg text-center text-primary">
            <h2 className="font-headline-md text-headline-md">{isLastBatch ? `Hoàn thành cả ${totalWords} từ!` : `Hoàn thành khung ${batchIndex + 1}/${batches.length} trong ${seconds}s`}</h2>
            {isLastBatch ? (
              <Button className="mt-md" onClick={restartAll}>Học lại từ đầu</Button>
            ) : (
              <Button className="mt-md" onClick={() => setBatchIndex((n) => n + 1)}><Icon name="arrow_forward" /> Khung tiếp theo</Button>
            )}
          </div>
        ) : null}
      </Card>
    </>
  );
}

export function ProgressPage({ api }: PageProps) {
  const cards = api.data.sets.flatMap((set) => set.cards);
  const avg = api.data.results.length ? Math.round(api.data.results.reduce((sum, item) => sum + item.accuracy, 0) / api.data.results.length) : 0;
  const listeningResults = api.data.results.filter((result) => result.mode === "listening");
  const readingResults = api.data.results.filter((result) => result.mode !== "listening");
  const listeningAvg = listeningResults.length ? Math.round(listeningResults.reduce((sum, item) => sum + item.accuracy, 0) / listeningResults.length) : 0;
  const readingAvg = readingResults.length ? Math.round(readingResults.reduce((sum, item) => sum + item.accuracy, 0) / readingResults.length) : 0;
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);
  const [historyCategory, setHistoryCategory] = useState<"reading" | "listening">("reading");
  const visibleResults = historyCategory === "listening" ? listeningResults : readingResults;

  const statusCounts = useMemo(() => getMasteryStatusCounts(api.data.sets, api.data.results), [api.data.sets, api.data.results]);
  const masteredWords = statusCounts.mastered;

  const today = useMemo(() => new Date(), []);
  const dailyLearnedWords = useMemo(() => getLearnedWordsByDay(api.data.sets, api.data.results, today), [api.data.sets, api.data.results, today]);
  const weeklyLearnedWords = useMemo(() => getLearnedWordsByWeek(dailyLearnedWords), [dailyLearnedWords]);
  const todayLearnedWords = dailyLearnedWords.find((d) => d.day === today.getDate())?.value ?? 0;
  const monthLearnedWords = dailyLearnedWords.reduce((sum, d) => sum + d.value, 0);
  const monthLabel = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(today);

  const trendPoints = useMemo(
    () => [...api.data.results]
      .slice(0, 14)
      .reverse()
      .map((result) => ({
        label: new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(new Date(result.studiedAt)),
        value: result.accuracy,
      })),
    [api.data.results],
  );

  const setProgressBars = useMemo(
    () => [...api.data.sets]
      .map((set) => ({ label: set.title, value: getSetProgress(set, api.data.results), suffix: "%" }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6),
    [api.data.sets, api.data.results],
  );

  const modeLabels: Record<string, string> = { learn: "Learn", write: "Write", match: "Match", flashcards: "Flashcards", listening: "Listening" };
  const activityBars = useMemo(() => {
    const counts: Record<string, number> = {};
    api.data.results.forEach((result) => { counts[result.mode] = (counts[result.mode] ?? 0) + 1; });
    return Object.entries(counts)
      .map(([mode, value]) => ({ label: modeLabels[mode] ?? mode, value, suffix: " lần" }))
      .sort((a, b) => b.value - a.value);
  }, [api.data.results]);

  return (
    <>
      <PageTitle title="Tiến độ học tập" subtitle="Theo dõi số từ đã thuộc, từ khó và lịch sử luyện tập." action={<Link to="/sets"><Button><Icon name="event_repeat" /> Review Difficult Words</Button></Link>} />
      <div className="grid grid-cols-2 gap-md lg:grid-cols-5"><Stat label="Tổng số từ" value={cards.length} icon="dictionary" /><Stat label="Mastered" value={masteredWords} icon="verified" /><Stat label="Difficult" value={cards.filter((c) => c.status === "difficult").length} icon="warning" /><Stat label="Review Today" value={cards.filter((c) => c.nextReviewAt && new Date(c.nextReviewAt) <= new Date()).length} icon="today" /><Stat label="Accuracy" value={`${avg}%`} icon="target" /></div>
      <p className="mt-sm text-xs text-on-surface-variant dark:text-white/50">Mastered chỉ tính từ của các bộ đã Learn 100% cả 3 chế độ và Write 100%.</p>

      <div className="mt-lg grid gap-md md:grid-cols-2">
        <Card className="flex items-center gap-md border-l-4 border-l-primary">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary-fixed text-primary"><Icon name="menu_book" className="text-3xl" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold uppercase tracking-wide text-on-surface-variant dark:text-white/60">Reading</div>
            <div className="mt-xs flex items-end justify-between gap-md"><strong className="text-3xl">{readingAvg}%</strong><span className="text-sm text-on-surface-variant dark:text-white/60">{readingResults.length} lần học</span></div>
          </div>
        </Card>
        <Card className="flex items-center gap-md border-l-4 border-l-emerald-500">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"><Icon name="headphones" className="text-3xl" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold uppercase tracking-wide text-on-surface-variant dark:text-white/60">Listening</div>
            <div className="mt-xs flex items-end justify-between gap-md"><strong className="text-3xl">{listeningAvg}%</strong><span className="text-sm text-on-surface-variant dark:text-white/60">{listeningResults.length} bài test</span></div>
          </div>
        </Card>
      </div>

      <div className="mt-lg grid gap-md lg:grid-cols-2">
        <Card>
          <h2 className="font-headline-md text-headline-md">Trạng thái từ vựng</h2>
          <p className="mt-xs text-sm text-on-surface-variant dark:text-white/60">Phân bố {cards.length} từ theo mức độ ghi nhớ.</p>
          <div className="mt-lg"><StatusDonutChart counts={statusCounts} /></div>
        </Card>
        <Card>
          <h2 className="font-headline-md text-headline-md">Xu hướng độ chính xác</h2>
          <p className="mt-xs text-sm text-on-surface-variant dark:text-white/60">{trendPoints.length} lần học gần nhất (Reading &amp; Listening).</p>
          <div className="mt-lg"><TrendLineChart points={trendPoints} /></div>
        </Card>
      </div>

      <Card className="mt-lg">
        <div className="flex flex-wrap items-end justify-between gap-md">
          <div>
            <h2 className="font-headline-md text-headline-md">Hoạt động học từ · {monthLabel}</h2>
            <p className="mt-xs text-sm text-on-surface-variant dark:text-white/60">Đếm số từ trong các bộ đã Learn/Write trọn vẹn (không lặp lại cùng bộ trong ngày). Tự reset khi sang tháng mới.</p>
          </div>
          <div className="flex gap-lg">
            <div className="text-right">
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-300">{todayLearnedWords}</div>
              <div className="text-xs font-semibold uppercase text-on-surface-variant dark:text-white/50">Hôm nay</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">{monthLearnedWords}</div>
              <div className="text-xs font-semibold uppercase text-on-surface-variant dark:text-white/50">Cả tháng</div>
            </div>
          </div>
        </div>
        <div className="mt-lg grid gap-lg lg:grid-cols-[2fr_1fr]">
          <div>
            <h3 className="mb-sm text-sm font-bold text-on-surface-variant dark:text-white/65">Theo ngày</h3>
            <ColumnChart data={dailyLearnedWords.map((d) => ({ label: String(d.day), value: d.value }))} highlightLabel={String(today.getDate())} />
          </div>
          <div>
            <h3 className="mb-sm text-sm font-bold text-on-surface-variant dark:text-white/65">Theo tuần</h3>
            <HorizontalBarChart data={weeklyLearnedWords} colorClass="bg-emerald-500" />
          </div>
        </div>
      </Card>

      <div className="mt-lg grid gap-md lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between gap-md">
            <h2 className="font-headline-md text-headline-md">Tiến độ theo học phần</h2>
            <Link to="/sets" className="shrink-0 text-sm font-semibold text-primary">Xem tất cả</Link>
          </div>
          <p className="mt-xs text-sm text-on-surface-variant dark:text-white/60">Top {setProgressBars.length} học phần theo % đã thuộc.</p>
          <div className="mt-lg"><HorizontalBarChart data={setProgressBars} /></div>
        </Card>
        <Card>
          <h2 className="font-headline-md text-headline-md">Hoạt động theo chế độ học</h2>
          <p className="mt-xs text-sm text-on-surface-variant dark:text-white/60">Số lần luyện tập theo từng chế độ.</p>
          <div className="mt-lg"><HorizontalBarChart data={activityBars} colorClass="bg-emerald-500" /></div>
        </Card>
      </div>

      <Card className="mt-lg">
        <div className="flex flex-wrap items-center justify-between gap-md">
          <div>
            <h2 className="font-headline-md text-headline-md">Study history</h2>
            <p className="mt-xs text-sm text-on-surface-variant dark:text-white/60">Reading và Listening được lưu, theo dõi riêng.</p>
          </div>
          <div className="grid grid-cols-2 rounded-xl bg-surface-container-low p-xs dark:bg-white/5">
            <button type="button" onClick={() => { setHistoryCategory("reading"); setExpandedResultId(null); }} className={`rounded-lg px-md py-sm text-sm font-bold transition ${historyCategory === "reading" ? "bg-primary text-white shadow-level-1" : "text-on-surface-variant dark:text-white/60"}`}>Reading <span className="ml-xs opacity-75">{readingResults.length}</span></button>
            <button type="button" onClick={() => { setHistoryCategory("listening"); setExpandedResultId(null); }} className={`rounded-lg px-md py-sm text-sm font-bold transition ${historyCategory === "listening" ? "bg-primary text-white shadow-level-1" : "text-on-surface-variant dark:text-white/60"}`}>Listening <span className="ml-xs opacity-75">{listeningResults.length}</span></button>
          </div>
        </div>
        <div className="mt-md space-y-sm">
          {visibleResults.length ? visibleResults.slice(0, 20).map((result) => {
            if (result.mode === "listening") {
              return (
                <div key={result.id} className="flex items-center gap-md rounded-xl bg-surface-container-low p-md dark:bg-white/5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-primary dark:bg-primary/25 dark:text-white"><Icon name="headphones" /></span>
                  <span className="min-w-0 flex-1">
                    <strong className="block">Listening Test · {formatDate(result.studiedAt)}</strong>
                    <span className="mt-xs block text-sm text-on-surface-variant dark:text-white/60">Chỉ lưu phần trăm đúng</span>
                  </span>
                  <strong className="text-lg">{result.accuracy}%</strong>
                </div>
              );
            }
            const expanded = expandedResultId === result.id;
            const resultSet = api.data.sets.find((set) => set.id === result.setId);
            const hasWrongDetails = Array.isArray(result.wrongCardIds);
            const wrongCards = (result.wrongCardIds ?? [])
              .map((cardId) => resultSet?.cards.find((card) => card.id === cardId))
              .filter((card): card is VocabularyCard => Boolean(card));
            return (
              <div key={result.id} className="overflow-hidden rounded-xl bg-surface-container-low dark:bg-white/5">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedResultId(expanded ? null : result.id)}
                  className="flex w-full items-center gap-md p-md text-left transition hover:bg-surface-container dark:hover:bg-white/5"
                >
                  <span className="min-w-0 flex-1">
                    <strong className="block capitalize">{result.mode} · {formatDate(result.studiedAt)}</strong>
                    <span className="mt-xs block text-sm text-on-surface-variant dark:text-white/60">{result.correctAnswers}/{result.totalQuestions} câu đúng</span>
                  </span>
                  <strong className="text-lg">{result.accuracy}%</strong>
                  <Icon name="expand_more" className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
                {expanded ? (
                  <div className="border-t border-surface-variant bg-white p-md dark:border-white/10 dark:bg-[#232627]">
                    {!hasWrongDetails ? (
                      <p className="text-sm text-on-surface-variant dark:text-white/60">Lần học cũ này chưa lưu chi tiết từng từ sai.</p>
                    ) : result.wrongCardIds?.length === 0 ? (
                      <div className="flex items-center gap-sm font-semibold text-emerald-700 dark:text-emerald-300"><Icon name="check_circle" /> Không có từ trả lời sai.</div>
                    ) : wrongCards.length ? (
                      <div className="space-y-sm">
                        <div className="text-sm font-bold text-on-surface-variant dark:text-white/60">Từ trả lời sai ({result.wrongCardIds?.length})</div>
                        {wrongCards.map((card) => (
                          <div key={card.id} className="flex items-start justify-between gap-md rounded-xl bg-error-container px-md py-sm text-red-900">
                            <span><strong>{card.word}</strong><span className="mx-xs">·</span>{card.meaningVi}</span>
                            <span className="shrink-0 text-sm">{card.partOfSpeech}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-on-surface-variant dark:text-white/60">Không còn tìm thấy các từ sai của học phần này.</p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          }) : <p className="rounded-xl bg-surface-container-low p-md text-on-surface-variant dark:bg-white/5 dark:text-white/60">Chưa có lịch sử {historyCategory === "listening" ? "Listening Test" : "Reading"}.</p>}
        </div>
      </Card>
    </>
  );
}

export function SettingsPage({ api }: PageProps) {
  const { voices } = useSpeech(api.data.settings.voiceURI);
  const storageInfo = getStorageDiagnostics();
  const [recoverMessage, setRecoverMessage] = useState("");

  function recoverFromOrigin(origin: string) {
    setRecoverMessage(`Đang kiểm tra ${origin}...`);
    const iframe = document.createElement("iframe");
    iframe.src = `${origin}/storage-bridge.html`;
    iframe.style.display = "none";

    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      iframe.remove();
      setRecoverMessage(`Không đọc được dữ liệu từ ${origin}. Hãy chắc chắn server ở origin đó đang chạy.`);
    }, 4000);

    function onMessage(event: MessageEvent) {
      if (event.origin !== origin || event.data?.type !== "local-english-storage-bridge") return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      iframe.remove();

      const raw = event.data.values?.[STORAGE_KEY] ?? event.data.values?.[STORAGE_BACKUP_KEY];
      if (!raw) {
        setRecoverMessage(`${origin} không có dữ liệu Local English.`);
        return;
      }

      try {
        const parsed = JSON.parse(raw) as AppData;
        if (!Array.isArray(parsed.sets)) throw new Error("Invalid backup");
        const totalCards = parsed.sets.reduce((sum, set) => sum + (set.cards?.length ?? 0), 0);
        if (confirm(`Tìm thấy ${parsed.sets.length} học phần / ${totalCards} cards ở ${origin}. Khôi phục dữ liệu này? Dữ liệu hiện tại sẽ được thay thế.`)) {
          api.replaceData({ sets: parsed.sets, results: parsed.results ?? [], matchBestTimes: parsed.matchBestTimes ?? {}, lists: parsed.lists ?? [], settings: parsed.settings ?? api.data.settings });
          setRecoverMessage(`Đã khôi phục dữ liệu từ ${origin}.`);
        } else {
          setRecoverMessage("Đã hủy khôi phục.");
        }
      } catch {
        setRecoverMessage(`Dữ liệu từ ${origin} không hợp lệ.`);
      }
    }

    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);
  }

  function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as AppData;
        if (!Array.isArray(parsed.sets)) throw new Error("Invalid backup");
        api.replaceData({ sets: parsed.sets, results: parsed.results ?? [], matchBestTimes: parsed.matchBestTimes ?? {}, lists: parsed.lists ?? [], settings: parsed.settings ?? api.data.settings });
      } catch {
        alert("File JSON không hợp lệ.");
      }
    });
  }
  return (
    <>
      <PageTitle title="Settings" subtitle="Dữ liệu chỉ nằm trên trình duyệt hiện tại. Hãy export JSON nếu muốn sao lưu." />
      <div className="grid gap-lg lg:grid-cols-2">
        <Card className="space-y-md">
          <h2 className="font-headline-md text-headline-md">Appearance & Speech</h2>
          <label className="block"><span className="font-semibold">Theme</span><Select value={api.data.settings.theme} onChange={(e) => api.setTheme(e.target.value as "light" | "dark")}><option value="light">Light</option><option value="dark">Dark</option></Select></label>
          <label className="block"><span className="font-semibold">Voice</span><Select value={api.data.settings.voiceURI} onChange={(e) => api.setVoice(e.target.value)}><option value="">Auto English voice</option>{voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}</Select></label>
        </Card>
        <Card className="space-y-md">
          <h2 className="font-headline-md text-headline-md">Data</h2>
          <div className="rounded-xl bg-surface-container-low p-md text-sm text-on-surface-variant dark:bg-white/5 dark:text-white/70">
            <div>Origin: <strong>{storageInfo.origin}</strong></div>
            <div>Storage: primary {storageInfo.hasPrimary ? "OK" : "empty"} ({Math.round(storageInfo.primaryBytes / 1024)} KB), backup {storageInfo.hasBackup ? "OK" : "empty"} ({Math.round(storageInfo.backupBytes / 1024)} KB)</div>
          </div>
          <div className="rounded-xl border border-surface-variant p-md dark:border-white/10">
            <div className="font-semibold">Recover data from another dev origin</div>
            <p className="mt-xs text-sm text-on-surface-variant dark:text-white/65">Dùng khi bạn lỡ import ở port/host khác như 5174 hoặc localhost.</p>
            <div className="mt-md flex flex-wrap gap-sm">
              <Button variant="secondary" onClick={() => recoverFromOrigin("http://127.0.0.1:5174")}>Recover 127.0.0.1:5174</Button>
              <Button variant="secondary" onClick={() => recoverFromOrigin("http://localhost:5173")}>Recover localhost:5173</Button>
              <Button variant="secondary" onClick={() => recoverFromOrigin("http://localhost:5174")}>Recover localhost:5174</Button>
            </div>
            {recoverMessage ? <div className="mt-md rounded-xl bg-primary-fixed p-md text-sm font-semibold text-primary">{recoverMessage}</div> : null}
          </div>
          <div className="flex flex-wrap gap-sm"><Button onClick={() => downloadJson("local-english-flashcards-backup.json", api.data)}><Icon name="download" /> Export JSON</Button><label className="inline-flex cursor-pointer items-center justify-center gap-sm rounded-xl border border-surface-variant px-lg py-sm font-semibold"><Icon name="upload" /> Import Backup<input className="hidden" type="file" accept="application/json,.json" onChange={importJson} /></label></div>
          <div className="flex flex-wrap gap-sm"><Button variant="secondary" onClick={() => confirm("Reset toàn bộ progress?") && api.resetProgress()}><Icon name="restart_alt" /> Reset progress</Button><Button variant="danger" onClick={() => confirm("Clear all data? Hành động này không thể hoàn tác.") && api.clearAll()}><Icon name="delete_forever" /> Clear all data</Button></div>
        </Card>
      </div>
    </>
  );
}
