import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppData, VocabularySet } from "../types";
import { clearPendingChanges, hasUnsyncedChanges, loadAppData, loadPendingChanges, saveAppData, setUnsyncedChanges, STORAGE_KEY, updatePendingChanges } from "../utils/storage";
import { mergeAppData } from "../utils/mergeData";
import { loadFromGoogleSheet, saveToGoogleSheet } from "../utils/cloudSync";
import { syncStarSets } from "../utils/starSets";
import { syncSetLists } from "../utils/setLists";

// Một thông báo DUY NHẤT cho mọi kiểu lỗi lưu localStorage — dù là hết dung
// lượng (ném lỗi rõ ràng) hay bị chặn kiểu "ghi giả" (không ném lỗi gì, chỉ
// đơn giản là không lưu được, thường gặp trên iPad khi Safari bật "Chặn tất
// cả cookie" hoặc đang ở chế độ Duyệt web riêng tư). Gộp làm một thay vì tách
// theo nội dung lỗi cho khỏi phải đoán đúng loại Error mà trình duyệt ném ra.
const STORAGE_FAILED_MESSAGE = "Không lưu được vào bộ nhớ máy — localStorage có thể đã đầy, hoặc trình duyệt đang chặn/xoá bộ nhớ lưu trữ. Dữ liệu vẫn dùng được trong phiên này nhưng có thể mất khi tải lại trang; hãy Export JSON để sao lưu. Trên iPad: kiểm tra Cài đặt > Safari > Nâng cao, tắt \"Chặn tất cả cookie\" hoặc thoát khỏi chế độ Duyệt web riêng tư.";
const CLOUD_LOAD_FAILED_MESSAGE = "Không tải được dữ liệu Google Sheet, đang dùng dữ liệu trên trình duyệt. Vào Settings bấm \"Đồng bộ\" để thử lại.";
const CLOUD_SAVE_FAILED_MESSAGE = "Không đồng bộ được dữ liệu lên Google Sheet. Dữ liệu vẫn còn trong trình duyệt — vào Settings bấm \"Đồng bộ\" để thử lại.";
// Lỗi lưu localStorage (máy NÀY không giữ được dữ liệu) nghiêm trọng hơn và
// độc lập với lỗi cloud (Google Sheet) — một cái thành công không có nghĩa là
// cái kia cũng ổn, nên mỗi phía chỉ được tự xoá đúng thông báo của mình, tránh
// tình huống cloud sync xong lại xoá mất luôn cảnh báo "máy này đang chặn lưu
// trữ" mà người dùng vẫn cần thấy.
const LOCAL_STORAGE_MESSAGES = [STORAGE_FAILED_MESSAGE];
const CLOUD_MESSAGES = [CLOUD_LOAD_FAILED_MESSAGE, CLOUD_SAVE_FAILED_MESSAGE];

// Cả hai đường đồng bộ luôn chạy CÙNG NHAU và theo ĐÚNG THỨ TỰ này: star sets
// có thể tạo/xoá set (star-set mới hoặc rỗng đi), nên danh sách phải được
// đồng bộ SAU, dựa trên tập set đã ổn định — nếu đảo ngược, một set sao vừa
// sinh ra ở lượt này sẽ chưa có listId cho tới tận lượt gọi kế tiếp.
function syncDerivedData(data: AppData): AppData {
  return syncSetLists(syncStarSets(data));
}

