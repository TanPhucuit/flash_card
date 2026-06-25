import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppData, VocabularySet } from "../types";
import { loadAppData, saveAppData } from "../utils/storage";

export function useAppData() {
  const [data, setReactData] = useState<AppData>(() => loadAppData());
  const dataRef = useRef(data);

  useEffect(() => {
    dataRef.current = data;
    document.documentElement.classList.toggle("dark", data.settings.theme === "dark");
  }, [data]);

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
  }, []);

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
  }), []);

  return { data, setData, ...api };
}
