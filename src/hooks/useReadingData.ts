import { useCallback, useMemo, useRef, useState } from "react";
import { LifeManagementConfig, ReadingAttempt, ReadingBook, ReadingData } from "../types/reading";
import { loadReadingData, saveReadingData, startOfWeek, toDateKey } from "../utils/readingStorage";

export function useReadingData() {
  const [data, setReactData] = useState<ReadingData>(() => loadReadingData());
  const dataRef = useRef(data);

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
  }, []);

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

  return { data, stats, ...api };
}

export type ReadingApi = ReturnType<typeof useReadingData>;
