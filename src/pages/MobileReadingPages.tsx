import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MobileNav, MobileTab } from "../components/MobileNav";
import { Button, Icon, Input, ProgressBar } from "../components/ui";
import { ReadingApi } from "../hooks/useReadingData";
import { ReadingAttempt, ReadingQuestion } from "../types/reading";
import { isAnswerCorrect } from "../utils/readingPdf";
import { BUILTIN_LIBRARY_ID, toDateKey } from "../utils/readingStorage";
import { CHOICE_SETS, bandFor, formatClock, uid } from "./ReadingPages";

const LIBRARY_SCROLL_KEY = "mobileReadingLibraryScroll";

// ---------------------------------------------------------------- Library --

export function MobileReadingLibraryPage({ api }: { api: ReadingApi }) {
  const navigate = useNavigate();
  const { books, attempts } = api.data;
  const { stats } = api;
  const [filter, setFilter] = useState<"all" | "todo" | "done">("all");
  const [query, setQuery] = useState("");
  const restoredScroll = useRef(false);

  const bestByPassage = useMemo(() => {
    const map = new Map<string, ReadingAttempt>();
    for (const attempt of attempts) {
      const previous = map.get(attempt.passageId);
      if (!previous || attempt.correct / (attempt.total || 1) > previous.correct / (previous.total || 1)) {
        map.set(attempt.passageId, attempt);
      }
    }
    return map;
  }, [attempts]);

  const visibleBooks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return books
      .map((book) => ({
        book,
        passages: book.passages.filter((passage) => {
          if (needle && !passage.title.toLowerCase().includes(needle)) return false;
          if (filter === "all") return true;
          return (filter === "done") === bestByPassage.has(passage.id);
        }),
      }))
      .filter((entry) => entry.passages.length);
  }, [books, query, filter, bestByPassage]);

  const totalPassages = books.reduce((sum, book) => sum + book.passages.length, 0);
  const donePassages = books.reduce((sum, book) => sum + book.passages.filter((passage) => bestByPassage.has(passage.id)).length, 0);

  // Quay lại từ một bài làm thì về đúng chỗ đang xem trong danh sách hơn 100
  // bài, thay vì bị đẩy lên đầu và phải cuộn tìm lại. Thư viện dựng sẵn được
  // tải bất đồng bộ nên chỉ khôi phục sau khi danh sách đã có nội dung.
  useLayoutEffect(() => {
    if (restoredScroll.current || !books.length) return;
    restoredScroll.current = true;
    const saved = Number(sessionStorage.getItem(LIBRARY_SCROLL_KEY) || 0);
    if (saved > 0) window.scrollTo(0, saved);
  }, [books.length]);

  const openPassage = (bookId: string, passageId: string) => {
    sessionStorage.setItem(LIBRARY_SCROLL_KEY, String(window.scrollY));
    navigate(`/reading/${bookId}/${passageId}`);
  };

  const selectTab = (tab: MobileTab) => {
    if (tab === "reading") return;
    sessionStorage.removeItem(LIBRARY_SCROLL_KEY);
    navigate(tab === "add" ? "/" : `/?tab=${tab}`);
  };

  return (
    <main className="mobile-app-shell min-h-screen overflow-x-clip bg-[#f4f5fb] text-on-background dark:bg-[#17191a] dark:text-white">
      <div className="mx-auto min-h-[100dvh] max-w-md px-container-margin pb-28">
        <header className="-mx-container-margin mb-md px-container-margin pb-sm pt-md">
          <div className="text-xs font-bold uppercase tracking-widest text-on-surface-variant dark:text-white/50">Local English</div>
          <h1 className="font-headline-md text-2xl font-bold text-primary dark:text-[#c9c5ff]">IELTS Reading</h1>
          <div className="mt-sm grid grid-cols-3 gap-sm">
            <MiniStat label="Hôm nay" value={`${stats.todayCount}`} />
            <MiniStat label="Đã làm" value={`${donePassages}/${totalPassages}`} />
            <MiniStat label="Chính xác" value={`${stats.overallAccuracy}%`} />
          </div>
          <div className="mt-sm flex gap-sm">
            <div className="relative flex-1">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm bài đọc..."
                className="min-h-11 pl-10 text-base"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
          </div>
          <div className="mt-sm grid grid-cols-3 gap-1 rounded-xl bg-surface-container p-1 dark:bg-white/5">
            {([
              ["all", "Tất cả"],
              ["todo", "Chưa làm"],
              ["done", "Đã làm"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`min-h-10 rounded-lg text-sm font-bold transition active:scale-95 ${
                  filter === value ? "bg-white text-primary shadow-level-1 dark:bg-primary/30 dark:text-white" : "text-on-surface-variant dark:text-white/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {api.syncError ? (
          <div className="mb-md rounded-xl bg-error-container p-md text-sm font-semibold text-red-900">{api.syncError}</div>
        ) : null}

        {!books.length ? (
          <div className="flex flex-col items-center gap-sm py-xl text-center text-on-surface-variant">
            <Icon name="hourglass_top" className="animate-pulse text-4xl text-primary" />
            <p className="font-semibold">Đang tải thư viện bài đọc...</p>
          </div>
        ) : !visibleBooks.length ? (
          <p className="py-xl text-center text-sm text-on-surface-variant">Không có bài nào khớp bộ lọc.</p>
        ) : (
          visibleBooks.map(({ book, passages }) => (
            <section key={book.id} className="mb-lg">
              <h2 className="mb-sm px-xs text-xs font-bold uppercase tracking-wider text-on-surface-variant dark:text-white/50">
                {book.title} · {passages.length} bài
              </h2>
              <div className="overflow-hidden rounded-2xl border border-surface-variant bg-white shadow-level-1 dark:border-white/10 dark:bg-[#242728]">
                {passages.map((passage, index) => {
                  const best = bestByPassage.get(passage.id);
                  const ratio = best && best.total ? best.correct / best.total : 0;
                  return (
                    <button
                      key={passage.id}
                      type="button"
                      onClick={() => openPassage(book.id, passage.id)}
                      className={`flex min-h-14 w-full items-center gap-md px-md py-sm text-left transition active:bg-surface-container dark:active:bg-white/5 ${
                        index ? "border-t border-surface-variant dark:border-white/10" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold">{passage.title}</p>
                        <p className="text-xs text-on-surface-variant dark:text-white/55">{passage.questions.length} câu hỏi</p>
                      </div>
                      {best ? (
                        <span
                          className={`shrink-0 rounded-lg px-sm py-xs text-sm font-bold ${
                            ratio >= 0.75
                              ? "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200"
                              : ratio >= 0.5
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
                                : "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200"
                          }`}
                        >
                          {best.correct}/{best.total}
                        </span>
                      ) : (
                        <Icon name="chevron_right" className="shrink-0 text-on-surface-variant" />
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
      <MobileNav active="reading" onSelect={selectTab} />
    </main>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white px-sm py-xs text-center shadow-level-1 dark:bg-[#242728]">
      <p className="text-base font-bold tabular-nums text-primary dark:text-[#c9c5ff]">{value}</p>
      <p className="text-[11px] font-semibold text-on-surface-variant dark:text-white/55">{label}</p>
    </div>
  );
}

// ------------------------------------------------------------------- Test --

export function MobileReadingTestPage({ api }: { api: ReadingApi }) {
  const { bookId, passageId } = useParams<{ bookId: string; passageId: string }>();
  const navigate = useNavigate();
  const book = api.data.books.find((item) => item.id === bookId);
  const passage = book?.passages.find((item) => item.id === passageId);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [atQuestions, setAtQuestions] = useState(false);
  const savedRef = useRef(false);
  const passageRef = useRef<HTMLElement>(null);
  const questionsRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [passageId]);

  useEffect(() => {
    if (submitted) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [submitted]);

  // Biết người dùng đang ở phần bài đọc hay phần câu hỏi để nút nổi chuyển
  // đúng chiều: đang đọc thì "xuống câu hỏi", đang làm thì "lên bài đọc" —
  // thay cho bố cục hai cột của bản desktop vốn không vừa màn hình điện thoại.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = questionsRef.current?.getBoundingClientRect().top;
      if (top !== undefined) setAtQuestions(top < window.innerHeight * 0.6);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [passage]);

  const scorable = useMemo(() => passage?.questions.filter((q) => q.answer) ?? [], [passage]);
  // Lời dẫn (kèm danh sách heading) chỉ gắn ở câu đầu của mỗi nhóm; câu sau
  // thừa hưởng lời dẫn gần nhất phía trên để tra được nội dung nhãn đã chọn.
  const groupLabels = useMemo(() => {
    let last: Record<string, string> = {};
    return (passage?.questions ?? []).map((q) => {
      if (q.instruction) last = Object.fromEntries(parseLabelledList(q.instruction).map((item) => [item.label, item.text]));
      return last;
    });
  }, [passage]);
  const correctCount = useMemo(
    () => scorable.filter((q) => isAnswerCorrect(answers[q.id] ?? "", q.answer)).length,
    [scorable, answers],
  );

  if (!book || !passage) {
    // Thư viện dựng sẵn được tải bất đồng bộ — mở thẳng link bài đọc (hoặc tải
    // lại trang) sẽ có vài trăm mili-giây chưa có dữ liệu, không phải "không tồn tại".
    const loading = !api.data.books.length || (bookId === BUILTIN_LIBRARY_ID && !book);
    return (
      <main className="mobile-app-shell flex min-h-[100dvh] flex-col items-center justify-center gap-md bg-[#f4f5fb] px-container-margin text-center dark:bg-[#17191a] dark:text-white">
        <Icon name={loading ? "hourglass_top" : "search_off"} className={`text-5xl text-primary ${loading ? "animate-pulse" : ""}`} />
        <p className="font-semibold">{loading ? "Đang tải bài đọc..." : "Không tìm thấy bài đọc này."}</p>
        {!loading ? <Button onClick={() => navigate("/reading")} className="min-h-12">Về thư viện</Button> : null}
      </main>
    );
  }

  const answeredCount = passage.questions.filter((q) => (answers[q.id] ?? "").trim()).length;

  const leave = () => {
    if (!submitted && answeredCount > 0 && !confirm("Bài làm chưa nộp sẽ mất. Vẫn thoát?")) return;
    navigate("/reading");
  };

  const scrollTo = (target: HTMLElement | null) => target?.scrollIntoView({ behavior: "smooth", block: "start" });

  const submit = () => {
    if (savedRef.current) return;
    const unanswered = passage.questions.length - answeredCount;
    if (unanswered > 0 && !confirm(`Còn ${unanswered} câu chưa trả lời. Nộp bài luôn?`)) return;
    savedRef.current = true;
    setSubmitted(true);
    const finishedAt = new Date();
    api.recordAttempt({
      id: uid(),
      bookId: book.id,
      bookTitle: book.title,
      passageId: passage.id,
      passageTitle: passage.title,
      startedAt,
      finishedAt: finishedAt.toISOString(),
      durationSec: elapsed,
      answers,
      correct: correctCount,
      total: scorable.length,
      dateKey: toDateKey(finishedAt),
    });
  };

  const retry = () => {
    savedRef.current = false;
    setAnswers({});
    setFlagged(new Set());
    setSubmitted(false);
    setElapsed(0);
    setStartedAt(new Date().toISOString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="mobile-app-shell min-h-screen overflow-x-clip bg-[#f4f5fb] text-on-background dark:bg-[#17191a] dark:text-white">
      <header className="sticky top-0 z-30 border-b border-surface-variant bg-white/95 backdrop-blur dark:border-white/10 dark:bg-[#202324]/95">
        <div className="mx-auto flex h-14 max-w-md items-center gap-sm px-sm">
          <button type="button" onClick={leave} aria-label="Về thư viện" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 active:bg-surface-container dark:active:bg-white/10">
            <Icon name="arrow_back" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold leading-5">{passage.title}</p>
            <p className="text-xs text-on-surface-variant dark:text-white/55">{answeredCount}/{passage.questions.length} đã trả lời</p>
          </div>
          <span className={`shrink-0 rounded-lg px-sm py-xs font-mono text-base font-bold tabular-nums ${submitted ? "bg-surface-container dark:bg-white/10" : elapsed >= 20 * 60 ? "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200" : "bg-primary-fixed text-primary dark:bg-primary/25 dark:text-white"}`}>
            {formatClock(elapsed)}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-md pb-40">
        <article ref={passageRef} className="scroll-mt-16 px-container-margin pb-lg pt-lg">
          <h1 className="mb-md font-headline-md text-xl font-bold leading-7">{passage.title}</h1>
          <PassageText text={passage.text} />
        </article>

        <section ref={questionsRef} className="scroll-mt-14 border-t-8 border-surface-container px-container-margin pt-lg dark:border-white/5">
          <div className="mb-md flex items-center justify-between">
            <h2 className="text-lg font-bold">Câu hỏi</h2>
            <span className="text-sm text-on-surface-variant dark:text-white/55">{passage.questions.length} câu</span>
          </div>

          {submitted ? (
            <div ref={resultRef} className="mb-lg scroll-mt-16 rounded-2xl bg-primary-fixed p-md dark:bg-primary/20">
              <div className="grid grid-cols-3 gap-sm text-center">
                <div>
                  <p className="text-xs text-on-surface-variant dark:text-white/60">Đúng</p>
                  <p className="text-2xl font-bold tabular-nums">{correctCount}/{scorable.length}</p>
                </div>
                <div>
                  <p className="text-xs text-on-surface-variant dark:text-white/60">Band</p>
                  <p className="text-2xl font-bold">{bandFor(correctCount, scorable.length)}</p>
                </div>
                <div>
                  <p className="text-xs text-on-surface-variant dark:text-white/60">Thời gian</p>
                  <p className="text-2xl font-bold tabular-nums">{formatClock(elapsed)}</p>
                </div>
              </div>
              <div className="mt-sm"><ProgressBar value={scorable.length ? (correctCount / scorable.length) * 100 : 0} /></div>
              {api.syncError ? <p className="mt-sm rounded-xl bg-error-container p-sm text-sm font-semibold text-red-900">{api.syncError}</p> : null}
            </div>
          ) : null}

          {passage.questions.map((question, index) => (
            <MobileQuestionBlock
              key={question.id}
              question={question}
              showInstruction={Boolean(question.instruction) && question.instruction !== passage.questions[index - 1]?.instruction}
              labels={groupLabels[index]}
              value={answers[question.id] ?? ""}
              submitted={submitted}
              flagged={flagged.has(question.id)}
              onToggleFlag={() =>
                setFlagged((current) => {
                  const next = new Set(current);
                  if (next.has(question.id)) next.delete(question.id);
                  else next.add(question.id);
                  return next;
                })
              }
              onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
            />
          ))}
        </section>
      </div>

      <button
        type="button"
        onClick={() => scrollTo(atQuestions ? passageRef.current : questionsRef.current)}
        className="fixed right-4 z-30 flex h-12 items-center gap-xs rounded-full bg-on-surface px-md text-sm font-bold text-white shadow-level-2 transition active:scale-95 dark:bg-white dark:text-[#17191a]"
        style={{ bottom: "calc(max(10px, env(safe-area-inset-bottom)) + 80px)" }}
      >
        <Icon name={atQuestions ? "arrow_upward" : "arrow_downward"} className="text-[20px]" />
        {atQuestions ? "Bài đọc" : "Câu hỏi"}
      </button>

      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-variant bg-white/95 backdrop-blur dark:border-white/10 dark:bg-[#202324]/95"
        style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-md items-center gap-md px-container-margin pt-sm">
          {submitted ? (
            <>
              <Button variant="secondary" onClick={retry} className="min-h-12 flex-1"><Icon name="restart_alt" /> Làm lại</Button>
              <Button onClick={() => navigate("/reading")} className="min-h-12 flex-1"><Icon name="menu_book" /> Thư viện</Button>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <p className="mb-xs text-xs font-semibold text-on-surface-variant dark:text-white/60">{answeredCount}/{passage.questions.length} câu</p>
                <ProgressBar value={(answeredCount / (passage.questions.length || 1)) * 100} />
              </div>
              <Button onClick={submit} className="min-h-12 shrink-0 px-lg"><Icon name="done_all" /> Nộp bài</Button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

// Bài đọc in nhãn đoạn (A, B, C...) trên một dòng riêng. Trên màn hình hẹp,
// tách nó thành một nhãn nổi bật giúp đối chiếu nhanh với câu hỏi matching;
// văn bản không theo định dạng đó (sách PDF tự nhập) thì giữ nguyên.
function PassageText({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return (
    <div className="space-y-md break-words text-[16px] leading-[1.75] text-on-surface dark:text-white/85">
      {blocks.map((block, index) => {
        const match = block.match(/^([A-Z])\n([\s\S]*)$/);
        if (!match) return <p key={index} className="whitespace-pre-wrap">{block}</p>;
        return (
          <div key={index}>
            <span className="mb-xs inline-flex h-7 min-w-7 items-center justify-center rounded-lg bg-primary px-sm text-sm font-bold text-white">{match[1]}</span>
            <p className="whitespace-pre-wrap">{match[2]}</p>
          </div>
        );
      })}
    </div>
  );
}

const LABELLED_LINE = /^((?:x{0,3})(?:ix|iv|v?i{0,3})|[A-L])\t(.+)$/;

function parseLabelledList(instruction: string) {
  return instruction
    .split("\n")
    .map((line) => line.match(LABELLED_LINE))
    .filter((match): match is RegExpMatchArray => Boolean(match && match[1]))
    .map((match) => ({ label: match[1], text: match[2].trim() }));
}

// Lời dẫn của đề in danh sách heading dạng "iii<TAB>Nội dung". Trên điện thoại
// tab chỉ còn là một khoảng trắng, nhãn và nội dung dính vào nhau; tách thành
// từng hàng có nhãn đậm cho dễ quét mắt.
function InstructionText({ text }: { text: string }) {
  return (
    <div className="mb-sm mt-lg rounded-xl bg-primary-fixed px-md py-sm text-sm font-medium leading-6 text-primary dark:bg-primary/20 dark:text-[#c9c5ff]">
      {text.split("\n").map((line, index) => {
        const match = line.match(LABELLED_LINE);
        if (match && match[1]) {
          return (
            <div key={index} className="flex gap-sm border-t border-primary/10 py-xs first:border-t-0">
              <span className="w-8 shrink-0 font-bold">{match[1]}</span>
              <span className="text-on-surface dark:text-white/85">{match[2]}</span>
            </div>
          );
        }
        return line.trim() ? <p key={index}>{line}</p> : <div key={index} className="h-sm" />;
      })}
    </div>
  );
}

function MobileQuestionBlock({
  question,
  labels,
  value,
  submitted,
  flagged,
  showInstruction,
  onChange,
  onToggleFlag,
}: {
  question: ReadingQuestion;
  value: string;
  submitted: boolean;
  flagged: boolean;
  showInstruction?: boolean;
  labels?: Record<string, string>;
  onChange: (value: string) => void;
  onToggleFlag: () => void;
}) {
  const correct = submitted && question.answer ? isAnswerCorrect(value, question.answer) : false;
  const chosenLabel = value ? labels?.[value] : undefined;
  const fixedChoices = CHOICE_SETS[question.type];
  // Phương án dài (trắc nghiệm A/B/C/D có nội dung) thì mỗi phương án là một
  // hàng bấm được cả bề ngang; nhãn ngắn (i, ii, A, B...) thì xếp lưới.
  const longOptions = !fixedChoices && Boolean(question.options?.some((option) => option.length > 4));
  const shortChoices = fixedChoices ?? (!longOptions && question.options?.length ? question.options.map((option) => option.split(" ")[0]) : null);

  const choiceClass = (choice: string) =>
    `rounded-xl border-2 font-bold transition active:scale-95 disabled:active:scale-100 ${
      value === choice ? "border-primary bg-primary text-white" : "border-surface-variant bg-white dark:border-white/15 dark:bg-[#202324]"
    }`;

  return (
    <>
      {showInstruction && question.instruction ? <InstructionText text={question.instruction} /> : null}
      <div
        className={`mb-md rounded-2xl border-2 bg-white p-md transition dark:bg-[#242728] ${
          submitted
            ? question.answer
              ? correct
                ? "border-green-500 bg-green-50 dark:bg-green-500/10"
                : "border-red-400 bg-red-50 dark:bg-red-500/10"
              : "border-surface-variant opacity-70 dark:border-white/10"
            : flagged
              ? "border-amber-400"
              : "border-transparent shadow-level-1"
        }`}
      >
        <div className="mb-sm flex items-start gap-sm">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
            {question.number}
          </span>
          <p className="flex-1 text-[16px] leading-6">{question.prompt}</p>
          {!submitted ? (
            <button
              type="button"
              onClick={onToggleFlag}
              aria-label="Đánh dấu để xem lại"
              className={`-mr-sm -mt-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${flagged ? "text-amber-500" : "text-on-surface-variant"}`}
            >
              <Icon name="flag" filled={flagged} />
            </button>
          ) : null}
        </div>

        {longOptions ? (
          <div className="flex flex-col gap-sm">
            {question.options!.map((option) => {
              const choice = option.split(" ")[0];
              return (
                <button key={option} type="button" disabled={submitted} onClick={() => onChange(value === choice ? "" : choice)} className={`${choiceClass(choice)} min-h-12 px-md py-sm text-left text-[15px] font-semibold leading-6`}>
                  {option}
                </button>
              );
            })}
          </div>
        ) : shortChoices ? (
          <div className={`grid gap-sm ${shortChoices.length <= 3 ? "grid-cols-3" : shortChoices.length === 4 ? "grid-cols-4" : "grid-cols-5"}`}>
            {shortChoices.map((choice) => (
              <button key={choice} type="button" disabled={submitted} onClick={() => onChange(value === choice ? "" : choice)} className={`${choiceClass(choice)} min-h-12 px-xs text-sm`}>
                {choice}
              </button>
            ))}
          </div>
        ) : (
          <Input
            value={value}
            disabled={submitted}
            placeholder="Nhập câu trả lời..."
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            enterKeyHint="done"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-12 text-base"
          />
        )}

        {chosenLabel && shortChoices && !fixedChoices ? (
          <p className="mt-sm rounded-lg bg-surface-container-low px-sm py-xs text-sm leading-5 text-on-surface-variant dark:bg-white/5 dark:text-white/70">
            <span className="font-bold text-primary dark:text-[#c9c5ff]">{value}</span> · {chosenLabel}
          </p>
        ) : null}

        {submitted ? (
          <p className="mt-sm text-sm">
            {question.answer ? (
              <>
                <span className="text-on-surface-variant dark:text-white/60">Đáp án: </span>
                <span className="font-bold">{question.answer}</span>
                {!correct && value ? <span className="text-on-surface-variant dark:text-white/60"> · bạn chọn: {value}</span> : null}
              </>
            ) : (
              <span className="text-on-surface-variant">Không có đáp án cho câu này — không tính điểm.</span>
            )}
          </p>
        ) : null}

        {submitted && question.answer && !correct && question.explanation ? (
          <div className="mt-sm rounded-xl bg-surface-container-low p-md text-sm leading-6 dark:bg-white/5">
            <p className="mb-xs font-semibold text-primary dark:text-[#c9c5ff]">Vì sao?</p>
            <p className="whitespace-pre-line text-on-surface-variant dark:text-white/75">{question.explanation}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
