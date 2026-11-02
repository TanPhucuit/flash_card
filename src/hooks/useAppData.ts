import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppData, VocabularySet } from "../types";
import { hasUnsyncedChanges, loadAppData, saveAppData, setUnsyncedChanges, STORAGE_KEY } from "../utils/storage";
import { mergeAppData } from "../utils/mergeData";
import { appendResultsToGoogleSheet, loadFromGoogleSheet, saveToGoogleSheet } from "../utils/cloudSync";
import { syncStarSets } from "../utils/starSets";
import { syncSetLists } from "../utils/setLists";

// Một thông báo DUY NHẤT cho mọi kiểu lỗi lưu localStorage — dù là hết dung
// lượng (ném lỗi rõ ràng) hay bị chặn kiểu "ghi giả" (không ném lỗi gì, chỉ
// đơn giản là không lưu được, thường gặp trên iPad khi Safari bật "Chặn tất
// cả cookie" hoặc đang ở chế độ Duyệt web riêng tư). Gộp làm một thay vì tách
// theo nội dung lỗi cho khỏi phải đoán đúng loại Error mà trình duyệt ném ra.
const STORAGE_FAILED_MESSAGE = "Không lưu được vào bộ nhớ máy — localStorage có thể đã đầy, hoặc trình duyệt đang chặn/xoá bộ nhớ lưu trữ. Dữ liệu vẫn dùng được trong phiên này nhưng có thể mất khi tải lại trang; hãy Export JSON để sao lưu. Trên iPad: kiểm tra Cài đặt > Safari > Nâng cao, tắt \"Chặn tất cả cookie\" hoặc thoát khỏi chế độ Duyệt web riêng tư.";
const CLOUD_LOAD_FAILED_MESSAGE = "Không tải được dữ liệu Google Sheet, đang dùng dữ liệu cache trên trình duyệt.";
const CLOUD_SAVE_FAILED_MESSAGE = "Không lưu được dữ liệu lên Google Sheet. Dữ liệu vẫn còn trong trình duyệt.";
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
  const cloudSaveTimer = useRef<number | undefined>(undefined);
  const [syncState, setSyncState] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [syncError, setSyncError] = useState("");
  // Bật lên ngay khi người dùng ghi bất kỳ thay đổi nào (setData), TRƯỚC KHI
  // lần tải Google Sheet đầu tiên (chạy song song lúc mở app) kịp trả về. Nếu
  // không có cờ này, một phiên Learn hoàn thành rất nhanh ngay sau khi mở app
  // — ví dụ trên mạng chậm khiến GET Google Sheet mất vài giây — sẽ bị chính
  // kết quả CŨ từ Google Sheet ghi đè mất khi lần tải đó trả về sau, xoá sạch
  // kết quả vừa hoàn thành dù nó đã lưu đúng vào localStorage.
  const hasLocalEditRef = useRef(false);

  useEffect(() => {
    dataRef.current = data;
    document.documentElement.classList.toggle("dark", data.settings.theme === "dark");
  }, [data]);

  const pushToCloudRef = useRef<((next: AppData) => void) | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | undefined;
    const RETRY_DELAYS = [3000, 10000, 30000];

    const attemptLoad = (attempt: number) => {
      setSyncState("loading");
      loadFromGoogleSheet(controller.signal)
        .then((cloudData) => {
          // Cloud trả về TRỐNG trong khi máy này đang có bộ từ: gần như chắc chắn
          // là đang đọc đúng lúc một thiết bị khác ghi dở (hoặc sheet bị lỗi),
          // không phải người dùng thực sự đã xoá hết. Tuyệt đối không ghi đè cache
          // — coi như tải lỗi để thử lại.
          if (cloudData.sets.length === 0 && dataRef.current.sets.some((set) => set.cards.length > 0)) {
            throw new Error("Google Sheet returned empty data while local cache has sets");
          }
          // Máy này có thay đổi chưa lên cloud (lần lưu trước lỗi, hoặc vừa sửa
          // trong lúc đang chờ tải): GỘP chứ không thay thế, rồi đẩy bản gộp
          // lên — nếu không, tải lại trang sẽ xoá mất lượt học vừa hoàn thành.
          const needsMerge = hasLocalEditRef.current || hasUnsyncedChanges();
          const synced = syncDerivedData(needsMerge ? mergeAppData(cloudData, dataRef.current) : cloudData);
          dataRef.current = synced;
          saveAppData(synced);
          setReactData(synced);
          if (needsMerge) pushToCloudRef.current?.(synced);
          setSyncState(needsMerge ? "saving" : "idle");
          setSyncError((current) => (CLOUD_MESSAGES.includes(current) ? "" : current));
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.warn("Google Sheet sync load failed. Using browser cache.", error);
          if (attempt < RETRY_DELAYS.length) {
            retryTimer = window.setTimeout(() => attemptLoad(attempt + 1), RETRY_DELAYS[attempt]);
            return;
          }
          setSyncState("error");
          setSyncError((current) => (LOCAL_STORAGE_MESSAGES.includes(current) ? current : CLOUD_LOAD_FAILED_MESSAGE));
        });
    };

    attemptLoad(0);
    return () => {
      controller.abort();
      window.clearTimeout(retryTimer);
    };
  }, []);

  // Lần lưu cloud gần nhất chưa thành công: dữ liệu chờ đẩy lên. Thử lại với thời
  // gian chờ tăng dần, và thử lại khi có mạng / quay lại tab — trước đây một lần
  // lỗi 500 là bỏ luôn cho tới tận thao tác kế tiếp.
  const pendingSaveRef = useRef<AppData | null>(null);
  // Reset tiến độ / nhập file: kết quả gửi lên là bản đúng, server đừng hợp thêm.
  const replaceResultsRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);

  const pushToCloud = useCallback((next: AppData) => {
    pendingSaveRef.current = next;
    setUnsyncedChanges(true);
    window.clearTimeout(retryTimerRef.current);
    setSyncState("saving");
    saveToGoogleSheet(next, replaceResultsRef.current)
      .then(() => {
        if (pendingSaveRef.current === next) {
          pendingSaveRef.current = null;
          replaceResultsRef.current = false;
          setUnsyncedChanges(false);
        }
        retryAttemptRef.current = 0;
        setSyncState("idle");
        setSyncError((current) => (CLOUD_MESSAGES.includes(current) ? "" : current));
      })
      .catch((error) => {
        console.error("Google Sheet sync save failed.", error);
        setSyncState("error");
        setSyncError((current) => (LOCAL_STORAGE_MESSAGES.includes(current) ? current : CLOUD_SAVE_FAILED_MESSAGE));
        // Chỉ thử lại bản MỚI NHẤT: nếu giữa chừng người dùng đã sửa tiếp thì
        // scheduleCloudSave sẽ đẩy bản mới, không cần đẩy lại bản cũ.
        if (pendingSaveRef.current !== next) return;
        const delay = Math.min(60000, 3000 * 2 ** retryAttemptRef.current);
        retryAttemptRef.current += 1;
        retryTimerRef.current = window.setTimeout(() => {
          if (pendingSaveRef.current === next) pushToCloud(next);
        }, delay);
      });
  }, []);

  useEffect(() => {
    pushToCloudRef.current = pushToCloud;
  }, [pushToCloud]);

  // Làm mới từ cloud khi quay lại tab / có mạng / định kỳ. Trước đây cloud chỉ
  // được đọc MỘT LẦN lúc mở app, nên điện thoại để app mở nền nhiều ngày không
  // bao giờ thấy những gì đã đánh dấu trên máy tính — và còn có thể đẩy bản cũ
  // đó đè lên cloud ở lần lưu kế tiếp.
  useEffect(() => {
    let busy = false;
    let lastAt = Date.now();
    const refresh = async () => {
      // Còn thay đổi chờ lưu: để luồng lưu/thử lại lo trước, đừng đè lên.
      if (busy || pendingSaveRef.current !== null || !navigator.onLine) return;
      if (Date.now() - lastAt < 30_000) return;
      busy = true;
      try {
        const before = dataRef.current;
        const cloud = await loadFromGoogleSheet();
        lastAt = Date.now();
        // Người dùng vừa sửa trong lúc đang tải, hoặc cloud trống bất thường.
        if (dataRef.current !== before || pendingSaveRef.current !== null) return;
        if (cloud.sets.length === 0 && before.sets.some((set) => set.cards.length > 0)) return;
        const synced = syncDerivedData(cloud);
        // Không đổi gì thì thôi: cập nhật state sẽ làm trang đang học dựng lại.
        if (JSON.stringify(synced) === JSON.stringify(before)) return;
        dataRef.current = synced;
        saveAppData(synced);
        setReactData(synced);
      } catch (error) {
        console.warn("Google Sheet refresh failed.", error);
      } finally {
        busy = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const retryNow = () => {
      if (pendingSaveRef.current && navigator.onLine) pushToCloud(pendingSaveRef.current);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retryNow();
    };
    window.addEventListener("online", retryNow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", retryNow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pushToCloud]);

  const scheduleCloudSave = useCallback((next: AppData) => {
    pendingSaveRef.current = next;
    setUnsyncedChanges(true);
    if (cloudSaveTimer.current) window.clearTimeout(cloudSaveTimer.current);
    cloudSaveTimer.current = window.setTimeout(() => pushToCloud(next), 700);
  }, [pushToCloud]);

  const setData = useCallback<Dispatch<SetStateAction<AppData>>>((nextOrUpdater) => {
    hasLocalEditRef.current = true;
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
      // Functional form: đọc trạng thái MỚI NHẤT chứ không phải giá trị đã
      // đóng gói lúc setData được tạo (setData chỉ được tạo lại khi
      // scheduleCloudSave đổi, nên syncError đóng gói ở đây gần như luôn cũ).
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
    setReactData(next);
    // Lượt học vừa hoàn thành: ghi NGAY lên cloud theo đường nhanh (nối thêm một
    // dòng) thay vì chờ bản lưu đầy đủ vài giây, để máy khác tải lại là thấy.
    if (next.results.length > current.results.length) {
      const known = new Set(current.results.map((result) => result.id));
      const fresh = next.results.filter((result) => !known.has(result.id));
      if (fresh.length && fresh.length <= 20) appendResultsToGoogleSheet(fresh).catch((error) => console.warn("Quick result append failed; full save will retry.", error));
    }
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
      replaceResultsRef.current = true;
      setData(next);
    },
    resetProgress() {
      replaceResultsRef.current = true;
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
      replaceResultsRef.current = true;
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
