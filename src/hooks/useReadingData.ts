import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LifeManagementConfig, ReadingAttempt, ReadingBook, ReadingData } from "../types/reading";
import { loadReadingData, saveReadingData, startOfWeek, toDateKey } from "../utils/readingStorage";

/**
 * Thư viện bài đọc dựng sẵn, đi kèm chính bản deploy (public/reading-library.json).
 *
 * Không phải đề IELTS thật: đề Cambridge/British Council có bản quyền và không
 * được phép phát hành lại. Đây là bài viết tự biên soạn theo phong cách
 * Wikipedia, cắt về đúng độ dài và chủ đề của IELTS Academic Reading.
 *
 * CỐ TÌNH KHÔNG lưu nội dung thư viện này vào localStorage. Nó là dữ liệu tĩnh,
 * giống hệt nhau cho mọi người dùng, tải lại từ file JSON mỗi lần mở app là đủ
 * — ghi cả trăm bài đọc kèm câu hỏi và giải thích (hiện đã hơn 1MB, nhân đôi vì
 * còn ghi thêm bản backup) vào localStorage là lãng phí không cần thiết, và
 * trên trình duyệt di động vốn có hạn mức localStorage nhỏ hơn máy tính, việc
 * này từng khiến MỌI thao tác của web từ vựng — kể cả những phần chẳng liên
 * quan gì tới Reading — bị chặn lại: mỗi lần lưu app đầy dữ liệu sau khi
 * localStorage đã đầy sẽ ném lỗi, và lỗi đó từng bị xử lý bằng alert() chặn cả
 * luồng, lặp lại ở mọi thao tác tiếp theo (Thêm từ, Learn...).
 */
const BUILTIN_LIBRARY_ID = "open-reading-library";
const BUILTIN_LIBRARY_URL = "/reading-library.json";

export function useReadingData() {
  const [data, setReactData] = useState<ReadingData>(() => loadReadingData());
  const dataRef = useRef(data);
  // Thư viện dựng sẵn: chỉ tồn tại trong bộ nhớ của phiên hiện tại, KHÔNG đi
  // qua saveReadingData. Đồng bộ Life Management có thể ghi id task vào đây
  // trong lúc dùng (xem markBookSynced), nhưng id đó không sống sót qua lần
  // tải trang sau — không sao, logic đồng bộ vốn đã tự nhận diện lại node cũ
  // theo tên nếu không tìm thấy theo id.
  const [builtinLibrary, setBuiltinLibrary] = useState<ReadingBook | null>(null);

  const setData = useCallback((updater: (current: ReadingData) => ReadingData) => {
    const next = updater(dataRef.current);
    dataRef.current = next;
    try {
      saveReadingData(next);
    } catch (error) {
      // Không alert(): một alert() chặn cả luồng JS, và nếu ghi tiếp tục thất
      // bại (localStorage vẫn đầy) thì hộp thoại này sẽ hiện lại ở thao tác kế
      // tiếp — với người dùng, đó là "web đứng hình liên tục đòi đồng bộ".
      // Dữ liệu vẫn cập nhật đúng trong bộ nhớ (setReactData ở dưới vẫn chạy),
      // chỉ là không được lưu lại cho lần mở sau — âm thầm chấp nhận vậy còn
      // hơn chặn đứng thao tác của người dùng.
      console.error("Không lưu được dữ liệu Reading — localStorage có thể đã đầy.", error);
    }
    setReactData(next);
  }, []);

  // Nạp thư viện dựng sẵn mỗi khi mở app — rẻ, vì nó chỉ là một GET tới file
  // tĩnh cùng gốc (trình duyệt tự cache), và không còn cần cờ "đã nạp chưa"
  // kiểu cũ vì kết quả không được lưu vào localStorage để mà phải né nạp lại.
  useEffect(() => {
    const controller = new AbortController();
    void fetch(BUILTIN_LIBRARY_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ReadingBook>;
      })
      .then((library) => {
        if (!library?.passages?.length || controller.signal.aborted) return;
        setBuiltinLibrary({ ...library, id: BUILTIN_LIBRARY_ID });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("Không nạp được thư viện bài đọc dựng sẵn.", error);
      });
    return () => controller.abort();
  }, []);

  // Cây hiển thị: thư viện dựng sẵn (nếu đã tải và chưa bị người dùng xoá) ghép
  // trước danh sách sách người dùng tự thêm. Đây là chỗ DUY NHẤT hai nguồn gặp
  // nhau — mọi trang khác chỉ cần đọc api.data.books như trước, không đổi gì.
  const books = useMemo(() => {
    const hidden = data.hiddenLibraries ?? [];
    const extra = builtinLibrary && !hidden.includes(builtinLibrary.id) ? [builtinLibrary] : [];
    return [...extra, ...data.books];
  }, [builtinLibrary, data.books, data.hiddenLibraries]);

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
        if (bookId === builtinLibrary?.id) {
          // Thư viện dựng sẵn không nằm trong data.books nên xoá nó nghĩa là
          // ghi nhớ "đã ẩn" — nếu không, lần mở trang sau nó lại tự mọc lại vì
          // luôn được nạp lại từ file tĩnh.
          setBuiltinLibrary(null);
          setData((current) => ({ ...current, hiddenLibraries: [...(current.hiddenLibraries ?? []), bookId] }));
          return;
        }
        setData((current) => ({
          ...current,
          books: current.books.filter((book) => book.id !== bookId),
          attempts: current.attempts.filter((attempt) => attempt.bookId !== bookId),
        }));
      },
      markBookSynced(bookId: string, taskId: string, passageTaskIds: Record<string, string> = {}) {
        const applyIds = (book: ReadingBook): ReadingBook => ({
          ...book,
          lifeManagementTaskId: taskId,
          passages: book.passages.map((passage) =>
            passageTaskIds[passage.id] ? { ...passage, lifeManagementTaskId: passageTaskIds[passage.id] } : passage,
          ),
        });
        if (bookId === builtinLibrary?.id) {
          setBuiltinLibrary((current) => (current ? applyIds(current) : current));
          return;
        }
        setData((current) => ({
          ...current,
          books: current.books.map((book) => (book.id === bookId ? applyIds(book) : book)),
        }));
      },
      recordAttempt(attempt: ReadingAttempt) {
        setData((current) => ({ ...current, attempts: [attempt, ...current.attempts] }));
      },
      setLifeManagement(config: LifeManagementConfig) {
        setData((current) => ({ ...current, lifeManagement: config }));
      },
    }),
    [setData, builtinLibrary?.id],
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

  return { data: { ...data, books }, stats, ...api };
}

export type ReadingApi = ReturnType<typeof useReadingData>;
