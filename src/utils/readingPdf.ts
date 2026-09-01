import { ReadingBook, ReadingPassage, ReadingQuestion, ReadingQuestionType } from "../types/reading";

// Pure text-in, structured-book-out parsing — no pdfjs/browser dependency, so
// this half of the pipeline can be exercised directly in Node/tsx against a
// captured line dump. See readingPdfExtract.ts for the PDF-to-lines half.

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const PASSAGE_HEADER = /^\s*(?:READING\s+)?PASSAGE\s+(\d+)\b/i;
const TEST_HEADER = /^\s*TEST\s+(\d+)\s*$/i;
// "Day N Practice for IELTS Reading" books restart passage numbering at 1
// under each day rather than using "Test N" — both group labels are tracked
// and whichever was seen most recently wins.
const DAY_HEADER = /^\s*Day\s+(\d+)\s*$/i;
const QUESTIONS_HEADER = /^\s*Questions?\s+(\d+)\s*[-–—]\s*(\d+)/i;
const SINGLE_QUESTION_HEADER = /^\s*Questions?\s+(\d+)\s*$/i;
const ANSWER_KEY_HEADER = /^\s*(?:ANSWER\s*KEY|ANSWERS|LISTENING\s+AND\s+READING\s+ANSWER\s+KEYS)\s*$/i;
const NUMBERED_LINE = /^\s*(\d{1,3})\s*[.)]?\s+(.*)$/;
const OPTION_LINE = /^\s*([A-J])\s*[.)]?\s+(.+)$/;

/** Instruction wording maps to the actual IELTS question format. */
function detectType(instruction: string): ReadingQuestionType {
  const text = instruction.toLowerCase();
  if (/\btrue\b[\s\S]*\bfalse\b[\s\S]*\bnot given\b/.test(text)) return "tfng";
  if (/\byes\b[\s\S]*\bno\b[\s\S]*\bnot given\b/.test(text)) return "ynng";
  if (/choose the correct letter|choose (?:one|two|three) letters?/.test(text)) return "mcq";
  if (/list of headings|which paragraph|match(?:ing)?\b|choose from the list|write the correct letter/.test(text)) return "matching";
  if (/no more than|one word only|choose (?:one|two|a) word/.test(text)) return "gap";
  if (/complete the (?:summary|sentences|notes|table|diagram|flow)/.test(text)) return "gap";
  return "short";
}

interface RawGroup {
  from: number;
  to: number;
  instruction: string;
  bodyLines: string[];
}

/** Split a passage's question region into groups, each with its own instruction. */
function splitQuestionGroups(lines: string[]): RawGroup[] {
  const groups: RawGroup[] = [];
  let current: RawGroup | null = null;

  for (const line of lines) {
    const range = line.match(QUESTIONS_HEADER);
    const single = line.match(SINGLE_QUESTION_HEADER);
    if (range || single) {
      if (current) groups.push(current);
      const from = Number(range ? range[1] : single![1]);
      const to = Number(range ? range[2] : single![1]);
      current = { from, to, instruction: "", bodyLines: [] };
      continue;
    }
    if (!current) continue;
    // Everything before the first numbered question is the instruction for the
    // group — that is what tells us whether these are TRUE/FALSE, MCQ, gaps...
    if (!current.bodyLines.length && !NUMBERED_LINE.test(line)) {
      current.instruction += ` ${line}`;
      continue;
    }
    current.bodyLines.push(line);
  }
  if (current) groups.push(current);
  return groups;
}

