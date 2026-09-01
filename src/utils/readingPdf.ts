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

// --------------------------------------------------------------------------
// Column-aware page reconstruction.
//
// pdfjs hands back text runs in reading order for ordinary prose, but a
// multi-column answer-key table is typeset as several side-by-side columns
// that all happen to share the same baselines — grouping purely by Y (as a
// naive "line" builder does) concatenates column 1's, column 2's, column 3's
// and column 4's text for that row into one interleaved, unparseable string
// ("3 vii I1.YES 23. water 33.24-hour" is actually four separate answers:
// Q3, Q11, Q23, Q33). The fix is to detect the columns and read each one top
// to bottom on its own before moving to the next, which is the order a human
// reading the table would use.
export interface PageItem {
  str: string;
  x: number;
  y: number;
  hasEOL: boolean;
}

// Marks a hard boundary between "sections" of a page — different answer-key
// blocks (one per day) sit on the very same page but use different column
// counts and positions, so column detection has to be scoped to a single
// section, never the whole page. Reusing the structural headers the rest of
// this file already keys off of costs nothing extra and needs no new regexes.
const SECTION_BREAK = new RegExp(
  [PASSAGE_HEADER, TEST_HEADER, DAY_HEADER, QUESTIONS_HEADER, SINGLE_QUESTION_HEADER, ANSWER_KEY_HEADER]
    .map((re) => re.source)
    .join("|"),
  "i",
);

interface Cell {
  x: number;
  y: number;
  text: string;
}

/**
 * Split a row's items into cells wherever consecutive items' x-starts jump
 * by more than this many points. Real column gutters in these books measure
 * 80–110pt; a wrapped word within one cell never jumps anywhere close to
 * that. (Item.width was tried first and rejected — pdfjs/this OCR pipeline
 * reports widths that pad out to whatever the next item's x already is,
 * making width-based gaps read as ~0 even across a genuine column boundary.)
 */
const CELL_GAP = 45;
// Column x-starts cluster tightly (a column's own text wanders at most a
// couple of characters' worth); real columns sit far enough apart that this
// is comfortably below the smallest true gutter and above normal jitter.
const CLUSTER_GAP = 35;

function splitRowIntoCells(row: PageItem[]): Cell[] {
  const items = row.filter((item) => item.str.trim());
  if (!items.length) return [];
  const cells: Cell[] = [];
  let start = 0;
  for (let i = 1; i < items.length; i += 1) {
    if (items[i].x - items[i - 1].x > CELL_GAP) {
      cells.push(toCell(items.slice(start, i)));
      start = i;
    }
  }
  cells.push(toCell(items.slice(start)));
  return cells;
}

function toCell(chunk: PageItem[]): Cell {
  return { x: chunk[0].x, y: chunk[0].y, text: chunk.map((item) => item.str).join(" ").trim() };
}

function clusterByX(cells: Cell[]): Array<{ min: number; max: number }> {
  const xs = Array.from(new Set(cells.map((cell) => Math.round(cell.x)))).sort((a, b) => a - b);
  const clusters: number[][] = [];
  let bucket: number[] = [xs[0]];
  for (let i = 1; i < xs.length; i += 1) {
    if (xs[i] - bucket[bucket.length - 1] > CLUSTER_GAP) {
      clusters.push(bucket);
      bucket = [];
    }
    bucket.push(xs[i]);
  }
  clusters.push(bucket);
  return clusters.map((c) => ({ min: c[0], max: c[c.length - 1] }));
}

