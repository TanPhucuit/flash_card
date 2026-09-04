// Types for the IELTS Reading practice feature: a PDF book is parsed into
// passages, each passage carries its own question set, and every sitting is
// recorded as an attempt so daily/weekly volume can be reported.

// The question shapes an IELTS reading paper actually uses. `gap` covers
// sentence/summary/table completion (all "write a word from the passage"),
// `short` covers short-answer questions. They score identically but are kept
// apart so the UI can label them the way the exam does.
export type ReadingQuestionType = "tfng" | "ynng" | "mcq" | "gap" | "short" | "matching";

export interface ReadingQuestion {
  id: string;
  /** Question number as printed in the book — the key answers are matched on. */
  number: number;
  type: ReadingQuestionType;
  /**
   * Rubric shown above the group this question belongs to, in the wording the
   * exam itself uses ("Choose NO MORE THAN TWO WORDS from the passage...").
   * Consecutive questions sharing the same text form one group and the rubric
   * is printed once, the way a real paper prints it.
   */
  instruction?: string;
  prompt: string;
  /** Present for `mcq` and `matching`; the letters/labels the taker picks from. */
  options?: string[];
  /**
   * The correct answer from the book's key. Empty string means the key had no
   * entry for this number — the question is then shown but excluded from
   * scoring rather than silently marked wrong.
   */
  answer: string;
  /**
   * Giải thích bằng tiếng Việt: vì sao đáp án đúng là đáp án đó, dựa vào chỗ
   * nào trong bài. Chỉ hiện SAU KHI nộp bài và CHỈ với câu trả lời sai — hiện
   * sớm thì thành lộ đáp án, hiện cả ở câu đúng thì làm loãng đúng chỗ người
   * học cần đọc kỹ.
   */
  explanation?: string;
}

export interface ReadingPassage {
  id: string;
  order: number;
  title: string;
  /** Full passage body, paragraphs separated by blank lines. */
  text: string;
  questions: ReadingQuestion[];
  /** Id task tương ứng bên Life Management (node CON của node sách). */
  lifeManagementTaskId?: string;
}

export interface ReadingBook {
  id: string;
  title: string;
  sourceFileName: string;
  createdAt: string;
  passages: ReadingPassage[];
  /** Task id of the book node created in Life Management, once synced. */
  lifeManagementTaskId?: string;
}

export interface ReadingAttempt {
  id: string;
  bookId: string;
  bookTitle: string;
  passageId: string;
  passageTitle: string;
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  /** Keyed by question id. */
  answers: Record<string, string>;
  correct: number;
  /** Only counts questions that had an answer in the book's key. */
  total: number;
  /** Local YYYY-MM-DD, so "today" means the user's day, not UTC's. */
  dateKey: string;
}

/**
 * Where to mirror books as task nodes. Everything but `baseUrl` is discovered
 * once and rarely changes; `baseUrl` is per-deployment so it has to be entered.
 */
export interface LifeManagementConfig {
  baseUrl: string;
  userId: string;
  topicId: string;
  /** The READING task the book nodes are attached under. */
  readingTaskId: string;
  /**
   * Task mà các node DANH SÁCH TỪ VỰNG được gắn xuống dưới. Mặc định trùng
   * với READING vì đó là chỗ người dùng vẫn đang tự đặt các node vocab.
   */
  vocabTaskId: string;
  enabled: boolean;
}

export interface ReadingData {
  books: ReadingBook[];
  attempts: ReadingAttempt[];
  lifeManagement: LifeManagementConfig;
  /**
   * Id các thư viện dựng sẵn mà người dùng đã bấm xoá. Thư viện dựng sẵn
   * KHÔNG được lưu vào localStorage nữa (xem useReadingData) — nó được tải
   * lại từ file tĩnh mỗi phiên — nên phải ghi nhớ riêng việc "đã xoá" ở đây,
   * nếu không nó sẽ tự mọc lại ngay lần mở trang kế tiếp.
   */
  hiddenLibraries?: string[];
}