function buildQuestions(groups: RawGroup[]): ReadingQuestion[] {
  const questions: ReadingQuestion[] = [];

  for (const group of groups) {
    const type = detectType(group.instruction);
    let active: ReadingQuestion | null = null;
    const groupQuestions: ReadingQuestion[] = [];

    for (const line of group.bodyLines) {
      const numbered = line.match(NUMBERED_LINE);
      const number = numbered ? Number(numbered[1]) : NaN;
      // Only treat a leading number as a question number when it falls inside
      // the range this group announced. Otherwise a sentence that happens to
      // begin with a year ("1996 saw...") would spawn a phantom question.
      if (numbered && number >= group.from && number <= group.to && !questions.some((q) => q.number === number)) {
        active = { id: uid(), number, type, prompt: numbered[2].trim(), answer: "", options: type === "mcq" || type === "matching" ? [] : undefined };
        questions.push(active);
        groupQuestions.push(active);
        continue;
      }
      if (!active) continue;
      const option = line.match(OPTION_LINE);
      if (option && active.options) {
        active.options.push(`${option[1]} ${option[2].trim()}`);
        continue;
      }
      // A wrapped continuation of the current question's wording.
      if (line) active.prompt = `${active.prompt} ${line}`.trim();
    }

    // A group whose prompts are just "Paragraph A", "Paragraph B", ... is a
    // heading-matching set regardless of what detectType made of its
    // instruction line — that instruction is frequently the part of the
    // page hit hardest by OCR noise, since it is dense, multi-line prose
    // sitting right next to the paragraph-lettered list it describes.
    if (groupQuestions.length && groupQuestions.every((q) => /^paragraph\s+[a-z]\b/i.test(q.prompt))) {
      groupQuestions.forEach((q) => { q.type = "matching"; });
    }
  }

  return questions.sort((a, b) => a.number - b.number);
}

const FOOTER_NOISE = /www\.|\.com|\.org|nhantriviet|mamstation|english station/i;
// tfng/ynng/mcq/matching answers are always a short token in these books —
// TRUE/FALSE/NOT GIVEN, a single option letter, or a roman-numeral heading
// number — so anything longer is almost certainly leaked page furniture
// rather than a real answer, regardless of whether the number lined up.
const SHORT_TOKEN = /^[ivxlcdm]{1,7}[.)]?$|^[a-z]{1,2}[.)]?$/i;

function isPlausibleAnswer(type: ReadingQuestionType, answer: string, passageText: string): boolean {
  const trimmed = answer.trim();
  if (FOOTER_NOISE.test(trimmed)) return false;
  if (trimmed.length > 60) return false;
  if (type === "tfng") return /^(true|false|not given|t|f|ng)$/i.test(trimmed);
  if (type === "ynng") return /^(yes|no|not given|y|n|ng)$/i.test(trimmed);
  if (type === "mcq" || type === "matching") return SHORT_TOKEN.test(trimmed);
  // gap/short answers are, by the exam's own rules, words lifted verbatim
  // from the passage ("NO MORE THAN THREE WORDS FROM THE PASSAGE"). A single
  // short token ("50%", a number, one word) is left unchecked since minor
  // OCR noise on the passage side can make a legitimate one fail to match
  // exactly; anything with more than one word gets checked, because a multi-
  // word phrase that never appears in the passage at all is almost always
  // page furniture that happened to land on the same key row as a real
  // answer — like a stray book-title fragment — not a genuine one.
  const isShortSingleToken = !/\s/.test(trimmed) && trimmed.length <= 15;
  if (isShortSingleToken) return true;
  const normalise = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  return normalise(passageText).includes(normalise(trimmed));
}

interface AnswerPair {
  number: number;
  answer: string;
}

/**
 * Read every "<number> <answer>" pair out of the key, in the order printed.
 * Answers are matched to questions by number within a bounded look-ahead
 * window (see the assignment loop below) rather than by any "Day N"/"Test N"
 * grouping — that was tried and measured worse, since those same headings
 * are themselves corrupted by running-header OCR noise on scanned books.
 */