/** Reconstructs one section's worth of rows, column-major if it has more than one column. */
function reconstructSection(rows: PageItem[][]): string[] {
  const rowCells = rows.map(splitRowIntoCells);
  const allCells = rowCells.flat();
  if (!allCells.length) return [];

  const ranges = clusterByX(allCells);
  if (ranges.length === 1) {
    // Single column: this is ordinary prose (or a table with only one column
    // of content on this page) — emit rows in their natural top-to-bottom order.
    return rowCells.map((cells) => cells.map((c) => c.text).join(" ").trim()).filter(Boolean);
  }

  const columnOf = (x: number) => {
    let best = 0;
    let bestDist = Infinity;
    ranges.forEach((range, index) => {
      const dist = x < range.min ? range.min - x : x > range.max ? x - range.max : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    return best;
  };

  const perColumn: Cell[][] = ranges.map(() => []);
  for (const cell of allCells) perColumn[columnOf(cell.x)].push(cell);
  perColumn.forEach((column) => column.sort((a, b) => b.y - a.y));

  return perColumn.flatMap((column) => column.map((cell) => cell.text));
}

/**
 * Groups a page's items into visual rows (same logic readingPdfExtract.ts
 * used to apply directly), then slices those rows into sections at every
 * structural header and reconstructs each section independently. Exported
 * so it can be exercised directly against a captured (str, x, y, hasEOL)
 * dump — the same shape pdfjs text items reduce to — without needing pdfjs
 * itself.
 */
export function reconstructPageLines(items: PageItem[]): string[] {
  const rows: PageItem[][] = [];
  let current: PageItem[] = [];
  let currentY: number | null = null;
  for (const item of items) {
    const y = Math.round(item.y * 10) / 10;
    if (currentY === null) currentY = y;
    if (Math.abs(y - currentY) > 2.5) {
      rows.push(current);
      current = [];
      currentY = y;
    }
    current.push(item);
    if (item.hasEOL) {
      rows.push(current);
      current = [];
      currentY = null;
    }
  }
  if (current.length) rows.push(current);

  const rowTexts = rows.map((row) => row.map((item) => item.str).join("").trim());

  const sections: Array<{ header: string | null; rows: PageItem[][] }> = [];
  let active: { header: string | null; rows: PageItem[][] } = { header: null, rows: [] };
  rows.forEach((row, index) => {
    const text = rowTexts[index];
    if (text && SECTION_BREAK.test(text)) {
      if (active.header !== null || active.rows.length) sections.push(active);
      active = { header: text, rows: [] };
      return;
    }
    active.rows.push(row);
  });
  if (active.header !== null || active.rows.length) sections.push(active);

  return sections.flatMap((section) => {
    const body = reconstructSection(section.rows);
    return section.header !== null ? [section.header, ...body] : body;
  });
}

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
  let instructionLines = 0;

  for (const line of lines) {
    const range = line.match(QUESTIONS_HEADER);
    const single = line.match(SINGLE_QUESTION_HEADER);
    if (range || single) {
      if (current) groups.push(current);
      const from = Number(range ? range[1] : single![1]);
      const to = Number(range ? range[2] : single![1]);
      current = { from, to, instruction: "", bodyLines: [] };
      instructionLines = 0;
      continue;
    }
    if (!current) continue;
    // Everything before the first numbered question is the instruction for the
    // group — that is what tells us whether these are TRUE/FALSE, MCQ, gaps...
    // Capped at a handful of lines: a summary-completion group numbers its
    // blanks inline as "...result not only from (1)" rather than with a
    // line-leading "1.", so NUMBERED_LINE never matches at all and, without
    // a cap, every line of the summary would get swallowed as "instruction"
    // and buildQuestions would never see any of it.
    if (!current.bodyLines.length && !NUMBERED_LINE.test(line) && instructionLines < 6) {
      current.instruction += ` ${line}`;
      instructionLines += 1;
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

    // Summary-completion questions are frequently numbered inline, mid-
    // sentence — "...result not only from (1) also from (2)..." — rather
    // than as a line starting with "N.", so the loop above finds nothing.
    // Scan the group's raw text for "(N)" markers instead; there is no
    // per-blank wording to use as a prompt here, only its position in the
    // summary, so the passage text itself is what the test-taker reads.
    if (!groupQuestions.length) {
      const joined = group.bodyLines.join(" ");
      const seen = new Set<number>();
      for (const match of joined.matchAll(/\((\d{1,3})\)/g)) {
        const number = Number(match[1]);
        if (number < group.from || number > group.to || seen.has(number) || questions.some((q) => q.number === number)) continue;
        seen.add(number);
        const question: ReadingQuestion = { id: uid(), number, type, prompt: `Gap ${number} in the summary below`, answer: "" };
        questions.push(question);
        groupQuestions.push(question);
      }
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
  /** The "Day N"/"Test N" heading last seen before this pair, "" if none. */
  label: string;
}

/**
 * Read every "<number> <answer>" pair out of the key, in the order printed,
 * tagging each with whichever "Day N"/"Test N" heading precedes it. The label
 * is not used to gate matching directly — several passages in the same book
 * share the same question shape (a heading-matching set numbered 1, 2, 3...)
 * and can produce an equally "plausible" run of matches from a completely
 * different day's key block, so a match search restricted to the wrong scope
 * has no way to tell it borrowed the wrong day's answers. The label is used
 * as a tie-breaker instead (see the assignment loop below): among several
 * candidate starting points that match equally well, prefer the one that
 * actually sits in this passage's own day.
 */
function parseAnswerPairs(lines: string[]): AnswerPair[] {
  const pairs: AnswerPair[] = [];
  let label = "";
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
    if (!rawLine) continue;
    const test = rawLine.match(TEST_HEADER);
    if (test) label = `Test ${test[1]}`;
    const day = rawLine.match(DAY_HEADER);
    if (day) label = `Day ${day[1]}`;
    if (ANSWER_KEY_HEADER.test(rawLine)) continue;
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
      pairs.push({ number: Number(match[1]), answer, label });
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

  // Match each passage's questions against the key independently, rather
  // than walking one cursor forward across the whole book. A single shared
  // cursor means a detection gap in ANY earlier passage (a garbled
  // "Questions N-M" header, a summary whose blanks never resolved) leaves
  // every passage after it searching from the wrong starting point — verified
  // directly: recovering more passages elsewhere in this book raised total
  // detected questions but *lowered* total correct matches, because passages
  // that used to match perfectly on their own were being derailed by
  // unrelated gaps upstream of them.
  //
  // Instead, for each passage, try every place in the key where its own
  // FIRST question's number appears, walk forward from each candidate
  // matching as many of the rest of its questions as line up with plausible
  // answers, and keep whichever starting point matched the most questions.
  // This localises a bad match to the one passage that picked a wrong
  // anchor — it can never cascade into passages that would otherwise be fine.
  const PER_PASSAGE_WINDOW = 20;

  const bestRunFrom = (anchors: number[], passage: ReadingPassage) => {
    let best: Array<{ question: ReadingQuestion; index: number }> = [];
    for (const anchor of anchors) {
      const matches: Array<{ question: ReadingQuestion; index: number }> = [];
      let cursor = anchor;
      for (const question of passage.questions) {
        const searchEnd = Math.min(answerPairs.length, cursor + PER_PASSAGE_WINDOW);
        let found = -1;
        for (let i = cursor; i < searchEnd; i += 1) {
          if (answerPairs[i].number === question.number && isPlausibleAnswer(question.type, answerPairs[i].answer, passage.text)) {
            found = i;
            break;
          }
        }
        if (found >= 0) {
          matches.push({ question, index: found });
          cursor = found + 1;
        }
      }
      if (matches.length > best.length) best = matches;
    }
    return best;
  };

  for (const passage of passages) {
    const first = passage.questions[0];
    if (!first) continue;

    const label = passage.title.match(/^(Day \d+|Test \d+)/)?.[1] ?? "";
    const allAnchors: number[] = [];
    const sameLabelAnchors: number[] = [];
    answerPairs.forEach((pair, index) => {
      if (pair.number !== first.number) return;
      allAnchors.push(index);
      if (label && pair.label === label) sameLabelAnchors.push(index);
    });

    // Several passages in this book share the same question shape (a
    // heading-matching set starting at 1, say), so a run of plausible
    // matches on its own is not proof they belong to THIS passage — it may
    // just as easily be borrowing a different day's key block that happens
    // to fit the same pattern. Prefer any candidate that actually sits in
    // this passage's own day; only search the whole key if that comes up
    // empty (an undetected day label on one side or the other).
    const scoped = bestRunFrom(sameLabelAnchors, passage);
    const best = scoped.length ? scoped : bestRunFrom(allAnchors, passage);

    for (const { question, index } of best) question.answer = answerPairs[index].answer;
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
