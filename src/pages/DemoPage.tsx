import { useMemo, useState } from "react";
import { Button, Card, Icon, Input } from "../components/ui";
import { DEMO_CARDS, DEMO_SET_TITLE, DEMO_YOUTUBE_URL } from "../data/demoSet";
import { fetchYouTubeTranscript, isListeningAnswerCorrect } from "../utils/listening";
import type { SubtitleCue } from "../utils/listening";

type DemoMode = "flashcard" | "learn";

function extractYouTubeId(url: string) {
  const match = url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/)([\w-]{11})/);
  return match?.[1] ?? "";
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function FlashcardMode() {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = DEMO_CARDS[index];

  function go(delta: number) {
    setFlipped(false);
    setIndex((current) => (current + delta + DEMO_CARDS.length) % DEMO_CARDS.length);
  }

  return (
    <div className="flex flex-col items-center gap-md">
      <div className="text-sm font-semibold text-on-surface-variant dark:text-white/60">
        {index + 1} / {DEMO_CARDS.length}
      </div>
      <button
        type="button"
        onClick={() => setFlipped((value) => !value)}
        className="flex min-h-64 w-full max-w-xl flex-col items-center justify-center rounded-2xl border border-surface-variant bg-white p-lg text-center shadow-level-1 transition dark:border-white/10 dark:bg-[#232627]"
      >
        {!flipped ? (
          <>
            <div className="font-headline-md text-3xl font-bold">{card.word}</div>
            <div className="mt-sm text-on-surface-variant dark:text-white/60">/{card.ipa}/</div>
            <div className="mt-lg text-sm text-on-surface-variant dark:text-white/50">Nhấn để xem nghĩa</div>
          </>
        ) : (
          <>
            <div className="text-2xl font-bold text-primary dark:text-[#c3c0ff]">{card.meaningVi}</div>
            <p className="mt-md text-on-surface-variant dark:text-white/70">{card.definitionEn}</p>
            <p className="mt-md italic">{card.exampleEn}</p>
            <p className="text-on-surface-variant dark:text-white/60">{card.exampleVi}</p>
          </>
        )}
      </button>
      <div className="flex gap-sm">
        <Button variant="secondary" onClick={() => go(-1)}>
          <Icon name="chevron_left" /> Trước
        </Button>
        <Button onClick={() => go(1)}>
          Tiếp <Icon name="chevron_right" />
        </Button>
      </div>
    </div>
  );
}

function LearnMode() {
  const [order] = useState(() => shuffle(DEMO_CARDS));
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  const question = order[index];
  const options = useMemo(() => {
    if (!question) return [];
    const distractors = shuffle(DEMO_CARDS.filter((c) => c.word !== question.word)).slice(0, 3);
    return shuffle([question, ...distractors]);
  }, [question]);

  if (!question) {
    return (
      <Card className="flex flex-col items-center gap-md text-center">
        <Icon name="celebration" className="text-5xl text-primary" />
        <h3 className="font-headline-md text-xl font-bold">Hoàn thành!</h3>
        <p className="text-on-surface-variant dark:text-white/60">
          Bạn đúng {score} / {order.length} câu.
        </p>
        <Button
          onClick={() => {
            setIndex(0);
            setScore(0);
            setPicked(null);
          }}
        >
          Học lại
        </Button>
      </Card>
    );
  }

  function choose(meaningVi: string) {
    if (picked) return;
    setPicked(meaningVi);
    if (meaningVi === question.meaningVi) setScore((s) => s + 1);
  }

  function next() {
    setPicked(null);
    setIndex((i) => i + 1);
  }

  return (
    <Card className="mx-auto flex max-w-xl flex-col gap-md">
      <div className="text-sm font-semibold text-on-surface-variant dark:text-white/60">
        Câu {index + 1} / {order.length} · Đúng: {score}
      </div>
      <div className="rounded-xl bg-surface-container-low p-md text-center dark:bg-white/5">
        <div className="font-headline-md text-2xl font-bold">{question.word}</div>
        <p className="mt-xs text-on-surface-variant dark:text-white/60">{question.definitionEn}</p>
      </div>
      <div className="grid gap-sm">
        {options.map((option) => {
          const isCorrect = option.meaningVi === question.meaningVi;
          const isPicked = picked === option.meaningVi;
          const showState = picked !== null && (isCorrect || isPicked);
          return (
            <button
              key={option.word}
              type="button"
              onClick={() => choose(option.meaningVi)}
              disabled={picked !== null}
              className={`rounded-xl border px-md py-sm text-left font-semibold transition ${
                showState
                  ? isCorrect
                    ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300"
                    : "border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                  : "border-surface-variant bg-white hover:border-primary dark:border-white/10 dark:bg-[#232627]"
              }`}
            >
              {option.meaningVi}
            </button>
          );
        })}
      </div>
      {picked ? (
        <Button onClick={next} className="self-end">
          Câu tiếp <Icon name="arrow_forward" />
        </Button>
      ) : null}
    </Card>
  );
}