export function useAppData() {
  // Đồng bộ ngay từ dữ liệu đọc lên: cache có thể được ghi từ một bản cũ chưa
  // có tính năng này, hoặc từ một máy khác, nên các set sao và danh sách phải
  // được dựng lại theo đúng dữ liệu hiện có thay vì tin vào những gì đã lưu.
  const [data, setReactData] = useState<AppData>(() => syncDerivedData(loadAppData()));
  const dataRef = useRef(data);
  const [syncState, setSyncState] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [syncError, setSyncError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  // Còn thay đổi trên máy này chưa lên Google Sheet.
  const [unsynced, setUnsynced] = useState(() => hasUnsyncedChanges());

  useEffect(() => {
    dataRef.current = data;
    document.documentElement.classList.toggle("dark", data.settings.theme === "dark");
  }, [data]);

  /**
   * Đồng bộ TOÀN BỘ dữ liệu từ vựng với Google Sheet. Chỉ chạy ở hai thời điểm:
   * lúc mở web và khi người dùng bấm nút "Đồng bộ" trong Settings — không còn
   * lưu sau mỗi thao tác, thử lại nền, hay làm mới định kỳ (mỗi cái là một
   * request, và dữ liệu ~1,5MB).
   *
   *  - Máy không có thay đổi chưa đồng bộ: lấy bản cloud (thấy được những gì
   *    thiết bị khác vừa làm), không cần ghi gì.
   *  - Máy có thay đổi: GỘP với cloud rồi đẩy bản gộp lên, để không bên nào mất.
   *  - Vừa reset/nhập file/xoá hết: bản trên máy là bản đúng, đẩy lên thay thế.
   */
  const syncingRef = useRef(false);
  const syncNow = useCallback(async (): Promise<boolean> => {
    if (syncingRef.current) return false;
    syncingRef.current = true;
    setSyncState("loading");
    let stage: "load" | "save" = "load";
    try {
      const cloud = await loadFromGoogleSheet();
      const local = dataRef.current;
      // Cloud trả về TRỐNG trong khi máy này đang có bộ từ: gần như chắc chắn
      // là đang đọc đúng lúc sheet bị lỗi, không phải người dùng thực sự đã xoá
      // hết. Tuyệt đối không ghi đè dữ liệu trên máy.
      if (cloud.sets.length === 0 && local.sets.some((set) => set.cards.length > 0)) {
        throw new Error("Google Sheet returned empty data while local data has sets");
      }
      const pending = loadPendingChanges();
      const dirty = hasUnsyncedChanges();
      const next = syncDerivedData(pending.replace ? local : dirty ? mergeAppData(cloud, local, pending) : cloud);
      // Không đổi gì thì không thay state: cập nhật sẽ làm trang đang mở dựng lại.
      let base = local;
      if (next !== local && JSON.stringify(next) !== JSON.stringify(local)) {
        base = next;
        dataRef.current = next;
        saveAppData(next);
        setReactData(next);
      }
      if (pending.replace || dirty) {
        stage = "save";
        setSyncState("saving");
        await saveToGoogleSheet(base, pending.replace);
        // Người dùng sửa tiếp trong lúc đang đẩy lên thì phần sửa đó chưa lên
        // cloud: giữ nguyên cờ để lần đồng bộ sau gộp nốt.
        if (dataRef.current === base) {
          clearPendingChanges();
          setUnsyncedChanges(false);
          setUnsynced(false);
        }
      }
      setSyncState("idle");
      setSyncError((current) => (CLOUD_MESSAGES.includes(current) ? "" : current));
      setLastSyncedAt(Date.now());
      return true;
    } catch (error) {
      console.error(stage === "load" ? "Google Sheet sync load failed." : "Google Sheet sync save failed.", error);
      setSyncState("error");
      setSyncError((current) => (LOCAL_STORAGE_MESSAGES.includes(current) ? current : stage === "load" ? CLOUD_LOAD_FAILED_MESSAGE : CLOUD_SAVE_FAILED_MESSAGE));
      return false;
    } finally {
      syncingRef.current = false;
    }
  }, []);

  // Mở web = một lần đồng bộ.
  useEffect(() => {
    void syncNow();
  }, [syncNow]);

  const setData = useCallback<Dispatch<SetStateAction<AppData>>>((nextOrUpdater) => {
    const current = dataRef.current;
    const updated = typeof nextOrUpdater === "function" ? (nextOrUpdater as (current: AppData) => AppData)(current) : nextOrUpdater;
    // Danh sách từ khó nhớ và danh sách (thư mục) chứa set được dựng lại ở
    // ĐÂY, trên đường ghi chung, thay vì ở từng nút bấm — một chỗ quên gọi là
    // dữ liệu suy ra lệch với thực tế.
    const next = syncDerivedData(updated);
    dataRef.current = next;
    try {
      const serialized = saveAppData(next);
      // Một số trình duyệt/WebView bị hạn chế lưu trữ (thường gặp nhất trên
      // iPad khi Safari bật "Chặn tất cả cookie" hoặc đang ở chế độ Duyệt web
      // riêng tư) không ném lỗi khi ghi localStorage — setItem() chạy "thành
      // công" nhưng không thực sự lưu gì cả. So khớp lại đúng nội dung vừa ghi
      // để bắt được kiểu ghi-giả này, thứ mà try/catch một mình không phát
      // hiện ra — đây chính là dạng lỗi khiến "học xong một chế độ nhưng
      // không được đánh dấu hoàn thành" mà không hề có ngoại lệ nào ném ra.
      if (localStorage.getItem(STORAGE_KEY) !== serialized) {
        throw new Error("localStorage.setItem silently no-op'd or was reverted");
      }
      // Functional form: đọc trạng thái MỚI NHẤT chứ không phải giá trị đã đóng gói.
      setSyncError((current) => (LOCAL_STORAGE_MESSAGES.includes(current) ? "" : current));
    } catch (error) {
      // Không alert(): một hộp thoại chặn cả luồng JS sẽ hiện lại ở MỌI thao
      // tác tiếp theo hễ localStorage vẫn còn đầy (thêm từ, trả lời Learn...),
      // biến thành "web đứng hình liên tục đòi đồng bộ" trên máy đã đầy dung
      // lượng — nhất là điện thoại, nơi hạn mức localStorage nhỏ hơn máy tính.
      // Dữ liệu vẫn cập nhật đúng trong bộ nhớ (setReactData ở dưới), chỉ là
      // không được lưu lại cho lần mở sau; báo lỗi qua banner đã có sẵn thay
      // vì chặn đứng người dùng.
      console.error("Không thể lưu dữ liệu vào trình duyệt.", error);
      setSyncState("error");
      setSyncError(STORAGE_FAILED_MESSAGE);
    }
    // Chỉ đánh dấu "có thay đổi chưa đồng bộ" — KHÔNG gọi mạng. Lên cloud ở lần
    // mở web kế tiếp hoặc khi bấm "Đồng bộ".
    setUnsyncedChanges(true);
    setUnsynced(true);
    setReactData(next);
  }, []);

  const api = useMemo(() => ({
    upsertSet(set: VocabularySet) {
      setData((current) => {
        const exists = current.sets.some((item) => item.id === set.id);
        return { ...current, sets: exists ? current.sets.map((item) => (item.id === set.id ? set : item)) : [set, ...current.sets] };
      });
    },
    deleteSet(id: string) {
      updatePendingChanges((pending) => ({ ...pending, sets: [...pending.sets, id] }));
      setData((current) => ({
        ...current,
        sets: current.sets.filter((set) => set.id !== id),
        results: current.results.filter((result) => result.mode === "listening" || result.setId !== id),
      }));
    },
    updateSet(id: string, updater: (set: VocabularySet) => VocabularySet) {
      setData((current) => ({ ...current, sets: current.sets.map((set) => (set.id === id ? updater(set) : set)) }));
    },
    createList(title: string): string {
      const id = crypto.randomUUID();
      setData((current) => ({
        ...current,
        lists: [...current.lists, { id, title, createdAt: new Date().toISOString() }],
      }));
      return id;
    },
    renameList(id: string, title: string) {
      setData((current) => ({
        ...current,
        lists: current.lists.map((list) => (list.id === id ? { ...list, title } : list)),
      }));
    },
    // Chỉ xoá được danh sách RỖNG — set không tự động rơi vào "Mobile Set"
    // hay biến mất, tránh người dùng lỡ tay xoá cả một mảng nội dung. Trang
    // gọi hàm này nên tự kiểm tra rỗng trước và hỏi xác nhận.
    deleteList(id: string) {
      updatePendingChanges((pending) => ({ ...pending, lists: [...pending.lists, id] }));
      setData((current) => ({ ...current, lists: current.lists.filter((list) => list.id !== id) }));
    },
    /**
     * Ghi lại kết quả đồng bộ sang Life Management trong MỘT lần ghi: id node
     * cha (danh sách) và id các node con (set). Gộp chung thay vì gọi từng set
     * một để chỉ phát sinh một lần lưu và một lần đẩy lên Google Sheet.
     */
    markLifeManagementSynced(
      listId: string,
      listTaskId: string,
      setTaskIds: Record<string, Record<string, string>>,
    ) {
      setData((current) => ({
        ...current,
        lists: current.lists.map((list) => (list.id === listId ? { ...list, lifeManagementTaskId: listTaskId } : list)),
        sets: current.sets.map((set) =>
          setTaskIds[set.id]
            ? { ...set, lifeManagementTaskIds: { ...set.lifeManagementTaskIds, ...setTaskIds[set.id] } }
            : set,
        ),
      }));
    },
    replaceData(next: AppData) {
      updatePendingChanges((pending) => ({ ...pending, replace: true }));
      setData(next);
    },
    resetProgress() {
      updatePendingChanges((pending) => ({ ...pending, replace: true }));
      setData((current) => ({
        ...current,
        results: [],
        matchBestTimes: {},
        sets: current.sets.map((set) => ({
          ...set,
          cards: set.cards.map((card) => ({ ...card, status: "new", correctCount: 0, mistakeCount: 0, lastStudiedAt: undefined, nextReviewAt: undefined })),
        })),
      }));
    },
    clearAll() {
      updatePendingChanges((pending) => ({ ...pending, replace: true }));
      setData({ sets: [], results: [], matchBestTimes: {}, lists: [], settings: { theme: "light", voiceURI: "" } });
    },
    setTheme(theme: "light" | "dark") {
      setData((current) => ({ ...current, settings: { ...current.settings, theme } }));
    },
    setVoice(voiceURI: string) {
      setData((current) => ({ ...current, settings: { ...current.settings, voiceURI } }));
    },
    recordMatchTime(setId: string, seconds: number) {
      setData((current) => {
        const previous = current.matchBestTimes[setId];
        if (previous && previous <= seconds) return current;
        return { ...current, matchBestTimes: { ...current.matchBestTimes, [setId]: seconds } };
      });
    },
  }), [setData]);

  return { data, setData, syncState, syncError, syncNow, lastSyncedAt, unsynced, ...api };
}
