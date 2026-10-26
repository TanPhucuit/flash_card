import { VocabularyCard, VocabularySet } from "../types";

/** Một gói set dựng sẵn đi kèm bản deploy (file JSON trong public/). */
export interface BundledPack {
  key: string;
  file: string;
  title: string;
  description: string;
  listLabel: string;
}

export const BUNDLED_PACKS: BundledPack[] = [
  {
    key: "high_level",
    file: "/high-level-sets.json",
    title: "Bộ từ vựng High-Level (IELTS Reading)",
    description: "25 set × 20 từ: từ vựng nâng cao, thành ngữ, từ đa nghĩa và nghĩa hiếm hay gặp trong IELTS Reading.",
    listLabel: "High-Level",
  },
  {
    key: "synonym",
    file: "/synonym-sets.json",
    title: "Cụm từ đồng nghĩa nâng cao",
    description: "15 set × 20 thẻ (100 cụm × 3 thẻ): cụm → cách nói đơn giản, và từng từ thành phần → nghĩa tiếng Việt, xáo trộn ngẫu nhiên.",
    listLabel: "Synonym Phrases",
  },
];

type PackSet = Pick<VocabularySet, "id" | "title" | "description" | "tags"> & { cards: VocabularyCard[] };
interface PackFile {
  listId: string;
  sets: PackSet[];
}

export async function loadPack(pack: BundledPack, signal?: AbortSignal): Promise<PackFile> {
  const response = await fetch(pack.file, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as PackFile;
}

/**
 * Các set của gói CHƯA có trong dữ liệu (so theo id), sẵn sàng để upsert.
 * Id cố định nên bấm nhập nhiều lần cũng không tạo trùng; thời điểm tạo cách
 * nhau 1ms để thứ tự 01..N được giữ nguyên trong danh sách.
 */
export function missingPackSets(file: PackFile, existing: VocabularySet[]): VocabularySet[] {
  const have = new Set(existing.map((set) => set.id));
  const base = Date.now();
  return file.sets
    .filter((set) => !have.has(set.id))
    .map((set, index) => {
      const stamp = new Date(base + index).toISOString();
      return { ...set, listId: file.listId, createdAt: stamp, updatedAt: stamp };
    });
}
