import { ChangeEvent, FormEvent, TouchEvent as ReactTouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { DataApi } from "../App";
import { Button, Card, EmptyState, Icon, Input, PageTitle, ProgressBar, Select, Textarea } from "../components/ui";
import { useSpeech } from "../hooks/useSpeech";
import { AppData, StudyMode, VocabularyCard, VocabularySet } from "../types";
import { downloadJson, parseCardsCsv } from "../utils/csv";
import { getStorageDiagnostics, STORAGE_BACKUP_KEY, STORAGE_KEY } from "../utils/storage";
import { createResult, formatDate, getSetProgress, levenshtein, percent, preferredCards, shuffle, updateCardStudy, updateSetCard } from "../utils/study";

type PageProps = { api: DataApi };

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

function modePath(setId: string, mode: StudyMode) {
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

function SetCard({ set, onDelete }: { set: VocabularySet; onDelete: () => void }) {
  const progress = getSetProgress(set);
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
  const [view, setView] = useState<"add" | "sets" | "study" | "learn">("add");
  const [libraryMode, setLibraryMode] = useState<"flashcard" | "learn">("flashcard");
  const [form, setForm] = useState({
    word: "",
    meaningVi: "",
  });
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedSetId, setSelectedSetId] = useState("");
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [learnCards, setLearnCards] = useState<VocabularyCard[]>([]);
  const [learnIndex, setLearnIndex] = useState(0);
  const [learnCorrect, setLearnCorrect] = useState(0);
  const [learnWrongCardIds, setLearnWrongCardIds] = useState<string[]>([]);
  const [learnFeedback, setLearnFeedback] = useState<{ choice: string; correct: boolean } | null>(null);
  const touchStartX = useRef<number | null>(null);
  const swiped = useRef(false);
  const learnTimer = useRef<number | undefined>(undefined);
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
  const activeCard = selectedSet?.cards[cardIndex];
  const activeLearnCard = learnCards[learnIndex];
  const learnPrompt = activeLearnCard?.definitionEn || activeLearnCard?.meaningVi || activeLearnCard?.exampleEn || "";
  const learnChoices = useMemo(() => {
    if (!selectedSet || !activeLearnCard) return [];
    const distractors = shuffle(selectedSet.cards)
      .filter((card) => card.id !== activeLearnCard.id && card.word.trim() && card.word !== activeLearnCard.word)
      .map((card) => card.word)
      .filter((word, index, words) => words.indexOf(word) === index)
      .slice(0, 3);
    return shuffle([activeLearnCard.word, ...distractors]);
  }, [activeLearnCard?.id, selectedSetId]);

  useEffect(() => {
    if (!selectedSet?.cards.length) return;
    setCardIndex((current) => Math.min(current, selectedSet.cards.length - 1));
  }, [selectedSet?.cards.length]);

  useEffect(() => () => {
    if (learnTimer.current) window.clearTimeout(learnTimer.current);
    correctAudio.current?.close();
  }, []);

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function addWord(event: FormEvent) {
    event.preventDefault();
    const word = form.word.trim();
    const meaningVi = form.meaningVi.trim();
    if (!word || !meaningVi) {
      setMessage("Cần nhập từ tiếng Anh và nghĩa tiếng Việt.");
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
      meaningVi,
      definitionEn: "",
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
    setForm({ word: "", meaningVi: "" });
    const successLog = `${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} - Đã thêm "${word}" = "${meaningVi}" vào ${savedSet.title} (${savedSet.cards.length}/30).`;
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
      setLearnCards(preferredCards(set.cards));
      setLearnIndex(0);
      setLearnCorrect(0);
      setLearnWrongCardIds([]);
      setLearnFeedback(null);
      setView("learn");
    } else {
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

  function restartLearn() {
    if (!selectedSet) return;
    clearLearnTimer();
    setLearnCards(preferredCards(selectedSet.cards));
    setLearnIndex(0);
    setLearnCorrect(0);
    setLearnWrongCardIds([]);
    setLearnFeedback(null);
  }

  function chooseLearnAnswer(choice: string) {
    if (!selectedSet || !activeLearnCard || learnFeedback) return;
    const correct = choice === activeLearnCard.word;
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
        api.setData((current) => ({ ...current, results: [createResult(selectedSet.id, "learn", learnCards.length, nextCorrect, wrongCardIds), ...current.results] }));
      }
      setLearnFeedback(null);
      setLearnIndex((current) => current + 1);
      learnTimer.current = undefined;
    }, 720);
  }

  function moveCard(offset: number) {
    if (!selectedSet) return;
    const nextIndex = Math.max(0, Math.min(selectedSet.cards.length - 1, cardIndex + offset));
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
              <div className="text-sm text-on-surface-variant dark:text-white/60">{cardIndex + 1} / {selectedSet.cards.length}</div>
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
            <ProgressBar value={percent(cardIndex + 1, selectedSet.cards.length)} />
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
                    <div className="text-sm font-bold uppercase tracking-wide text-primary dark:text-[#c9c5ff]">Nghĩa tiếng Việt</div>
                    <h2 className="mt-sm break-words font-translation-text text-3xl font-bold leading-tight text-primary dark:text-white">{activeCard.meaningVi}</h2>
                    {activeCard.definitionEn ? <p className="mt-lg text-lg leading-relaxed text-on-surface dark:text-white/85">{activeCard.definitionEn}</p> : null}
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
            <Button type="button" disabled={cardIndex === selectedSet.cards.length - 1} onClick={() => moveCard(1)} className="min-h-12 px-sm">Tiếp <Icon name="chevron_right" /></Button>
          </div>
        </div>
      </main>
    );
  }

  if (view === "learn" && selectedSet) {
    const learnComplete = learnIndex >= learnCards.length;
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
              <div className="text-sm text-on-surface-variant dark:text-white/60">Learn · Chọn từ đúng</div>
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
                  <span>{activeLearnCard.definitionEn ? "Definition" : activeLearnCard.meaningVi ? "Nghĩa" : "Example"}</span>
                  <button type="button" onClick={() => speak(learnPrompt)} aria-label="Phát nội dung câu hỏi" className="flex h-9 w-9 items-center justify-center rounded-full text-primary active:bg-primary-fixed dark:text-[#c9c5ff]"><Icon name="volume_up" className="text-xl" /></button>
                </div>
                <p className="mt-lg min-h-28 break-words text-2xl font-medium leading-relaxed text-[#101936] dark:text-white">{learnPrompt}</p>

                <div className="mt-auto pt-xl">
                  <h2 className="mb-md text-sm font-bold text-on-surface-variant dark:text-white/65">Chọn một đáp án</h2>
                  <div className="grid gap-sm">
                    {learnChoices.map((choice, index) => {
                      const isAnswer = choice === activeLearnCard.word;
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
                <span className="font-semibold">Meaning VI</span>
                <Input value={form.meaningVi} onChange={(event) => updateField("meaningVi", event.target.value)} placeholder="từ bỏ" />
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
                      <span className="mt-xs block text-sm text-on-surface-variant dark:text-white/60">{set.cards.length} từ · {getSetProgress(set)}% đã thuộc</span>
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
        <div className="mx-auto grid max-w-md grid-cols-3 gap-xs px-container-margin pt-sm">
          <button type="button" onClick={() => switchView("add")} className={`flex min-h-14 flex-col items-center justify-center gap-xs rounded-2xl text-xs font-bold transition active:scale-95 ${view === "add" ? "bg-primary-fixed text-primary dark:bg-primary/25 dark:text-white" : "text-on-surface-variant dark:text-white/60"}`}><Icon name="add_circle" /> Thêm từ</button>
          <button type="button" onClick={() => openLibrary("flashcard")} className={`flex min-h-14 flex-col items-center justify-center gap-xs rounded-2xl text-xs font-bold transition active:scale-95 ${view === "sets" && libraryMode === "flashcard" ? "bg-primary-fixed text-primary dark:bg-primary/25 dark:text-white" : "text-on-surface-variant dark:text-white/60"}`}><Icon name="style" /> Flashcard</button>
          <button type="button" onClick={() => openLibrary("learn")} className={`flex min-h-14 flex-col items-center justify-center gap-xs rounded-2xl text-xs font-bold transition active:scale-95 ${view === "sets" && libraryMode === "learn" ? "bg-primary-fixed text-primary dark:bg-primary/25 dark:text-white" : "text-on-surface-variant dark:text-white/60"}`}><Icon name="school" /> Learn</button>
        </div>
      </nav>
    </main>
  );
}

export function DashboardPage({ api }: PageProps) {
  const navigate = useNavigate();
  const cards = api.data.sets.flatMap((set) => set.cards);
  const due = cards.filter((card) => card.nextReviewAt && new Date(card.nextReviewAt) <= new Date()).length;
  const recent = [...api.data.sets].sort((a, b) => (b.lastStudiedAt ?? b.updatedAt).localeCompare(a.lastStudiedAt ?? a.updatedAt)).slice(0, 3);
  return (
    <>
      <PageTitle title="Bảng điều khiển" subtitle="Học từ vựng local, không cần đăng nhập, dữ liệu nằm trong trình duyệt của bạn." action={<Button onClick={() => navigate("/sets/new")}><Icon name="add" /> Tạo học phần</Button>} />
      <div className="grid grid-cols-2 gap-md lg:grid-cols-4">
        <Stat label="Tổng số từ" value={cards.length} icon="dictionary" />
        <Stat label="Học phần" value={api.data.sets.length} icon="library_books" />
        <Stat label="Đã thuộc" value={cards.filter((card) => card.status === "mastered").length} icon="verified" />
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
                <div className="flex justify-between gap-md"><strong>{set.title}</strong><span>{getSetProgress(set)}%</span></div>
                <ProgressBar value={getSetProgress(set)} />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

export function MySetsPage({ api }: PageProps) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const filtered = api.data.sets.filter((set) => `${set.title} ${set.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));

  function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const cards = parseCardsCsv(text);
      if (!cards.length) {
        alert("CSV không có dòng hợp lệ. File cần có cột word và meaningVi.");
        event.target.value = "";
        return;
      }
      const now = new Date().toISOString();
      api.upsertSet({ id: crypto.randomUUID(), title: file.name.replace(/\.csv$/i, ""), description: "Được import từ CSV.", tags: ["Imported"], cards, createdAt: now, updatedAt: now });
      event.target.value = "";
    });
  }

  return (
    <>
      <PageTitle title="My Sets" subtitle="Quản lý các bộ từ vựng đang lưu trên trình duyệt này." action={<Button onClick={() => navigate("/sets/new")}><Icon name="add" /> Create New Set</Button>} />
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
          {filtered.map((set) => <SetCard key={set.id} set={set} onDelete={() => confirm(`Xóa "${set.title}"?`) && api.deleteSet(set.id)} />)}
        </div>
      ) : (
        <EmptyState title="Chưa có học phần phù hợp" text="Tạo học phần mới hoặc import CSV để bắt đầu." action={<Button onClick={() => navigate("/sets/new")}><Icon name="add" /> Tạo học phần</Button>} />
      )}
    </>
  );
}

export function CreateEditSetPage({ api }: PageProps) {
  const { setId } = useParams();
  const existing = getSet(api, setId);
  const navigate = useNavigate();
  const now = new Date().toISOString();
  const [set, setSet] = useState<VocabularySet>(() => existing ?? { id: crypto.randomUUID(), title: "", description: "", tags: [], cards: [emptyCard()], createdAt: now, updatedAt: now });
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
    const validCards = set.cards.filter((card) => card.word.trim() && card.meaningVi.trim());
    if (!validCards.length) {
      alert("Cần ít nhất một từ có English word và nghĩa tiếng Việt.");
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
  const modes: [StudyMode, string, string][] = [["flashcards", "Flashcards", "style"], ["learn", "Learn", "school"], ["write", "Write", "edit_note"], ["spell", "Spell", "hearing"], ["test", "Test", "quiz"], ["match", "Match", "extension"]];
  return (
    <>
      <PageTitle title={set.title} subtitle={set.description} action={<Button variant="secondary" onClick={() => navigate(`/sets/${set.id}/edit`)}><Icon name="edit" /> Edit</Button>} />
      <Card className="mb-lg">
        <div className="mb-sm flex justify-between text-sm text-on-surface-variant dark:text-white/60"><span>{set.cards.length} từ</span><span>{getSetProgress(set)}% mastered</span></div>
        <ProgressBar value={getSetProgress(set)} />
        <div className="mt-md grid grid-cols-2 gap-sm sm:grid-cols-3 lg:grid-cols-6">
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
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const { speak } = useSpeech(api.data.settings.voiceURI);
  if (!set) return <Navigate to="/sets" replace />;
  const card = set.cards[index] ?? set.cards[0];
  if (!card) return <EmptyState title="Chưa có từ để học" text="Hãy thêm từ vào học phần trước." />;
  const mark = (correct: boolean) => {
    api.updateSet(set.id, (current) => updateSetCard(current, card.id, (item) => updateCardStudy(item, correct)));
    setFlipped(false);
    setIndex((value) => Math.min(set.cards.length - 1, value + 1));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space") { event.preventDefault(); setFlipped((value) => !value); }
      if (event.key === "ArrowRight") setIndex((value) => Math.min(set.cards.length - 1, value + 1));
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
        <div className="mb-md grid grid-cols-[auto_1fr] items-center gap-md"><span className="font-semibold">{index + 1}/{set.cards.length}</span><ProgressBar value={percent(index + 1, set.cards.length)} /></div>
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
          <Button variant="secondary" onClick={() => { api.updateSet(set.id, (current) => updateSetCard(current, card.id, (item) => ({ ...item, starred: !item.starred }))); }}><Icon name={card.starred ? "star" : "star_border"} /> Star</Button>
        </div>
      </div>
    </>
  );
}

function answerChoices(set: VocabularySet, card: VocabularyCard, field: "meaningVi" | "word") {
  const distractors = shuffle(set.cards.filter((item) => item.id !== card.id)).slice(0, 3).map((item) => item[field]);
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

function quizletPrompt(card: VocabularyCard, direction: string) {
  if (direction === "vi-en") return { label: "Definition", text: card.definitionEn || card.meaningVi || card.exampleEn, answerField: "word" as const };
  return { label: "Term", text: card.word, answerField: "meaningVi" as const };
}

export function LearnPage({ api }: PageProps) {
  const { setId } = useParams();
  const set = getSet(api, setId);
  const [queue] = useState<VocabularyCard[]>(() => set ? preferredCards(set.cards) : []);
  const [current, setCurrent] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrongCardIds, setWrongCardIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ choice: string; correct: boolean; message: string } | null>(null);
  const correctAudio = useRef<AudioContext | null>(null);
  const feedbackTimer = useRef<number | undefined>(undefined);
  const { speak } = useSpeech(api.data.settings.voiceURI);
  const activeChoiceCard = queue[current];
  const choices = useMemo(
    () => set && activeChoiceCard ? answerChoices(set, activeChoiceCard, "word") : [],
    [set?.id, activeChoiceCard?.id],
  );
  useEffect(() => () => {
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    correctAudio.current?.close();
  }, []);
  if (!set) return <Navigate to="/sets" replace />;
  const activeSet = set;
  const card = queue[current];
  if (!card) return <Summary set={activeSet} mode="learn" total={queue.length || activeSet.cards.length} correct={correct} wrongCardIds={wrongCardIds} api={api} />;
  const prompt = quizletPrompt(card, "vi-en");
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
        <Link to={`/sets/${activeSet.id}`} className="inline-flex items-center gap-xs font-semibold text-[#586383] hover:text-primary dark:text-white/65"><Icon name="arrow_back" /> Learn</Link>
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
        <div className="mt-lg min-h-20 text-xl leading-relaxed text-[#0f1b3d] dark:text-white md:mt-xl md:min-h-28 md:text-3xl">{prompt.text}</div>
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

function Summary({ api, set, mode, total, correct, wrongCardIds = [] }: PageProps & { set: VocabularySet; mode: StudyMode; total: number; correct: number; wrongCardIds?: string[] }) {
  const navigate = useNavigate();
  useEffect(() => {
    api.setData((current) => ({ ...current, results: [createResult(set.id, mode, total, correct, wrongCardIds), ...current.results] }));
  }, []);
  return (
    <Card className="mx-auto max-w-xl text-center">
      <Icon name="verified" className="text-5xl text-primary" />
      <h1 className="mt-md font-headline-lg text-headline-lg">Hoàn thành</h1>
      <p className="mt-sm text-on-surface-variant dark:text-white/65">Đúng {correct}/{total} câu. Accuracy {percent(correct, total)}%.</p>
      <div className="mt-lg flex justify-center gap-sm"><Button onClick={() => navigate(modePath(set.id, mode))}>Làm lại</Button><Button variant="secondary" onClick={() => navigate(`/sets/${set.id}`)}>Về học phần</Button></div>
    </Card>
  );
}

export function WritePage({ api }: PageProps) {
  const { setId } = useParams();
  const set = getSet(api, setId);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  if (!set) return <Navigate to="/sets" replace />;
  const activeSet = set;
  const card = activeSet.cards[index];
  if (!card) return <EmptyState title="Chưa có từ" text="Hãy thêm từ vào bộ này." />;
  function check() {
    const distance = levenshtein(answer, card.word);
    const ok = distance === 0;
    setFeedback(ok ? "Correct" : distance <= 2 ? `Almost correct: ${card.word}` : `Incorrect: ${card.word}`);
    api.updateSet(activeSet.id, (current) => updateSetCard(current, card.id, (item) => updateCardStudy(item, ok)));
  }
  return (
    <>
      <StudyHeader set={activeSet} title="Write" />
      <Card className="mx-auto max-w-2xl space-y-md">
        <div className="text-on-surface-variant dark:text-white/65">{index + 1}/{activeSet.cards.length}</div>
        <h2 className="font-translation-text text-2xl text-primary">{card.meaningVi || card.definitionEn}</h2>
        <Input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Gõ từ tiếng Anh..." onKeyDown={(e) => e.key === "Enter" && check()} />
        <div className="flex flex-wrap gap-sm"><Button onClick={check}>Check Answer</Button><Button variant="secondary" onClick={() => setAnswer(card.word.slice(0, Math.ceil(card.word.length / 2)))}>Hint</Button><Button variant="secondary" onClick={() => setFeedback(`Answer: ${card.word}`)}>Show Answer</Button><Button variant="ghost" onClick={() => { setIndex(Math.min(activeSet.cards.length - 1, index + 1)); setAnswer(""); setFeedback(""); }}>Next</Button></div>
        {feedback ? <div className="rounded-xl bg-primary-fixed p-md font-semibold text-primary">{feedback}</div> : null}
      </Card>
    </>
  );
}

export function SpellPage({ api }: PageProps) {
  const { setId } = useParams();
  const set = getSet(api, setId);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const { speak } = useSpeech(api.data.settings.voiceURI);
  if (!set) return <Navigate to="/sets" replace />;
  const activeSet = set;
  const card = activeSet.cards[index];
  if (!card) return <EmptyState title="Chưa có từ" text="Hãy thêm từ vào bộ này." />;
  const check = () => {
    const ok = answer.trim().toLowerCase() === card.word.toLowerCase();
    setFeedback(ok ? "Correct" : `Incorrect: ${card.word}`);
    api.updateSet(activeSet.id, (current) => updateSetCard(current, card.id, (item) => updateCardStudy(item, ok)));
  };
  return (
    <>
      <StudyHeader set={activeSet} title="Spell" />
      <Card className="mx-auto max-w-2xl space-y-md text-center">
        <Icon name="hearing" className="text-6xl text-primary" />
        <p className="text-on-surface-variant dark:text-white/65">Nghe và gõ lại từ tiếng Anh.</p>
        <div className="flex justify-center gap-sm"><Button onClick={() => speak(card.word)}><Icon name="play_arrow" /> Play</Button><Button variant="secondary" onClick={() => speak(card.word, 0.65)}>Slow</Button><Button variant="secondary" onClick={() => speak(card.word)}>Replay</Button></div>
        <Input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type what you hear..." />
        <div className="flex justify-center gap-sm"><Button onClick={check}>Check</Button><Button variant="ghost" onClick={() => { setIndex(Math.min(activeSet.cards.length - 1, index + 1)); setAnswer(""); setFeedback(""); }}>Next</Button></div>
        {feedback ? <div className="rounded-xl bg-primary-fixed p-md font-semibold text-primary">{feedback}</div> : null}
      </Card>
    </>
  );
}

export function TestPage({ api }: PageProps) {
  const { setId } = useParams();
  const set = getSet(api, setId);
  const [started, setStarted] = useState(false);
  const [count, setCount] = useState(10);
  const [questionType, setQuestionType] = useState("mixed");
  const [direction, setDirection] = useState("mixed");
  const [timerMinutes, setTimerMinutes] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [questions, setQuestions] = useState<VocabularyCard[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const { speak } = useSpeech(api.data.settings.voiceURI);
  if (!set) return <Navigate to="/sets" replace />;
  const activeSet = set;
  const questionKind = (index: number) => questionType === "mixed" ? (index % 3 === 0 ? "write" : index % 3 === 1 ? "truefalse" : "multiple") : questionType;
  const questionDirection = (index: number) => direction === "mixed" ? (index % 2 ? "vi-en" : "en-vi") : direction;
  const expected = (card: VocabularyCard, index: number) => questionDirection(index) === "vi-en" ? card.word : card.meaningVi;
  const trueFalseIsTrue = (index: number) => index % 2 === 0;
  const trueFalseAnswer = (card: VocabularyCard, index: number) => {
    if (trueFalseIsTrue(index)) return expected(card, index);
    const field = questionDirection(index) === "vi-en" ? "word" : "meaningVi";
    return activeSet.cards.find((item) => item.id !== card.id)?.[field] ?? expected(card, index);
  };
  const score = questions.filter((card, index) => {
    const answer = answers[card.id] ?? "";
    if (questionKind(index) === "truefalse") return answer === String(trueFalseIsTrue(index));
    return answer.trim().toLowerCase() === expected(card, index).toLowerCase();
  }).length;
  function start() { setQuestions(shuffle(activeSet.cards).slice(0, Math.min(count, activeSet.cards.length))); setStarted(true); setSubmitted(false); setAnswers({}); setRemaining(timerMinutes * 60); }
  function submit() {
    questions.forEach((card, index) => api.updateSet(activeSet.id, (current) => updateSetCard(current, card.id, (item) => updateCardStudy(item, questionKind(index) === "truefalse" ? answers[card.id] === String(trueFalseIsTrue(index)) : (answers[card.id] ?? "").trim().toLowerCase() === expected(card, index).toLowerCase()))));
    const wrongCardIds = questions
      .filter((card, index) => questionKind(index) === "truefalse"
        ? answers[card.id] !== String(trueFalseIsTrue(index))
        : (answers[card.id] ?? "").trim().toLowerCase() !== expected(card, index).toLowerCase())
      .map((card) => card.id);
    api.setData((current) => ({ ...current, results: [createResult(activeSet.id, "test", questions.length, score, wrongCardIds), ...current.results] }));
    setSubmitted(true);
  }
  useEffect(() => {
    if (!started || submitted || !remaining) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          submit();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [started, submitted, remaining]);
  if (!started) return (
    <>
      <StudyHeader set={activeSet} title="Test" />
      <Card className="mx-auto max-w-xl space-y-md">
        <h2 className="font-headline-md text-headline-md">Setup test</h2>
        <div className="grid gap-md sm:grid-cols-2">
          <label className="block"><span className="font-semibold">Số câu</span><Select value={count} onChange={(e) => setCount(Number(e.target.value))}><option value={10}>10 câu</option><option value={20}>20 câu</option><option value={50}>50 câu</option></Select></label>
          <label className="block"><span className="font-semibold">Dạng câu</span><Select value={questionType} onChange={(e) => setQuestionType(e.target.value)}><option value="mixed">Mixed</option><option value="multiple">Multiple choice</option><option value="write">Write</option><option value="truefalse">True/False</option><option value="matching">Matching</option></Select></label>
          <label className="block"><span className="font-semibold">Chiều hỏi</span><Select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="mixed">Mixed</option><option value="en-vi">EN→VI</option><option value="vi-en">VI→EN</option></Select></label>
          <label className="block"><span className="font-semibold">Timer</span><Select value={timerMinutes} onChange={(e) => setTimerMinutes(Number(e.target.value))}><option value={0}>Không giới hạn</option><option value={5}>5 phút</option><option value={10}>10 phút</option><option value={20}>20 phút</option></Select></label>
        </div>
        <Button onClick={start} className="w-full">Start Test</Button>
      </Card>
    </>
  );
  const isCorrectAnswer = (card: VocabularyCard, index: number) => {
    const answer = answers[card.id] ?? "";
    if (questionKind(index) === "truefalse") return answer === String(trueFalseIsTrue(index));
    return answer.trim().toLowerCase() === expected(card, index).toLowerCase();
  };
  if (submitted) return (
    <><StudyHeader set={set} title="Test Results" /><Card className="mx-auto max-w-3xl"><h2 className="font-headline-lg text-headline-lg">Score {score}/{questions.length}</h2><p className="mt-sm">Accuracy {percent(score, questions.length)}%</p><div className="mt-lg space-y-sm">{questions.filter((card, index) => !isCorrectAnswer(card, index)).map((card) => <div key={card.id} className="rounded-xl bg-error-container p-md text-red-900">{card.meaningVi}: <strong>{card.word}</strong></div>)}</div><div className="mt-lg flex gap-sm"><Button onClick={start}>Retry wrong words</Button><Link to={`/sets/${set.id}`}><Button variant="secondary">Done</Button></Link></div></Card></>
  );
  const answeredCount = questions.filter((card) => (answers[card.id] ?? "").trim()).length;
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-lg text-center md:mb-xl">
        <Link to={`/sets/${activeSet.id}`} className="mb-sm inline-flex items-center justify-center gap-xs font-semibold text-[#586383] hover:text-primary dark:text-white/65"><Icon name="arrow_back" /> Test</Link>
        <div className="font-headline-md text-2xl font-bold text-[#17223f] dark:text-white">{answeredCount} / {questions.length}</div>
        <div className="mx-auto max-w-[85vw] truncate font-semibold text-[#586383] dark:text-white/65 md:max-w-none">{activeSet.title}</div>
        {remaining ? <div className="mt-sm font-bold text-primary">Time left: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</div> : null}
      </div>
      <div className="space-y-lg md:space-y-xl">
        {questions.map((card, index) => {
          const kind = questionKind(index);
          const dir = questionDirection(index);
          const promptInfo = quizletPrompt(card, dir);
          const field = promptInfo.answerField;
          const currentAnswer = answers[card.id] ?? "";
          return (
            <section key={card.id} className="rounded-2xl bg-white px-md py-lg shadow-[0_12px_36px_rgba(15,23,42,0.08)] dark:bg-[#232627] md:px-xl md:py-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-sm font-bold text-[#4b587c] dark:text-white/70">
                  <span>{promptInfo.label}</span>
                  <button type="button" onClick={() => speak(card.word)} className="rounded-full p-1 hover:bg-surface-container dark:hover:bg-white/10"><Icon name="volume_up" className="text-xl" /></button>
                </div>
                <div className="text-[#7a86a5]">{index + 1} of {questions.length}</div>
              </div>
              <div className="mt-lg min-h-20 text-xl leading-relaxed text-[#0f1b3d] dark:text-white md:mt-xl md:min-h-24 md:text-[28px]">{kind === "truefalse" ? `${promptInfo.text} = ${trueFalseAnswer(card, index)}` : promptInfo.text}</div>
              <div className="mt-xl md:mt-2xl">
                <h2 className="mb-md font-bold text-[#4b587c] dark:text-white/70">{kind === "write" ? "Type the answer" : "Choose an answer"}</h2>
                {kind === "write" ? (
                  <Input className="min-h-[64px] text-xl" value={currentAnswer} onChange={(e) => setAnswers({ ...answers, [card.id]: e.target.value })} placeholder="Type your answer" />
                ) : kind === "truefalse" ? (
                  <div className="grid gap-md md:grid-cols-2">
                    {["true", "false"].map((choice, choiceIndex) => <QuizletChoice key={choice} choice={choice === "true" ? "True" : "False"} index={choiceIndex} selected={currentAnswer === choice} onClick={() => setAnswers({ ...answers, [card.id]: choice })} />)}
                  </div>
                ) : (
                  <div className="grid gap-md md:grid-cols-2">
                    {answerChoices(activeSet, card, field).map((choice, choiceIndex) => <QuizletChoice key={`${choice}-${choiceIndex}`} choice={choice} index={choiceIndex} selected={currentAnswer === choice} onClick={() => setAnswers({ ...answers, [card.id]: choice })} />)}
                  </div>
                )}
              </div>
              <div className="mt-lg flex justify-center">
                <button type="button" onClick={() => setAnswers({ ...answers, [card.id]: "__dont_know__" })} className="font-bold text-[#4255ff] hover:underline">Don&apos;t know?</button>
              </div>
            </section>
          );
        })}
        <div className="sticky bottom-24 flex justify-center md:bottom-lg">
          <Button onClick={submit} className="min-w-48 rounded-full py-md text-lg shadow-level-2">Submit Test</Button>
        </div>
      </div>
    </div>
  );
}

export function MatchPage({ api }: PageProps) {
  const { setId } = useParams();
  const set = getSet(api, setId);
  const [cards, setCards] = useState<VocabularyCard[]>(() => set ? shuffle(set.cards).slice(0, Math.min(10, Math.max(6, set.cards.length))) : []);
  const [right, setRight] = useState(() => shuffle(cards));
  const [leftPick, setLeftPick] = useState("");
  const [matched, setMatched] = useState<string[]>([]);
  const [wrong, setWrong] = useState(false);
  const [seconds, setSeconds] = useState(0);
  if (!set) return <Navigate to="/sets" replace />;
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (cards.length && matched.length === cards.length) api.recordMatchTime(set.id, seconds);
  }, [matched.length]);
  function pickMeaning(card: VocabularyCard) {
    if (leftPick === card.id) {
      setMatched((items) => [...items, card.id]);
      setLeftPick("");
    } else {
      setWrong(true);
      setTimeout(() => setWrong(false), 260);
    }
  }
  const complete = cards.length > 0 && matched.length === cards.length;
  return (
    <>
      <StudyHeader set={set} title="Match Game" />
      <Card className={`mx-auto max-w-5xl ${wrong ? "shake" : ""}`}>
        <div className="mb-md grid grid-cols-3 gap-sm text-center text-sm font-semibold md:text-base"><span>Time: {seconds}s</span><span>Score: {matched.length}/{cards.length}</span><span>Best: {api.data.matchBestTimes[set.id] ? `${api.data.matchBestTimes[set.id]}s` : "-"}</span></div>
        <div className="grid gap-md md:grid-cols-2">
          <div className="grid gap-sm">{cards.map((card) => <Button key={card.id} disabled={matched.includes(card.id)} variant={leftPick === card.id ? "primary" : "secondary"} onClick={() => setLeftPick(card.id)}>{card.word}</Button>)}</div>
          <div className="grid gap-sm">{right.map((card) => <Button key={card.id} disabled={matched.includes(card.id)} variant="secondary" onClick={() => pickMeaning(card)}>{card.meaningVi}</Button>)}</div>
        </div>
        {complete ? <div className="mt-lg rounded-2xl bg-primary-fixed p-lg text-center text-primary"><h2 className="font-headline-md text-headline-md">Hoàn thành trong {seconds}s</h2><Button className="mt-md" onClick={() => { const next = shuffle(set.cards).slice(0, Math.min(10, Math.max(6, set.cards.length))); setCards(next); setRight(shuffle(next)); setMatched([]); setSeconds(0); }}>Play again</Button></div> : null}
      </Card>
    </>
  );
}

export function ProgressPage({ api }: PageProps) {
  const cards = api.data.sets.flatMap((set) => set.cards);
  const avg = api.data.results.length ? Math.round(api.data.results.reduce((sum, item) => sum + item.accuracy, 0) / api.data.results.length) : 0;
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);
  return (
    <>
      <PageTitle title="Tiến độ học tập" subtitle="Theo dõi số từ đã thuộc, từ khó và lịch sử luyện tập." action={<Link to="/sets"><Button><Icon name="event_repeat" /> Review Difficult Words</Button></Link>} />
      <div className="grid grid-cols-2 gap-md lg:grid-cols-5"><Stat label="Tổng số từ" value={cards.length} icon="dictionary" /><Stat label="Mastered" value={cards.filter((c) => c.status === "mastered").length} icon="verified" /><Stat label="Difficult" value={cards.filter((c) => c.status === "difficult").length} icon="warning" /><Stat label="Review Today" value={cards.filter((c) => c.nextReviewAt && new Date(c.nextReviewAt) <= new Date()).length} icon="today" /><Stat label="Accuracy" value={`${avg}%`} icon="target" /></div>
      <Card className="mt-lg">
        <h2 className="font-headline-md text-headline-md">Study history</h2>
        <p className="mt-xs text-sm text-on-surface-variant dark:text-white/60">Bấm vào một lần học để xem những từ đã trả lời sai.</p>
        <div className="mt-md space-y-sm">
          {api.data.results.length ? api.data.results.slice(0, 20).map((result) => {
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
          }) : <p className="rounded-xl bg-surface-container-low p-md text-on-surface-variant dark:bg-white/5 dark:text-white/60">Chưa có lịch sử học tập.</p>}
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
          api.replaceData({ sets: parsed.sets, results: parsed.results ?? [], matchBestTimes: parsed.matchBestTimes ?? {}, settings: parsed.settings ?? api.data.settings });
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
        api.replaceData({ sets: parsed.sets, results: parsed.results ?? [], matchBestTimes: parsed.matchBestTimes ?? {}, settings: parsed.settings ?? api.data.settings });
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