function YouTubeSpellCheck() {
  const [url, setUrl] = useState(DEMO_YOUTUBE_URL);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [cueIndex, setCueIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState<"correct" | "wrong" | null>(null);

  const videoId = extractYouTubeId(url);
  const cue = cues[cueIndex];

  async function loadTranscript() {
    if (!videoId) {
      setStatus("error");
      setError("Link YouTube không hợp lệ.");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const { cues: fetched } = await fetchYouTubeTranscript(videoId);
      setCues(fetched);
      setCueIndex(Math.floor(Math.random() * fetched.length));
      setAnswer("");
      setChecked(null);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Không thể tải phụ đề.");
    }
  }

  function checkSpelling() {
    if (!cue) return;
    setChecked(isListeningAnswerCorrect(answer, cue.text) ? "correct" : "wrong");
  }

  function nextSentence() {
    if (!cues.length) return;
    setCueIndex(Math.floor(Math.random() * cues.length));
    setAnswer("");
    setChecked(null);
  }

  return (
    <Card className="mx-auto flex max-w-xl flex-col gap-md">
      <h3 className="font-headline-md text-lg font-bold">Kiểm tra chính tả từ YouTube</h3>
      <div className="flex flex-col gap-sm sm:flex-row">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Dán link YouTube..." />
        <Button onClick={loadTranscript} disabled={status === "loading"}>
          <Icon name="closed_caption" /> {status === "loading" ? "Đang tải..." : "Lấy phụ đề"}
        </Button>
      </div>

      {videoId ? (
        <div className="aspect-video w-full overflow-hidden rounded-xl">
          <iframe
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${videoId}`}
            title="YouTube video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : null}

      {status === "error" ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

      {status === "ready" && cue ? (
        <div className="flex flex-col gap-sm">
          <p className="text-sm text-on-surface-variant dark:text-white/60">
            Nghe video rồi gõ lại câu bạn nghe được (khoảng {Math.round(cue.startSeconds)}s):
          </p>
          <Input
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              setChecked(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && checkSpelling()}
            placeholder="Gõ câu bạn nghe được..."
          />
          <div className="flex gap-sm">
            <Button onClick={checkSpelling}>Kiểm tra</Button>
            <Button variant="secondary" onClick={nextSentence}>
              Câu khác
            </Button>
          </div>
          {checked === "correct" ? (
            <p className="font-semibold text-green-600">Chính xác!</p>
          ) : checked === "wrong" ? (
            <p className="font-semibold text-red-600">Chưa đúng. Đáp án: "{cue.text}"</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function DemoPage() {
  const [mode, setMode] = useState<DemoMode>("flashcard");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-lg px-md py-xl text-on-background dark:bg-[#191c1d] dark:text-white">
      <header className="text-center">
        <h1 className="font-headline-md text-2xl font-bold text-primary dark:text-[#c3c0ff]">{DEMO_SET_TITLE}</h1>
        <p className="mt-xs text-on-surface-variant dark:text-white/60">{DEMO_CARDS.length} từ · Demo</p>
      </header>

      <div className="mx-auto flex gap-sm rounded-full bg-surface-container-low p-xs dark:bg-white/5">
        <button
          type="button"
          onClick={() => setMode("flashcard")}
          className={`rounded-full px-lg py-sm font-semibold transition ${mode === "flashcard" ? "bg-primary text-on-primary" : "text-on-surface-variant dark:text-white/60"}`}
        >
          <Icon name="style" /> Flashcard
        </button>
        <button
          type="button"
          onClick={() => setMode("learn")}
          className={`rounded-full px-lg py-sm font-semibold transition ${mode === "learn" ? "bg-primary text-on-primary" : "text-on-surface-variant dark:text-white/60"}`}
        >
          <Icon name="school" /> Learn
        </button>
      </div>

      {mode === "flashcard" ? <FlashcardMode /> : <LearnMode />}

      <YouTubeSpellCheck />
    </main>
  );
}