function parseAnswerPairs(lines: string[]): AnswerPair[] {
  const pairs: AnswerPair[] = [];
  // Matches "1 TRUE", "12 B", "3 not given", and several packed onto one line
  // from a multi-column key table. The answer body is "any character, non-
  // greedy" rather than "no digits" — a numeric-looking answer like "24-hour"
  // or "50%" must not get truncated at its own first digit. The lookahead
  // only stops at a *space* followed by the next "number + letter" pair, so a
  // digit glued directly onto the current answer (no separating space) is
  // never mistaken for the start of the next entry.
  const packed = /(\d{1,3})\s*[.)]?\s+([A-Za-z0-9][\s\S]{0,60}?)(?=\s+\d{1,3}\s*[.)]?\s+[A-Za-z]|$)/g;
  const LONE_NUMBER = /^\s*(\d{1,3})\s*[.)]?\s*$/;

  // A multi-column key table sometimes wraps one entry's answer onto its own
  // row below the number ("8." on one line, "international agreements" on
  // the next) — a by-product of that row also holding other columns' text
  // that pushed this cell's wording down. A lone number has nothing to match
  // against on its own row, so splice the next row's text onto it first.
  const merged: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lone = lines[i]?.match(LONE_NUMBER);
    const next = lines[i + 1];
    if (lone && next && !LONE_NUMBER.test(next) && !ANSWER_KEY_HEADER.test(next)) {
      merged.push(`${lone[1]}. ${next}`);
      i += 1;
    } else {
      merged.push(lines[i]);
    }
  }

  for (const rawLine of merged) {
    if (!rawLine || ANSWER_KEY_HEADER.test(rawLine)) continue;
    // Two very common OCR misreads in this position: a capital "I" or "O"
    // immediately before a digit almost always means "1" or "0" — e.g. "I1"
    // for the question number "11". Real roman-numeral answers in these books
    // are always lowercase ("i", "vii"), so this narrow, digit-anchored swap
    // cannot clobber them.
    const line = rawLine.replace(/\bI(?=\d)/g, "1").replace(/\bO(?=\d)/g, "0");
    packed.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = packed.exec(line))) {
      const answer = match[2].trim().replace(/\s+/g, " ");
      if (!answer) continue;
      pairs.push({ number: Number(match[1]), answer });
    }
  }
  return pairs;
}

export interface ParsedBookPreview {
  book: ReadingBook;
  /** Per-passage diagnostics so the user can see what was and wasn't detected. */
  report: Array<{ passageTitle: string; questionCount: number; answeredCount: number; wordCount: number }>;
  answerPairsFound: number;
}

