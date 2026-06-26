import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppData, VocabularySet } from "../types";
import { loadAppData, saveAppData } from "../utils/storage";
import { loadFromGoogleSheet, saveToGoogleSheet } from "../utils/cloudSync";

export function useAppData() {
  const [data, setReactData] = useState<AppData>(() => loadAppData());
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
        dataRef.current = cloudData;
        saveAppData(cloudData);
        setReactData(cloudData);
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
    const next = typeof nextOrUpdater === "function" ? (nextOrUpdater as (current: AppData) => AppData)(current) : nextOrUpdater;
    dataRef.current = next;
    try {
      saveAppData(next);
    } catch (error) {
      console.error("Không thể lưu dữ liệu vào trình duyệt.", error);
      alert("Không thể lưu dữ liệu vào trình duyệt. Có thể localStorage đã đầy hoặc bị chặn. Hãy Export JSON để sao lưu ngay.");
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
        results: current.results.filter((result) => result.setId !== id),
      }));
    },
    updateSet(id: string, updater: (set: VocabularySet) => VocabularySet) {
      setData((current) => ({ ...current, sets: current.sets.map((set) => (set.id === id ? updater(set) : set)) }));
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
      setData({ sets: [], results: [], matchBestTimes: {}, settings: { theme: "light", voiceURI: "" } });
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
