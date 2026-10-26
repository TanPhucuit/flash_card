import { VocabularyCard, VocabularySet } from "../types";

export const HIGH_LEVEL_LIST_ID = "high_level";

interface HighLevelFile {
  sets: Array<Pick<VocabularySet, "id" | "title" | "description" | "tags"> & { cards: VocabularyCard[] }>;
}

export async function loadHighLevelSets(signal?: AbortSignal): Promise<HighLevelFile["sets"]> {
  const response = await fetch("/high-level-sets.json", { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const file = (await response.json()) as HighLevelFile;
  return file.sets;
}

/**
 * Các set high-level CHƯA có trong dữ liệu (so theo id), sẵn sàng để upsert.
 * Id cố định nên bấm nhập nhiều lần cũng không tạo trùng; thời điểm tạo cách
 * nhau 1ms để thứ tự 01..25 được giữ nguyên trong danh sách.
 */
export function missingHighLevelSets(available: HighLevelFile["sets"], existing: VocabularySet[]): VocabularySet[] {
  const have = new Set(existing.map((set) => set.id));
  const base = Date.now();
  return available
    .filter((set) => !have.has(set.id))
    .map((set, index) => {
      const stamp = new Date(base + index).toISOString();
      return { ...set, listId: HIGH_LEVEL_LIST_ID, createdAt: stamp, updatedAt: stamp };
    });
}