export function parseReadingBook(lines: string[], fileName: string, bookTitle: string): ParsedBookPreview {
  // Only search the last 40% of the book — a contents-page entry reading
  // "Answer key ......... 214" earlier on would otherwise win and swallow the
  // entire book as if it were the key. Within that window, take the FIRST
  // match rather than the last: books with one test per "day" repeat an
  // "Answer Key" heading once per day, all clustered together near the very
  // end, and every one of those blocks holds real answers that must be kept —
  // stopping at the last heading would silently discard every earlier block.
  const searchFloor = Math.floor(lines.length * 0.6);
  let keyStart = -1;
  for (let i = searchFloor; i < lines.length; i += 1) {
    if (ANSWER_KEY_HEADER.test(lines[i])) {
      keyStart = i;
      break;
    }
  }

  const bodyLines = keyStart >= 0 ? lines.slice(0, keyStart) : lines;
  const keyLines = keyStart >= 0 ? lines.slice(keyStart) : [];
  const answerPairs = parseAnswerPairs(keyLines);

  // Slice the body at each passage header.
  const starts: Array<{ index: number; passageNumber: number; testLabel: string }> = [];
  let testLabel = "";
  bodyLines.forEach((line, index) => {
    const test = line.match(TEST_HEADER);
    if (test) testLabel = `Test ${test[1]}`;
    const day = line.match(DAY_HEADER);
    if (day) testLabel = `Day ${day[1]}`;
    const header = line.match(PASSAGE_HEADER);
    if (header) starts.push({ index, passageNumber: Number(header[1]), testLabel });
  });

  const passages: ReadingPassage[] = [];
  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : bodyLines.length;
    const chunk = bodyLines.slice(start.index, end);

    const firstQuestionIndex = chunk.findIndex((line) => QUESTIONS_HEADER.test(line) || SINGLE_QUESTION_HEADER.test(line));
    const passageLines = firstQuestionIndex > 0 ? chunk.slice(1, firstQuestionIndex) : chunk.slice(1);
    const questionLines = firstQuestionIndex > 0 ? chunk.slice(firstQuestionIndex) : [];

    const questions = buildQuestions(splitQuestionGroups(questionLines));
    // A chunk with no questions at all is almost always a false positive (a
    // contents entry or a cross-reference), so it is not worth a task.
    if (!questions.length) return;

    // The first non-empty, non-instruction line doubles as the passage's own
    // title in every Cambridge-style book.
    const title = passageLines.find((line) => line.length > 3 && !/^you should spend/i.test(line)) ?? "";

    passages.push({
      id: uid(),
      order: passages.length + 1,
      title: [start.testLabel, `Passage ${start.passageNumber}`, title].filter(Boolean).join(" · "),
      text: passageLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
      questions,
    });
  });

  // Match each question to the next key entry carrying its own number,
  // within a bounded look-ahead window of the current cursor. This is
  // deliberately NOT a blind positional fallback: if a passage elsewhere in
  // the book failed question-detection (its "Questions N-M" header was too
  // OCR-garbled to match), the key still holds that passage's answers, and
  // consuming them positionally for a later passage would silently attach
  // the wrong answer to every question after that point. Requiring an exact
  // number match means a gap in detection produces a gap in answers instead
  // of a book's worth of misattributed ones.
  //
  // Grouping this search by each passage's own "Day N"/"Test N" label was
  // tried and measured worse in practice: on heavily-OCR'd scans those
  // labels are themselves corrupted by running headers/footers bleeding in
  // from neighbouring pages, so trusting them to gate the search discarded
  // more correct matches than the mislabelling it was meant to prevent.
  const WINDOW = 60;
  let cursor = 0;
  for (const passage of passages) {
    for (const question of passage.questions) {
      const searchEnd = Math.min(answerPairs.length, cursor + WINDOW);
      let found = -1;
      for (let i = cursor; i < searchEnd; i += 1) {
        // A number match on its own isn't enough evidence: footer text like
        // "www.nhantriviet.com" or a stray book title fragment can land on
        // the same row as a real "N. answer" pair and get regex-matched as
        // if it were one. Rejecting an implausible shape means that number
        // stays unanswered instead of teaching the student a fake answer.
        if (answerPairs[i].number === question.number && isPlausibleAnswer(question.type, answerPairs[i].answer, passage.text)) {
          found = i;
          break;
        }
      }
      if (found >= 0) {
        question.answer = answerPairs[found].answer;
        cursor = found + 1;
      }
    }
  }

  const book: ReadingBook = {
    id: uid(),
    title: bookTitle.trim() || fileName.replace(/\.pdf$/i, ""),
    sourceFileName: fileName,
    createdAt: new Date().toISOString(),
    passages,
  };

  return {
    book,
    report: passages.map((passage) => ({
      passageTitle: passage.title,
      questionCount: passage.questions.length,
      answeredCount: passage.questions.filter((q) => q.answer).length,
      wordCount: passage.text.split(/\s+/).filter(Boolean).length,
    })),
    answerPairsFound: answerPairs.length,
  };
}

/**
 * IELTS marking is generous about case, surrounding articles and the
 * "TRUE/T" style abbreviations the key uses, so compare on a normalised form
 * rather than raw equality.
 */
export function isAnswerCorrect(given: string, expected: string): boolean {
  if (!expected) return false;
  const normalise = (value: string) =>
    value
      .toLowerCase()
      .replace(/[.,;:!?"'’“”()]/g, "")
      .replace(/^(?:a|an|the)\s+/, "")
      .replace(/\s+/g, " ")
      .trim();

  const a = normalise(given);
  const b = normalise(expected);
  if (!a) return false;
  if (a === b) return true;

  const expand = (value: string) =>
    ({ t: "true", f: "false", ng: "not given", y: "yes", n: "no" } as Record<string, string>)[value] ?? value;
  if (expand(a) === expand(b)) return true;

  // Keys often print acceptable variants as "office/workplace".
  return b.split(/\s*\/\s*/).map(normalise).includes(a);
}
