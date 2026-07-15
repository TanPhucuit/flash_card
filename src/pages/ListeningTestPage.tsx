import { FormEvent, useMemo, useState } from "react";
import { DataApi } from "../App";
import { Button, Card, Icon, Input, PageTitle, ProgressBar } from "../components/ui";
import { useYouTubePlayer } from "../hooks/useYouTubePlayer";
import { createListeningResult, percent } from "../utils/study";
import { extractYouTubeVideoId, fetchListeningTranslation, fetchYouTubeTranscript, isListeningAnswerCorrect, SubtitleCue } from "../utils/listening";

type Phase = "setup" | "test" | "result";
type Feedback = { correct: boolean } | null;
type TranslationState = { cueId: string; text: string; loading: boolean; error: string } | null;

export function ListeningTestPage({ api }: { api: DataApi }) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [captionLanguage, setCaptionLanguage] = useState("");
  const [setupError, setSetupError] = useState("");
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [cueIndex, setCueIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [translation, setTranslation] = useState<TranslationState>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [finalAccuracy, setFinalAccuracy] = useState(0);
  const { containerRef, ready, playing, error: playerError, playSegment, pause } = useYouTubePlayer(activeVideoId);
  const currentCue = cues[cueIndex];
  const parsedVideoId = useMemo(() => extractYouTubeVideoId(youtubeUrl), [youtubeUrl]);

  function resetAttempt() {
    setCueIndex(0);
    setAnswer("");
    setFeedback(null);
    setTranslation(null);
    setCorrectCount(0);
  }

  async function beginTest() {
    if (!parsedVideoId) {
      setSetupError("URL YouTube không hợp lệ hoặc không được hỗ trợ.");
      return;
    }
    setSetupError("");
    setLoadingTranscript(true);
    try {
      const transcript = await fetchYouTubeTranscript(parsedVideoId);
      setCues(transcript.cues);
      setCaptionLanguage(transcript.language);
      resetAttempt();
      setActiveVideoId(parsedVideoId);
      setPhase("test");
    } catch (error) {
      setCues([]);
      setCaptionLanguage("");
      setSetupError(error instanceof Error ? error.message : "Không thể tự lấy phụ đề từ YouTube.");
    } finally {
      setLoadingTranscript(false);
    }
  }

  function checkAnswer(event?: FormEvent) {
    event?.preventDefault();
    if (!currentCue || feedback || !answer.trim()) return;
    const correct = isListeningAnswerCorrect(answer, currentCue.text);
    setFeedback({ correct });
    if (correct) setCorrectCount((count) => count + 1);
    pause();
  }

  function skipCue() {
    if (!currentCue || feedback) return;
    setFeedback({ correct: false });
    pause();
  }

  async function showTranslation() {
    if (!currentCue || translation?.loading) return;
    const cueId = currentCue.id;
    setTranslation({ cueId, text: "", loading: true, error: "" });
    try {
      const text = await fetchListeningTranslation(currentCue.text);
      setTranslation({ cueId, text, loading: false, error: "" });
    } catch (error) {
      setTranslation({
        cueId,
        text: "",
        loading: false,
        error: error instanceof Error ? error.message : "Không thể tải bản dịch.",
      });
    }
  }

  function finishTest(nextCorrectCount: number) {
    const accuracy = percent(nextCorrectCount, cues.length);
    setFinalAccuracy(accuracy);
    setActiveVideoId(null);
    setPhase("result");
    api.setData((current) => ({
      ...current,
      results: [createListeningResult(accuracy), ...current.results],
    }));
  }

  function nextCue() {
    if (!feedback || !currentCue) return;
    const nextCorrectCount = correctCount;
    if (cueIndex >= cues.length - 1) {
      finishTest(nextCorrectCount);
      return;
    }
    const nextIndex = cueIndex + 1;
    const next = cues[nextIndex];
    setCueIndex(nextIndex);
    setAnswer("");
    setFeedback(null);
    setTranslation(null);
    playSegment(next.startSeconds, next.endSeconds);
  }

  function retryTest() {
    if (!parsedVideoId || !cues.length) return;
    resetAttempt();
    setActiveVideoId(parsedVideoId);
    setPhase("test");
  }

  function newTest() {
    setActiveVideoId(null);
    setPhase("setup");
    resetAttempt();
    setFinalAccuracy(0);
    setYoutubeUrl("");
    setCues([]);
    setCaptionLanguage("");
    setSetupError("");
  }

  if (phase === "setup") {
    return (
      <>
        <PageTitle title="Listening Dictation Test" subtitle="Nghe từng đoạn video, gõ lại câu bạn nghe được và kiểm tra độ chính xác." />
        <Card className="mx-auto max-w-3xl">
          <div className="mb-lg flex items-start gap-md rounded-2xl bg-primary-fixed p-md text-primary dark:bg-primary/20 dark:text-white">
            <Icon name="privacy_tip" className="mt-xs shrink-0" />
            <p>URL, phụ đề tự lấy và câu trả lời chỉ tồn tại trong phiên hiện tại. Ứng dụng chỉ lưu phần trăm đúng sau khi hoàn thành.</p>
          </div>
          <div className="space-y-lg">
            <label className="block">
              <span className="font-semibold">YouTube URL</span>
              <Input value={youtubeUrl} onChange={(event) => { setYoutubeUrl(event.target.value); setSetupError(""); }} placeholder="https://www.youtube.com/watch?v=..." className="mt-sm min-h-12" />
            </label>
            {setupError ? <div className="rounded-xl bg-error-container p-md font-semibold text-red-900">{setupError}</div> : null}
            <Button type="button" onClick={beginTest} disabled={!parsedVideoId || loadingTranscript} className="min-h-14 w-full text-lg">
              <Icon name={loadingTranscript ? "progress_activity" : "play_arrow"} className={loadingTranscript ? "animate-spin" : ""} />
              {loadingTranscript ? "Đang lấy phụ đề..." : "Tự lấy phụ đề và bắt đầu"}
            </Button>
          </div>
        </Card>
      </>
    );
  }

  if (phase === "result") {
    return (
      <Card className="mx-auto flex min-h-[520px] max-w-2xl flex-col items-center justify-center text-center">
        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_18px_44px_rgba(5,150,105,0.25)]"><Icon name="check" className="text-5xl" /></span>
        <h1 className="mt-lg font-headline-lg text-headline-lg">Hoàn thành Listening Test</h1>
        <div className="mt-md text-6xl font-bold text-primary dark:text-[#c9c5ff]">{finalAccuracy}%</div>
        <p className="mt-sm text-on-surface-variant dark:text-white/60">Kết quả phần trăm đã được lưu. Video và phụ đề không được lưu.</p>
        <div className="mt-xl flex flex-wrap justify-center gap-sm">
          <Button type="button" onClick={retryTest}><Icon name="refresh" /> Làm lại</Button>
          <Button type="button" variant="secondary" onClick={newTest}><Icon name="add" /> Bài test mới</Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <PageTitle title="Listening Dictation Test" subtitle={`Đoạn ${cueIndex + 1} / ${cues.length} · ${captionLanguage}`} action={<Button type="button" variant="secondary" onClick={newTest}><Icon name="close" /> Thoát bài test</Button>} />
      <div className="mb-lg grid grid-cols-[auto_1fr_auto] items-center gap-md">
        <strong>{cueIndex + 1}</strong>
        <ProgressBar value={percent(cueIndex, cues.length)} />
        <strong>{cues.length}</strong>
      </div>
      <div className="grid gap-lg xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden p-0">
          <div className="aspect-video min-h-[270px] bg-black">
            <div ref={containerRef} className="h-full w-full" />
          </div>
          <div className="flex flex-wrap items-center gap-sm p-md">
            <Button type="button" onClick={() => currentCue && playSegment(currentCue.startSeconds, currentCue.endSeconds)} disabled={!ready}><Icon name="replay" /> {playing ? "Phát lại đoạn" : "Phát đoạn"}</Button>
            <Button type="button" variant="secondary" onClick={pause} disabled={!ready || !playing}><Icon name="pause" /> Tạm dừng</Button>
            {!ready && !playerError ? <span className="text-sm text-on-surface-variant dark:text-white/60">Đang tải YouTube Player...</span> : null}
          </div>
          {playerError ? <div className="mx-md mb-md rounded-xl bg-error-container p-md font-semibold text-red-900">{playerError}</div> : null}
        </Card>

        <Card className={`flex min-h-[430px] flex-col transition-colors ${feedback?.correct ? "border-emerald-500" : ""}`}>
          <div className="flex items-center justify-between">
            <span className="font-semibold text-on-surface-variant dark:text-white/65">Type what you hear</span>
            <span className="rounded-full bg-primary-fixed px-sm py-xs text-sm font-bold text-primary">Đúng {correctCount}</span>
          </div>
          <form onSubmit={checkAnswer} className="mt-lg flex flex-1 flex-col">
            <textarea
              autoFocus
              value={answer}
              disabled={Boolean(feedback)}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Gõ câu bạn nghe được..."
              className="min-h-40 w-full resize-none rounded-2xl border-2 border-surface-variant bg-white p-md text-xl leading-relaxed text-on-surface outline-none transition focus:border-primary dark:border-white/10 dark:bg-[#202324] dark:text-white"
            />
            {!feedback ? <p className="mt-sm text-xs text-on-surface-variant dark:text-white/55">Không tính dấu câu; chấp nhận dạng viết tắt, thiếu “s” số nhiều và lỗi chính tả nhỏ.</p> : null}
            {feedback && currentCue ? (
              <div className={`mt-md rounded-2xl p-md ${feedback.correct ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200"}`}>
                <div className="flex items-center gap-sm font-bold"><Icon name={feedback.correct ? "check_circle" : "cancel"} /> {feedback.correct ? "Chính xác" : "Chưa chính xác"}</div>
                <div className={`mt-sm grid gap-md ${translation?.cueId === currentCue.id && translation.text ? "lg:grid-cols-2" : ""}`}>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide opacity-70">Transcript</div>
                    <p className="mt-xs text-lg leading-relaxed">{currentCue.text}</p>
                  </div>
                  {translation?.cueId === currentCue.id && translation.text ? (
                    <div className="border-t border-current/15 pt-md lg:border-l lg:border-t-0 lg:pl-md lg:pt-0">
                      <div className="text-xs font-bold uppercase tracking-wide opacity-70">Bản dịch</div>
                      <p className="mt-xs text-lg leading-relaxed">{translation.text}</p>
                    </div>
                  ) : null}
                </div>
                <div className="mt-md flex flex-wrap items-center gap-sm">
                  {!translation?.text || translation.cueId !== currentCue.id ? (
                    <Button type="button" variant="secondary" onClick={showTranslation} disabled={translation?.cueId === currentCue.id && translation.loading} className="min-h-10 px-md py-xs text-sm">
                      <Icon name={translation?.cueId === currentCue.id && translation.loading ? "progress_activity" : "translate"} className={translation?.cueId === currentCue.id && translation.loading ? "animate-spin" : ""} />
                      {translation?.cueId === currentCue.id && translation.loading ? "Đang dịch..." : "Hiện bản dịch"}
                    </Button>
                  ) : null}
                  {translation?.cueId === currentCue.id && translation.error ? <span className="text-sm font-semibold">{translation.error}</span> : null}
                </div>
              </div>
            ) : null}
            <div className="mt-auto flex flex-wrap justify-end gap-sm pt-lg">
              {!feedback ? (
                <>
                  <Button type="button" variant="ghost" onClick={skipCue}>Skip</Button>
                  <Button type="submit" disabled={!answer.trim()}><Icon name="check" /> Check</Button>
                </>
              ) : (
                <Button type="button" onClick={nextCue}>{cueIndex === cues.length - 1 ? "Xem kết quả" : "Next"} <Icon name="arrow_forward" /></Button>
              )}
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
