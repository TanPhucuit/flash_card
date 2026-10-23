import { RefObject, useEffect, useRef, useState } from "react";
import { VocabularySet } from "../types";
import { MOBILE_SET_LIMIT, addToMobileSet } from "../utils/mobileSets";
import { translateToVietnamese } from "../utils/translate";
import { Icon } from "./ui";

const MAX_WORDS = 6;
const MAX_CHARS = 60;

/** Bỏ dấu câu ở hai đầu, gộp khoảng trắng; trả về "" nếu không phải một từ/cụm từ ngắn. */
function cleanSelection(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!text || !/\p{L}/u.test(text) || text.length > MAX_CHARS) return "";
  return text.split(" ").length <= MAX_WORDS ? text : "";
}

/**
 * Chữ hoa chỉ vì đứng đầu câu ("Mangroves are...") thì đưa về chữ thường, nhưng
 * giữ nguyên tên riêng: chỉ hạ chữ hoa khi bài đọc có dùng chính từ đó ở dạng
 * chữ thường ở chỗ khác.
 */
function normaliseCase(text: string, passage: string): string {
  if (!/^\p{Lu}\p{Ll}/u.test(text)) return text;
  const lower = text.charAt(0).toLowerCase() + text.slice(1);
  const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, "u").test(passage) ? lower : text;
}

type Selected = { text: string; x: number; y: number; below: boolean };

/**
 * Bôi đen một từ hoặc cụm từ ngắn trong bài đọc để xem nghĩa tiếng Việt và
 * thêm ngay vào Mobile Set (không cần chọn bộ từ vựng).
 */
export function SelectionTranslator({
  containerRef,
  passageText,
  sets,
  upsertSet,
}: {
  containerRef: RefObject<HTMLElement | null>;
  passageText: string;
  sets: VocabularySet[];
  upsertSet: (set: VocabularySet) => void;
}) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const [translation, setTranslation] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const cache = useRef(new Map<string, string>());
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onMouseUp = () => {
      // Đợi trình duyệt cập nhật xong vùng chọn sau cú nhả chuột.
      window.setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) return;
        const text = cleanSelection(selection.toString());
        if (!text) {
          setSelected(null);
          return;
        }
        const rect = range.getBoundingClientRect();
        const below = rect.top < 180;
        setSelected({
          text: normaliseCase(text, passageText),
          x: Math.min(Math.max(rect.left + rect.width / 2, 170), window.innerWidth - 170),
          y: below ? rect.bottom + 10 : rect.top - 10,
          below,
        });
      }, 0);
    };
    const close = () => setSelected(null);
    const onPointerDown = (event: MouseEvent) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    container.addEventListener("mouseup", onMouseUp);
    container.addEventListener("scroll", close);
    window.addEventListener("scroll", close);
    window.addEventListener("resize", close);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("scroll", close);
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [containerRef, passageText]);

  const text = selected?.text;
  useEffect(() => {
    setResult(null);
    if (!text) return;
    const cached = cache.current.get(text.toLowerCase());
    if (cached) {
      setTranslation(cached);
      setStatus("ready");
      return;
    }
    const controller = new AbortController();
    setTranslation("");
    setStatus("loading");
    translateToVietnamese(text, controller.signal)
      .then((value) => {
        cache.current.set(text.toLowerCase(), value);
        setTranslation(value);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, [text]);

  if (!selected) return null;

  const add = () => {
    const outcome = addToMobileSet(sets, upsertSet, { word: selected.text, meaningVi: translation });
    setResult(
      outcome.status === "added"
        ? { ok: true, message: `Đã thêm vào ${outcome.set.title} (${outcome.set.cards.length}/${MOBILE_SET_LIMIT})` }
        : { ok: false, message: `Từ này đã có trong ${outcome.set.title}` },
    );
  };

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Dịch nhanh"
      className="fixed z-50 w-[320px] rounded-2xl border border-surface-variant bg-white p-md text-left shadow-level-2 dark:border-white/10 dark:bg-[#242728]"
      style={{ left: selected.x, top: selected.y, transform: `translate(-50%, ${selected.below ? "0" : "-100%"})` }}
      // Giữ nguyên vùng bôi đen khi bấm vào popup.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="mb-xs flex items-start justify-between gap-sm">
        <p className="min-w-0 break-words text-base font-bold text-on-surface dark:text-white">{selected.text}</p>
        <button type="button" aria-label="Đóng" onClick={() => setSelected(null)} className="-mr-xs -mt-xs shrink-0 rounded-full p-xs text-on-surface-variant hover:bg-surface-container dark:hover:bg-white/10">
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>
      <div className="mb-sm flex items-center gap-xs text-xs font-semibold uppercase tracking-wide text-on-surface-variant dark:text-white/50">
        <Icon name="translate" className="text-[16px]" /> Tiếng Việt
      </div>
      <p className="mb-md min-h-6 text-[15px] leading-6 text-primary dark:text-[#c9c5ff]">
        {status === "loading" ? <span className="animate-pulse text-on-surface-variant">Đang dịch...</span> : status === "error" ? <span className="text-red-700">Không dịch được. Bôi đen lại để thử lần nữa.</span> : translation}
      </p>
      {result ? (
        <p className={`flex items-center gap-xs rounded-lg px-sm py-xs text-sm font-semibold ${result.ok ? "bg-green-50 text-green-800 dark:bg-green-500/15 dark:text-green-200" : "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-100"}`}>
          <Icon name={result.ok ? "check_circle" : "info"} className="text-[18px]" /> {result.message}
        </p>
      ) : (
        <button
          type="button"
          onClick={add}
          disabled={status !== "ready"}
          className="flex w-full items-center justify-center gap-xs rounded-xl bg-primary px-md py-sm text-sm font-semibold text-white transition hover:bg-primary-container active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="add" className="text-[18px]" /> Thêm vào Mobile Set
        </button>
      )}
    </div>
  );
}
