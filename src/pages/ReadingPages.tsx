import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, EmptyState, Icon, Input, PageTitle, ProgressBar } from "../components/ui";
import { ReadingApi } from "../hooks/useReadingData";
import { LifeManagementConfig, ReadingAttempt, ReadingPassage, ReadingQuestion } from "../types/reading";
import { ParsedBookPreview, isAnswerCorrect, parseReadingBook } from "../utils/readingPdf";
import { VerifiedApplyReport, applyUploadedAnswerKey, applyVerifiedAnswers } from "../utils/verifiedAnswers";
import { parseAnswerKeyFile } from "../utils/answerKeyFile";
import { extractPdfLines } from "../utils/readingPdfExtract";
import { syncBookToLifeManagement } from "../utils/lifeManagementSync";
import { toDateKey } from "../utils/readingStorage";

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

/** IELTS Academic Reading raw-score to band, the standard published table. */
function bandFor(correct: number, total: number): string {
  if (!total) return "–";
  const scaled = Math.round((correct / total) * 40);
  const table: Array<[number, string]> = [
    [39, "9.0"], [37, "8.5"], [35, "8.0"], [33, "7.5"], [30, "7.0"], [27, "6.5"],
    [23, "6.0"], [19, "5.5"], [15, "5.0"], [13, "4.5"], [10, "4.0"], [8, "3.5"], [6, "3.0"],
  ];
  for (const [threshold, band] of table) if (scaled >= threshold) return band;
  return "2.5";
}

