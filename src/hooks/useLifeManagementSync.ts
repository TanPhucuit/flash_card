import { useCallback, useEffect, useRef, useState } from "react";
import { DataApi, ReadingDataApi } from "../App";
import { syncAllListsToLifeManagement, syncBooksToLifeManagement } from "../utils/lifeManagementSync";
import { getCompletedSetModes } from "../utils/study";
import { isStarSet } from "../utils/starSets";

export type LifeManagementSyncState = "idle" | "syncing" | "error";

export interface LifeManagementSyncApi {
  state: LifeManagementSyncState;
  message: string;
  /** Chạy lại ngay lập tức, bỏ qua hàng đợi chờ — dành cho nút bấm tay. */
  syncNow: () => void;
}

/**
 * Giữ cây task bên Life Management khớp với web từ vựng, TỰ ĐỘNG.
 *
 * Chạy lại mỗi khi phần dữ liệu có ảnh hưởng tới cây đổi — thêm/xoá danh sách,
 * thêm/đổi tên set, học xong một chế độ, làm xong một bài đọc — chứ không chạy
 * theo nhịp thời gian. Chuỗi vân tay bên dưới đúng bằng những thứ đó, nên mở
 * app rồi ngồi yên sẽ không phát sinh request nào.
 *
 * Một lượt "không có gì đổi" chỉ tốn hai lần GET (một cho từ vựng, một cho
 * reading) và không ghi gì: mọi node đều nhận lại được, mọi trạng thái đều đã
 * khớp. Nhờ vậy để nó chạy tự động mỗi lần mở app là chấp nhận được.
 */
export function useLifeManagementSync(api: DataApi, reading: ReadingDataApi): LifeManagementSyncApi {
  const config = reading.data.lifeManagement;
  const [state, setState] = useState<LifeManagementSyncState>("idle");
  const [message, setMessage] = useState("");

  // Đọc dữ liệu qua ref trong lúc chạy: một lượt đồng bộ kéo dài hàng chục
  // request, không thể để nó khoá cứng vào ảnh dữ liệu tại thời điểm bấm.
  const latest = useRef({ api, reading });
  latest.current = { api, reading };
  const running = useRef(false);
  const lastDone = useRef("");

  const sets = api.data.sets.filter((set) => !isStarSet(set));
  // Vân tay: đủ để phát hiện mọi thay đổi ảnh hưởng tới cây bên kia, và không
  // đổi khi người dùng chỉ sửa nội dung thẻ.
  const fingerprint = [
    api.data.lists.map((list) => `${list.id}:${list.title}`).join(","),
    sets.map((set) => `${set.id}:${set.title}:${set.listId ?? ""}:${getCompletedSetModes(set, api.data.results).join("+")}`).join(","),
    reading.data.books.map((book) => `${book.id}:${book.passages.length}`).join(","),
    [...new Set(reading.data.attempts.map((attempt) => attempt.passageId))].sort().join(","),
  ].join("|");

  const run = useCallback(async () => {
    if (running.current) return;
    const { api: liveApi, reading: liveReading } = latest.current;
    const liveConfig = liveReading.data.lifeManagement;
    if (!liveConfig.enabled || !liveConfig.baseUrl.trim()) return;

    running.current = true;
    setState("syncing");
    try {
      const vocab = await syncAllListsToLifeManagement(
        liveConfig,
        liveApi.data.lists,
        (list) => liveApi.data.sets.filter((set) => !isStarSet(set) && set.listId === list.id),
        liveApi.data.results,
      );
      Object.entries(vocab.listTaskIds).forEach(([listId, listTaskId]) => {
        liveApi.markLifeManagementSynced(listId, listTaskId, vocab.setTaskIds);
      });

      const books = await syncBooksToLifeManagement(liveConfig, liveReading.data.books, liveReading.data.attempts);
      Object.entries(books.bookTaskIds).forEach(([bookId, bookTaskId]) => {
        liveReading.markBookSynced(bookId, bookTaskId, books.passageTaskIds[bookId] ?? {});
      });

      const created = vocab.createdCount + books.createdCount;
      const done = vocab.completedCount + books.completedCount;
      const reopened = vocab.reopenedCount + books.reopenedCount;
      setState("idle");
      setMessage(
        created || done || reopened
          ? `Đã đồng bộ Life Management: tạo mới ${created} node, đánh dấu hoàn thành ${done}, mở lại ${reopened}.`
          : "Life Management đã khớp, không có gì phải đổi.",
      );
    } catch (error) {
      // Mạng hỏng hay Life Management đang ngủ không được phép làm gãy web từ
      // vựng — lượt sau, hoặc nút bấm tay trong Settings, sẽ bù lại.
      console.warn("Không đồng bộ được sang Life Management:", error);
      setState("error");
      setMessage(`Chưa đồng bộ được: ${error instanceof Error ? error.message : error}`);
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    if (!config.enabled || !config.baseUrl.trim()) return;
    if (lastDone.current === fingerprint) return;
    // Hoãn một nhịp: dữ liệu vừa nạp từ Google Sheet hoặc vừa nhập một loạt set
    // sẽ đổi liên tiếp vài lần, đợi nó đứng yên rồi mới đẩy một lượt duy nhất.
    const timer = window.setTimeout(() => {
      lastDone.current = fingerprint;
      void run();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [fingerprint, config.enabled, config.baseUrl, run]);

  const syncNow = useCallback(() => {
    lastDone.current = fingerprint;
    void run();
  }, [fingerprint, run]);

  return { state, message, syncNow };
}
