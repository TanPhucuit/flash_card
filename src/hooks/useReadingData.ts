import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LifeManagementConfig, ReadingAttempt, ReadingBook, ReadingData } from "../types/reading";
import { loadReadingData, saveReadingData, startOfWeek, toDateKey } from "../utils/readingStorage";
import { loadReadingFromGoogleSheet, saveReadingToGoogleSheet } from "../utils/cloudSync";

export function useReadingData() {
  const [data, setReactData] = useState<ReadingData>(() => loadReadingData());
  const dataRef = useRef(data);
  const cloudSaveTimer = useRef<number | undefined>(undefined);
  const [syncState, setSyncState] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [syncError, setSyncError] = useState("");

  // Sách và lượt làm bài giờ có nguồn thật là Google Sheet — cùng một cuốn
  // sách nạp vào từ MÁY NÀY thì máy khác cũng thấy, không còn kẹt riêng trong
  // localStorage của từng trình duyệt nữa. `lifeManagement` (đường dẫn tới
  // deployment Life Management) cố tình KHÔNG đồng bộ: mỗi máy có thể trỏ tới
  // một deployment khác nhau, giống hệt cách AppData không đồng bộ `settings`.
  useEffect(() => {
    const controller = new AbortController();
    setSyncState("loading");
    loadReadingFromGoogleSheet(controller.signal)
      .then((cloud) => {
        setReactData((current) => {
          const next = { ...current, books: cloud.books, attempts: cloud.attempts };
          dataRef.current = next;
          saveReadingData(next);
          return next;
        });
        setSyncState("idle");
        setSyncError("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("Google Sheet reading sync load failed. Using browser cache.", error);
        setSyncState("error");
        setSyncError("Không tải được sách từ Google Sheet, đang dùng dữ liệu cache trên trình duyệt.");
      });
    return () => controller.abort();
  }, []);

  const scheduleCloudSave = useCallback((next: ReadingData) => {
    if (cloudSaveTimer.current) window.clearTimeout(cloudSaveTimer.current);
    cloudSaveTimer.current = window.setTimeout(() => {
      setSyncState("saving");
      saveReadingToGoogleSheet({ books: next.books, attempts: next.attempts })
        .then(() => {
          setSyncState("idle");
          setSyncError("");
        })
        .catch((error) => {
          console.error("Google Sheet reading sync save failed.", error);
          setSyncState("error");
          setSyncError("Không lưu được sách lên Google Sheet. Dữ liệu vẫn còn trong trình duyệt này.");
        });
    }, 700);
  }, []);

  const setData = useCallback((updater: (current: ReadingData) => ReadingData) => {
    const next = updater(dataRef.current);
    dataRef.current = next;
    try {
      saveReadingData(next);
    } catch (error) {
      console.error("Không thể lưu dữ liệu Reading.", error);
      alert("Không lưu được dữ liệu Reading — localStorage có thể đã đầy. Hãy xoá bớt sách cũ.");
    }
    setReactData(next);
    scheduleCloudSave(next);
  }, [scheduleCloudSave]);

  const api = useMemo(
    () => ({
      addBook(book: ReadingBook) {
        // Import lại cùng một cuốn sẽ THAY THẾ bản cũ chứ không thêm bản thứ
        // hai. Trước đây mỗi lần nhập lại (ví dụ sau khi sửa bảng đáp án) lại
        // sinh ra một cuốn trùng tên với đáp án sai nằm cạnh cuốn đúng, không
        // có cách nào phân biệt trong danh sách.
        const sameBook = (item: ReadingBook) =>
          item.title.trim().toLowerCase() === book.title.trim().toLowerCase();
        setData((current) => ({
          ...current,
          books: [book, ...current.books.filter((item) => !sameBook(item))],
          attempts: current.attempts.filter(
            (attempt) => !current.books.some((item) => sameBook(item) && item.id === attempt.bookId),
          ),
        }));
      },
      deleteBook(bookId: string) {
        setData((current) => ({
          ...current,
          books: current.books.filter((book) => book.id !== bookId),
          attempts: current.attempts.filter((attempt) => attempt.bookId !== bookId),
        }));
      },
      markBookSynced(bookId: string, taskId: string) {
        setData((current) => ({
          ...current,
          books: current.books.map((book) => (book.id === bookId ? { ...book, lifeManagementTaskId: taskId } : book)),
        }));
      },
      recordAttempt(attempt: ReadingAttempt) {
        setData((current) => ({ ...current, attempts: [attempt, ...current.attempts] }));
      },
      setLifeManagement(config: LifeManagementConfig) {
        setData((current) => ({ ...current, lifeManagement: config }));
      },
    }),
    [setData],
  );

  // Volume stats. Counted per attempt (one sitting of one passage) rather than
  // per distinct passage, so re-doing a passage still registers as work done.
  const stats = useMemo(() => {
    const now = new Date();
    const todayKey = toDateKey(now);
    const weekStartKey = toDateKey(startOfWeek(now));
    const monthPrefix = todayKey.slice(0, 7);

    const today = data.attempts.filter((a) => a.dateKey === todayKey);
    const week = data.attempts.filter((a) => a.dateKey >= weekStartKey && a.dateKey <= todayKey);
    const month = data.attempts.filter((a) => a.dateKey.startsWith(monthPrefix));

    const accuracy = (list: ReadingAttempt[]) => {
      const total = list.reduce((sum, a) => sum + a.total, 0);
      if (!total) return 0;
      return Math.round((list.reduce((sum, a) => sum + a.correct, 0) / total) * 100);
    };

    // Last 14 days, oldest first, for the trend strip.
    const daily: Array<{ dateKey: string; count: number }> = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      const key = toDateKey(day);
      daily.push({ dateKey: key, count: data.attempts.filter((a) => a.dateKey === key).length });
    }

    return {
      todayCount: today.length,
      weekCount: week.length,
      monthCount: month.length,
      totalCount: data.attempts.length,
      todayAccuracy: accuracy(today),
      weekAccuracy: accuracy(week),
      overallAccuracy: accuracy(data.attempts),
      daily,
    };
  }, [data.attempts]);

  return { data, stats, syncState, syncError, ...api };
}

export type ReadingApi = ReturnType<typeof useReadingData>;