function formatClock(seconds: number) {
  const m = Math.floor(Math.abs(seconds) / 60);
  const s = Math.abs(seconds) % 60;
  return `${seconds < 0 ? "-" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- Library --

export function ReadingLibraryPage({ api }: { api: ReadingApi }) {
  const navigate = useNavigate();
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { books, attempts, lifeManagement } = api.data;
  const { stats } = api;

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

  const maxDaily = Math.max(1, ...stats.daily.map((d) => d.count));

  return (
    <>
      <PageTitle
        title="IELTS Reading"
        subtitle="Tải lên một cuốn sách PDF, hệ thống tự tách bài đọc và đáp án, rồi luyện như thi thật."
        action={
          <div className="flex gap-sm">
            <Button variant="secondary" onClick={() => setShowSettings(true)}>
              <Icon name="sync" /> Đồng bộ
            </Button>
            <Button onClick={() => setShowImport(true)}>
              <Icon name="upload_file" /> Thêm sách PDF
            </Button>
          </div>
        }
      />

      <div className="mb-lg grid grid-cols-2 gap-md lg:grid-cols-4">
        <StatTile label="Hôm nay" value={stats.todayCount} suffix="bài" accent />
        <StatTile label="Tuần này" value={stats.weekCount} suffix="bài" />
        <StatTile label="Tháng này" value={stats.monthCount} suffix="bài" />
        <StatTile label="Độ chính xác" value={stats.overallAccuracy} suffix="%" />
      </div>

      <Card className="mb-lg">
        <div className="mb-md flex items-center justify-between">
          <h2 className="font-headline-md text-lg font-bold">14 ngày gần nhất</h2>
          <span className="text-sm text-on-surface-variant">Tổng {stats.totalCount} lượt làm bài</span>
        </div>
        <div className="flex h-24 items-end gap-1">
          {stats.daily.map((day) => (
            <div key={day.dateKey} className="flex flex-1 flex-col items-center gap-1" title={`${day.dateKey}: ${day.count} bài`}>
              <div
                className={`w-full rounded-t ${day.count ? "bg-primary" : "bg-surface-variant dark:bg-white/10"}`}
                style={{ height: `${Math.max(4, (day.count / maxDaily) * 72)}px` }}
              />
              <span className="text-[10px] text-on-surface-variant">{day.dateKey.slice(8)}</span>
            </div>
          ))}
        </div>
      </Card>

      {!books.length ? (
        <EmptyState
          title="Chưa có sách nào"
          text="Tải lên một file PDF đã OCR. Hệ thống sẽ tự nhận diện từng Reading Passage, bộ câu hỏi và bảng đáp án ở cuối sách."
          action={<Button onClick={() => setShowImport(true)}><Icon name="upload_file" /> Thêm sách PDF</Button>}
        />
      ) : (
        <div className="flex flex-col gap-lg">
          {books.map((book) => (
            <Card key={book.id}>
              <div className="mb-md flex flex-wrap items-start justify-between gap-sm">
                <div>
                  <h2 className="font-headline-md text-lg font-bold">{book.title}</h2>
                  <p className="text-sm text-on-surface-variant">
                    {book.passages.length} bài đọc · {book.sourceFileName}
                    {book.lifeManagementTaskId ? " · đã đồng bộ Life Management" : ""}
                  </p>
                </div>
                <Button variant="danger" onClick={() => { if (confirm(`Xoá "${book.title}" và toàn bộ kết quả của sách này?`)) api.deleteBook(book.id); }}>
                  <Icon name="delete" /> Xoá
                </Button>
              </div>
              <div className="grid gap-sm md:grid-cols-2">
                {book.passages.map((passage) => {
                  const best = bestByPassage.get(passage.id);
                  return (
                    <button
                      key={passage.id}
                      onClick={() => navigate(`/reading/${book.id}/${passage.id}`)}
                      className="flex items-center justify-between gap-md rounded-xl border border-surface-variant p-md text-left transition hover:border-primary dark:border-white/10"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{passage.title}</p>
                        <p className="text-sm text-on-surface-variant">{passage.questions.length} câu hỏi</p>
                      </div>
                      {best ? (
                        <span className="shrink-0 rounded-lg bg-primary-fixed px-sm py-xs text-sm font-bold text-primary dark:bg-primary/25 dark:text-white">
                          {best.correct}/{best.total}
                        </span>
                      ) : (
                        <Icon name="play_arrow" className="shrink-0 text-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {showImport ? <ImportDialog api={api} onClose={() => setShowImport(false)} /> : null}
      {showSettings ? (
        <SyncSettingsDialog
          config={lifeManagement}
          onSave={(config) => { api.setLifeManagement(config); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
    </>
  );
}

function StatTile({ label, value, suffix, accent }: { label: string; value: number; suffix: string; accent?: boolean }) {
  return (
    <Card className={accent ? "border-primary" : ""}>
      <p className="text-sm text-on-surface-variant">{label}</p>
      <p className="mt-xs text-3xl font-bold">
        {value}
        <span className="ml-1 text-base font-semibold text-on-surface-variant">{suffix}</span>
      </p>
    </Card>
  );
}

// ----------------------------------------------------------------- Import --

function ImportDialog({ api, onClose }: { api: ReadingApi; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ParsedBookPreview | null>(null);
  const [verified, setVerified] = useState<VerifiedApplyReport | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [answerKeyReport, setAnswerKeyReport] = useState<VerifiedApplyReport | null>(null);
  const [answerKeyError, setAnswerKeyError] = useState("");
  const [answerKeyBusy, setAnswerKeyBusy] = useState(false);
  const answerKeyFileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError("");
    setPreview(null);
    setVerified(null);
    setAnswerKeyReport(null);
    setAnswerKeyError("");
    try {
      setStatus("Đang đọc PDF...");
      const lines = await extractPdfLines(file, (page, total) => setStatus(`Đang đọc trang ${page}/${total}...`));
      setStatus("Đang nhận diện bài đọc và đáp án...");
      const parsed = parseReadingBook(lines, file.name, title);
      // Nếu có bảng đáp án đã kiểm chứng cho cuốn này thì nó thắng đáp án OCR
      // đoán được — xem src/data/answerKeys.ts.
      setVerified(applyVerifiedAnswers(parsed.book));
      parsed.report = parsed.book.passages.map((passage) => ({
        passageTitle: passage.title,
        questionCount: passage.questions.length,
        answeredCount: passage.questions.filter((question) => question.answer).length,
        wordCount: passage.text.split(/\s+/).filter(Boolean).length,
      }));
      if (!parsed.book.passages.length) {
        setError("Không tìm thấy bài đọc nào. File cần có tiêu đề dạng 'READING PASSAGE 1' và phần 'Answer key' ở cuối sách.");
      }
      setPreview(parsed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không đọc được file PDF này.");
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  // Trước đây, thêm lại một sách không hề hỏi xin file đáp án — nên đáp án
  // OCR đoán được (hay sai, hay trống) không có cách nào được thay thế trừ
  // khi cuốn sách đã có mặt trong data/answerKeys.ts (chỉ đúng một cuốn).
  // File đáp án dùng đúng khuôn cột PROMPT_ANSWER_KEY.txt / answer_key_to_
  // excel.py đã sinh ra ở D:\project\OCR_image_to_pdf: group | passage |
  // question | answer.
  const handleAnswerKeyFile = async (file: File) => {
    if (!preview) return;
    setAnswerKeyBusy(true);
    setAnswerKeyError("");
    try {
      const { rows, unknownColumns } = await parseAnswerKeyFile(file);
      if (!rows.length) {
        setAnswerKeyError(
          unknownColumns.length
            ? `Không đọc được cột nào khớp. File cần có cột group/passage/question/answer, đang thấy: ${unknownColumns.join(", ")}.`
            : "File rỗng hoặc không đúng khuôn cột (group | passage | question | answer).",
        );
        return;
      }
      const report = applyUploadedAnswerKey(preview.book, rows);
      setAnswerKeyReport(report);
      setPreview({
        ...preview,
        report: preview.book.passages.map((passage) => ({
          passageTitle: passage.title,
          questionCount: passage.questions.length,
          answeredCount: passage.questions.filter((question) => question.answer).length,
          wordCount: passage.text.split(/\s+/).filter(Boolean).length,
        })),
      });
    } catch (caught) {
      setAnswerKeyError(caught instanceof Error ? caught.message : "Không đọc được file này.");
    } finally {
      setAnswerKeyBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    const book = { ...preview.book, title: title.trim() || preview.book.title };
    api.addBook(book);

    const config = api.data.lifeManagement;
    if (config.enabled && config.baseUrl.trim()) {
      setBusy(true);
      setStatus("Đang tạo node bên Life Management...");
      try {
        const outcome = await syncBookToLifeManagement(config, book);
        api.markBookSynced(book.id, outcome.bookTaskId);
      } catch (caught) {
        // The book itself is already saved, so a sync failure is a warning,
        // never a reason to discard the import.
        alert(`Đã lưu sách, nhưng chưa đồng bộ được sang Life Management:\n${caught instanceof Error ? caught.message : caught}`);
      } finally {
        setBusy(false);
        setStatus("");
      }
    }
    onClose();
  };

  return (
    <Dialog title="Thêm sách PDF" onClose={onClose}>
      <label className="mb-sm block text-sm font-semibold">Tên sách</label>
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="VD: Cambridge IELTS 18" />

      <div className="mt-md">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); }}
        />
        <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()} className="w-full">
          <Icon name="upload_file" /> Chọn file PDF
        </Button>
      </div>

      {status ? <p className="mt-md text-sm text-on-surface-variant">{status}</p> : null}
      {error ? <p className="mt-md rounded-xl bg-error-container p-md text-sm text-red-900">{error}</p> : null}

      {preview && preview.book.passages.length ? (
        <div className="mt-md">
          <p className="mb-sm text-sm font-semibold">
            Nhận diện được {preview.book.passages.length} bài đọc
            {verified
              ? ` · ${verified.filledAnswers} đáp án lấy từ bảng đã kiểm chứng`
              : ` · ${preview.answerPairsFound} đáp án dò từ bảng key trong PDF`}
          </p>
          {verified ? (
            <p className="mb-sm text-xs text-on-surface-variant">
              Đáp án của "{verified.bookTitle}" được chép tay và đối chiếu độc lập, không dùng OCR —
              khớp {verified.matchedPassages}/{preview.book.passages.length} bài đọc.
              {verified.unmatchedPassages.length
                ? ` ${verified.unmatchedPassages.length} bài chưa khớp tên nên giữ đáp án dò tự động.`
                : ""}
            </p>
          ) : null}
          <div className="max-h-64 overflow-y-auto rounded-xl border border-surface-variant dark:border-white/10">
            {preview.report.map((row, index) => (
              <div key={index} className="flex items-center justify-between gap-md border-b border-surface-variant px-md py-sm last:border-b-0 dark:border-white/10">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.passageTitle}</p>
                  <p className="text-xs text-on-surface-variant">{row.wordCount} từ</p>
                </div>
                <span className={`shrink-0 text-sm font-semibold ${row.answeredCount === row.questionCount ? "text-green-600" : "text-amber-600"}`}>
                  {row.answeredCount}/{row.questionCount} đáp án
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {preview && preview.book.passages.length ? (
        <div className="mt-md rounded-xl border border-dashed border-surface-variant p-md dark:border-white/15">
          {(() => {
            const missing = preview.report.reduce((sum, row) => sum + (row.questionCount - row.answeredCount), 0);
            return (
              <p className="mb-sm text-sm font-semibold">
                {missing > 0 ? `Còn thiếu ${missing} đáp án` : "Đã đủ đáp án"} — tải file Excel/CSV đáp án để điền hoặc ghi đè
              </p>
            );
          })()}
          <p className="mb-sm text-xs text-on-surface-variant">
            Cột: group (VD "Day 1", để trống nếu không có) · passage (đúng/gần đúng tên bài) · question (số câu) · answer.
            Đúng khuôn file mà tools/answer_key_to_excel.py ở D:\project\OCR_image_to_pdf sinh ra.
          </p>
          <input
            ref={answerKeyFileRef}
            type="file"
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            className="hidden"
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleAnswerKeyFile(file); if (answerKeyFileRef.current) answerKeyFileRef.current.value = ""; }}
          />
          <Button variant="secondary" disabled={answerKeyBusy} onClick={() => answerKeyFileRef.current?.click()} className="w-full">
            <Icon name="table_view" /> Chọn file đáp án Excel/CSV
          </Button>
          {answerKeyError ? <p className="mt-sm text-xs text-red-700">{answerKeyError}</p> : null}
          {answerKeyReport ? (
            <p className="mt-sm text-xs text-on-surface-variant">
              Đã điền {answerKeyReport.filledAnswers} đáp án, khớp {answerKeyReport.matchedPassages}/{preview.book.passages.length} bài đọc.
              {answerKeyReport.unmatchedPassages.length ? ` Chưa khớp: ${answerKeyReport.unmatchedPassages.join(", ")}.` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-lg flex justify-end gap-sm">
        <Button variant="ghost" onClick={onClose}>Huỷ</Button>
        <Button disabled={!preview?.book.passages.length || busy} onClick={() => void confirmImport()}>
          <Icon name="check" /> Thêm sách
        </Button>
      </div>
    </Dialog>
  );
}

function SyncSettingsDialog({
  config,
  onSave,
  onClose,
}: {
  config: LifeManagementConfig;
  onSave: (config: LifeManagementConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config);
  const field = (key: keyof LifeManagementConfig, label: string, placeholder = "") => (
    <div className="mb-md">
      <label className="mb-xs block text-sm font-semibold">{label}</label>
      <Input value={String(draft[key])} placeholder={placeholder} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
    </div>
  );

  return (
    <Dialog title="Đồng bộ Life Management" onClose={onClose}>
      <p className="mb-md text-sm text-on-surface-variant">
        Khi thêm một sách mới, hệ thống tạo một node tên sách nằm dưới READING, và mỗi bài đọc là một task con.
      </p>
      <label className="mb-md flex items-center gap-sm text-sm font-semibold">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
        Bật tự động đồng bộ
      </label>
      {field("baseUrl", "Địa chỉ Life Management", "https://your-life-management.vercel.app")}
      {field("userId", "User ID")}
      {field("topicId", "Topic ID (English)")}
      {field("readingTaskId", "Task ID của node READING")}
      <div className="mt-lg flex justify-end gap-sm">
        <Button variant="ghost" onClick={onClose}>Huỷ</Button>
        <Button onClick={() => onSave(draft)}><Icon name="check" /> Lưu</Button>
      </div>
    </Dialog>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-lg shadow-level-2 dark:bg-[#232627]" onClick={(event) => event.stopPropagation()}>
        <div className="mb-md flex items-center justify-between">
          <h2 className="font-headline-md text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface"><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Test screen --

export function ReadingTestPage({ api }: { api: ReadingApi }) {
  const { bookId, passageId } = useParams<{ bookId: string; passageId: string }>();
  const navigate = useNavigate();
  const book = api.data.books.find((item) => item.id === bookId);
  const passage = book?.passages.find((item) => item.id === passageId);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt] = useState(() => new Date().toISOString());
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const savedRef = useRef(false);

  useEffect(() => {
    if (submitted) return;
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [submitted]);

  const scorable = useMemo(() => passage?.questions.filter((q) => q.answer) ?? [], [passage]);
  const correctCount = useMemo(
    () => scorable.filter((q) => isAnswerCorrect(answers[q.id] ?? "", q.answer)).length,
    [scorable, answers],
  );

  if (!book || !passage) {
    return <EmptyState title="Không tìm thấy bài đọc" text="Bài đọc này có thể đã bị xoá." action={<Button onClick={() => navigate("/reading")}>Về thư viện</Button>} />;
  }

  const answeredCount = passage.questions.filter((q) => (answers[q.id] ?? "").trim()).length;

  const submit = () => {
    if (savedRef.current) return;
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

  return (
    <div className="-mx-container-margin -mt-lg md:-mx-xl md:-mt-xl">
      {/* Exam chrome: fixed bar with the clock and progress, like the real test. */}
      <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-sm border-b border-surface-variant bg-surface-bright px-md py-sm dark:border-white/10 dark:bg-[#202324]">
        <div className="min-w-0">
          <p className="truncate font-semibold">{passage.title}</p>
          <p className="text-xs text-on-surface-variant">{book.title}</p>
        </div>
        <div className="flex items-center gap-md">
          <div className="text-right">
            <p className="font-mono text-lg font-bold tabular-nums">{formatClock(elapsed)}</p>
            <p className="text-xs text-on-surface-variant">{answeredCount}/{passage.questions.length} đã trả lời</p>
          </div>
          {submitted ? (
            <Button variant="secondary" onClick={() => navigate("/reading")}><Icon name="arrow_back" /> Thư viện</Button>
          ) : (
            <Button onClick={submit}><Icon name="done_all" /> Nộp bài</Button>
          )}
        </div>
      </div>

      {submitted ? (
        <div className="border-b border-surface-variant bg-primary-fixed px-md py-md dark:border-white/10 dark:bg-primary/20">
          <div className="flex flex-wrap items-center gap-lg">
            <div>
              <p className="text-sm text-on-surface-variant">Kết quả</p>
              <p className="text-2xl font-bold">{correctCount}/{scorable.length} câu đúng</p>
            </div>
            <div>
              <p className="text-sm text-on-surface-variant">Band ước tính</p>
              <p className="text-2xl font-bold">{bandFor(correctCount, scorable.length)}</p>
            </div>
            <div>
              <p className="text-sm text-on-surface-variant">Thời gian</p>
              <p className="text-2xl font-bold tabular-nums">{formatClock(elapsed)}</p>
            </div>
            <div className="min-w-40 flex-1">
              <ProgressBar value={scorable.length ? (correctCount / scorable.length) * 100 : 0} />
            </div>
          </div>
        </div>
      ) : null}

      {/* Split view: passage on the left, questions on the right — each pane
          scrolls on its own so the text stays put while answering, exactly how
          the computer-delivered IELTS test behaves. */}
      <div className="grid gap-0 lg:h-[calc(100vh-8rem)] lg:grid-cols-2">
        <article className="overflow-y-auto border-surface-variant px-md py-lg dark:border-white/10 lg:border-r">
          <h2 className="mb-md font-headline-md text-xl font-bold">{passage.title}</h2>
          <div className="prose-reading whitespace-pre-wrap text-[15px] leading-7 text-on-surface dark:text-white/85">
            {passage.text}
          </div>
        </article>

        <section className="overflow-y-auto px-md py-lg">
          {passage.questions.map((question, index) => (
            <QuestionBlock
              key={question.id}
              question={question}
              // Rubric chỉ in MỘT lần cho cả nhóm câu cùng dạng, đúng như đề
              // thật in "Questions 1-5" rồi mới tới hướng dẫn.
              showInstruction={Boolean(question.instruction) && question.instruction !== passage.questions[index - 1]?.instruction}
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
          {!submitted ? (
            <Button onClick={submit} className="mt-lg w-full"><Icon name="done_all" /> Nộp bài</Button>
          ) : (
            <Button variant="secondary" onClick={() => navigate("/reading")} className="mt-lg w-full">
              <Icon name="arrow_back" /> Về thư viện
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}

const CHOICE_SETS: Partial<Record<ReadingQuestion["type"], string[]>> = {
  tfng: ["TRUE", "FALSE", "NOT GIVEN"],
  ynng: ["YES", "NO", "NOT GIVEN"],
};

function QuestionBlock({
  question,
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
  onChange: (value: string) => void;
  onToggleFlag: () => void;
}) {
  const correct = submitted && question.answer ? isAnswerCorrect(value, question.answer) : false;
  const choices = CHOICE_SETS[question.type] ?? (question.options?.length ? question.options.map((option) => option.split(" ")[0]) : null);

  return (
    <>
    {showInstruction ? (
      <p className="mb-sm mt-lg whitespace-pre-line rounded-xl bg-primary-fixed px-md py-sm text-sm font-medium leading-6 text-primary dark:bg-primary/20 dark:text-[#c9c5ff]">
        {question.instruction}
      </p>
    ) : null}
    <div
      className={`mb-md rounded-xl border p-md transition ${
        submitted
          ? question.answer
            ? correct
              ? "border-green-500 bg-green-50 dark:bg-green-500/10"
              : "border-red-400 bg-red-50 dark:bg-red-500/10"
            : "border-surface-variant opacity-70 dark:border-white/10"
          : flagged
            ? "border-amber-400"
            : "border-surface-variant dark:border-white/10"
      }`}
    >
      <div className="mb-sm flex items-start gap-sm">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
          {question.number}
        </span>
        <p className="flex-1 text-[15px] leading-6">{question.prompt}</p>
        {!submitted ? (
          <button onClick={onToggleFlag} title="Đánh dấu để xem lại" className={flagged ? "text-amber-500" : "text-on-surface-variant"}>
            <Icon name="flag" filled={flagged} />
          </button>
        ) : null}
      </div>

      {/* Chỉ in danh sách phương án khi chúng thực sự là nội dung. Với matching
          headings / sentence endings, toàn bộ danh sách đã nằm trong lời dẫn in
          một lần cho cả nhóm (đúng như đề thật), nên ở đây options chỉ còn là
          nhãn i, ii, A, B... — in lại dưới từng câu chỉ tổ rối mắt. */}
      {question.options?.length && question.options.some((option) => option.length > 4) ? (
        <ul className="mb-sm ml-8 space-y-1 text-sm text-on-surface-variant">
          {question.options.map((option, index) => <li key={index}>{option}</li>)}
        </ul>
      ) : null}

      <div className="ml-8">
        {choices ? (
          <div className="flex flex-wrap gap-xs">
            {choices.map((choice) => (
              <button
                key={choice}
                disabled={submitted}
                onClick={() => onChange(value === choice ? "" : choice)}
                className={`rounded-lg border px-md py-xs text-sm font-semibold transition disabled:cursor-not-allowed ${
                  value === choice
                    ? "border-primary bg-primary text-white"
                    : "border-surface-variant hover:border-primary dark:border-white/15"
                }`}
              >
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
          />
        )}
      </div>

      {submitted ? (
        <p className="ml-8 mt-sm text-sm">
          {question.answer ? (
            <>
              <span className="text-on-surface-variant">Đáp án: </span>
              <span className="font-semibold">{question.answer}</span>
              {!correct && value ? <span className="text-on-surface-variant"> · bạn chọn: {value}</span> : null}
            </>
          ) : (
            <span className="text-on-surface-variant">Không tìm thấy đáp án cho câu này trong sách — không tính điểm.</span>
          )}
        </p>
      ) : null}
    </div>
    </>
  );
}

export type { ReadingPassage };
