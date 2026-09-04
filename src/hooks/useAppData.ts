import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppData, VocabularySet } from "../types";
import { loadAppData, saveAppData } from "../utils/storage";
import { loadFromGoogleSheet, saveToGoogleSheet } from "../utils/cloudSync";
import { syncStarSets } from "../utils/starSets";
import { syncSetLists } from "../utils/setLists";

const STORAGE_FULL_MESSAGE = "Không lưu được vào bộ nhớ máy — localStorage có thể đã đầy. Dữ liệu vẫn dùng được trong phiên này; hãy Export JSON để không mất khi tải lại trang.";

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
  const cloudSaveTimer = useRef<number | undefined>(undefined);
  const [syncState, setSyncState] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    dataRef.current = data;
    document.documentElement.classList.toggle("dark", data.settings.theme === "dark");
  }, [data]);

  useEffect(() => {
    const controller = new AbortController();
    setSyncState("loading");
    loadFromGoogleSheet(controller.signal)
      .then((cloudData) => {
        const synced = syncDerivedData(cloudData);
        dataRef.current = synced;
        saveAppData(synced);
        setReactData(synced);
        setSyncState("idle");
        setSyncError("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("Google Sheet sync load failed. Using browser cache.", error);
        setSyncState("error");
        setSyncError("Không tải được dữ liệu Google Sheet, đang dùng dữ liệu cache trên trình duyệt.");
      });
    return () => controller.abort();
  }, []);

  const scheduleCloudSave = useCallback((next: AppData) => {
    if (cloudSaveTimer.current) window.clearTimeout(cloudSaveTimer.current);
    cloudSaveTimer.current = window.setTimeout(() => {
      setSyncState("saving");
      saveToGoogleSheet(next)
        .then(() => {
          setSyncState("idle");
          setSyncError("");
        })
        .catch((error) => {
          console.error("Google Sheet sync save failed.", error);
          setSyncState("error");
          setSyncError("Không lưu được dữ liệu lên Google Sheet. Dữ liệu vẫn còn trong trình duyệt.");
        });
    }, 700);
  }, []);

  const setData = useCallback<Dispatch<SetStateAction<AppData>>>((nextOrUpdater) => {
    const current = dataRef.current;
    const updated = typeof nextOrUpdater === "function" ? (nextOrUpdater as (current: AppData) => AppData)(current) : nextOrUpdater;
    // Danh sách từ khó nhớ và danh sách (thư mục) chứa set được dựng lại ở
    // ĐÂY, trên đường ghi chung, thay vì ở từng nút bấm — một chỗ quên gọi là
    // dữ liệu suy ra lệch với thực tế.
    const next = syncDerivedData(updated);
    dataRef.current = next;
    try {
      saveAppData(next);
      // Functional form: đọc trạng thái MỚI NHẤT chứ không phải giá trị đã
      // đóng gói lúc setData được tạo (setData chỉ được tạo lại khi
      // scheduleCloudSave đổi, nên syncError đóng gói ở đây gần như luôn cũ).
      setSyncError((current) => (current === STORAGE_FULL_MESSAGE ? "" : current));
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
      setSyncError(STORAGE_FULL_MESSAGE);
    }
    setReactData(next);
    scheduleCloudSave(next);
  }, [scheduleCloudSave]);

  const api = useMemo(() => ({
    upsertSet(set: VocabularySet) {
      setData((current) => {
        const exists = current.sets.some((item) => item.id === set.id);
        return { ...current, sets: exists ? current.sets.map((item) => (item.id === set.id ? set : item)) : [set, ...current.sets] };
      });
    },
    deleteSet(id: string) {
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
      setData(next);
    },
    resetProgress() {
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

  return { data, setData, syncState, syncError, ...api };
}
