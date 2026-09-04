import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LifeManagementConfig, ReadingAttempt, ReadingBook, ReadingData } from "../types/reading";
import { loadReadingData, saveReadingData, startOfWeek, toDateKey } from "../utils/readingStorage";

/**
 * Thư viện bài đọc dựng sẵn, đi kèm chính bản deploy (public/reading-library.json).
 *
 * Không phải đề IELTS thật: đề Cambridge/British Council có bản quyền và không
 * được phép phát hành lại. Đây là bài viết thật trên Wikipedia (CC BY-SA 4.0),
 * cắt về đúng độ dài và chủ đề của IELTS Academic Reading, mỗi bài ghi rõ
 * nguồn ở cuối. Tải bằng fetch chứ không nhúng vào bundle: 440KB chữ không nên
 * nằm trong file JS mà mọi trang đều phải tải.
 */
// Bump khi NỘI DUNG thư viện thay đổi đáng kể (không chỉ khi sửa lỗi vặt) —
// đây là cách duy nhất để máy ĐÃ từng nạp thư viện tải lại bản mới, vì logic
// bên dưới cố tình chỉ nạp một lần cho mỗi id. Từng có đợt sửa lại toàn bộ 52
// bài (chấm giám khảo, sửa câu hỏi) nhưng người dùng đã mở trang từ trước đó
// vẫn kẹt ở bản cũ vì id không đổi — họ không bao giờ được nạp lại.
const BUILTIN_LIBRARY_VERSION = 2;
const BUILTIN_LIBRARY_ID = `open-reading-library-v${BUILTIN_LIBRARY_VERSION}`;
const BUILTIN_LIBRARY_URL = "/reading-library.json";
// Nhận diện MỌI phiên bản cũ của thư viện này để thay thế sạch khi nạp bản
// mới — nếu chỉ so id chính xác, bump version ở trên sẽ để lại một cuốn cũ
// nằm lại vĩnh viễn cạnh cuốn mới thay vì được thay thế.
const isBuiltinLibraryBook = (id: string) => /^open-reading-library-v\d+$/.test(id);

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

  // Nạp thư viện dựng sẵn đúng MỘT LẦN cho mỗi máy. Ghi lại id đã nạp thay vì
  // kiểm tra "sách đã có chưa": nếu chỉ kiểm tra sự tồn tại thì người dùng xoá
  // cuốn này đi, lần mở trang sau nó lại tự mọc lại.
  useEffect(() => {
    if (dataRef.current.seededLibraries?.includes(BUILTIN_LIBRARY_ID)) return;
    const controller = new AbortController();
    void fetch(BUILTIN_LIBRARY_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ReadingBook>;
      })
      .then((library) => {
        if (!library?.passages?.length) return;
        setData((current) => ({
          ...current,
          books: [library, ...current.books.filter((book) => !isBuiltinLibraryBook(book.id))],
          seededLibraries: [...(current.seededLibraries ?? []), BUILTIN_LIBRARY_ID],
        }));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("Không nạp được thư viện bài đọc dựng sẵn.", error);
      });
    return () => controller.abort();
  }, [setData]);

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
      markBookSynced(bookId: string, taskId: string, passageTaskIds: Record<string, string> = {}) {
        setData((current) => ({
          ...current,
          books: current.books.map((book) =>
            book.id === bookId
              ? {
                  ...book,
                  lifeManagementTaskId: taskId,
                  passages: book.passages.map((passage) =>
                    passageTaskIds[passage.id]
                      ? { ...passage, lifeManagementTaskId: passageTaskIds[passage.id] }
                      : passage,
                  ),
                }
              : book,
          ),
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
