import { AppData, VocabularySet, VocabularySetList } from "../types";
import { isStarSet } from "./starSets";

/**
 * Bốn danh sách mặc định — dữ liệu cũ (tạo trước khi có khái niệm "danh sách")
 * được tự động xếp vào đây theo tên set, để không có set nào biến mất khỏi
 * màn hình sau khi cập nhật.
 */
export const DEFAULT_LISTS: VocabularySetList[] = [
  { id: "mobile_set", title: "Mobile Set", createdAt: "1970-01-01T00:00:00.000Z" },
  { id: "15_day_practice", title: "15-Day Practice", createdAt: "1970-01-01T00:00:00.000Z" },
  { id: "cambridge", title: "Cambridge", createdAt: "1970-01-01T00:00:00.000Z" },
  { id: "c1_c2", title: "C1/C2", createdAt: "1970-01-01T00:00:00.000Z" },
];

const FALLBACK_LIST_ID = "mobile_set";

/**
 * Đoán danh sách phù hợp cho một set CHƯA có listId, dựa theo tên/tag của nó.
 * Chỉ chạy một lần cho mỗi set (khi đã có listId hợp lệ thì giữ nguyên), nên
 * đoán sai một vài trường hợp hiếm không phải là thảm hoạ — set vẫn hiện ra ở
 * "Mobile Set" và người dùng có thể tự chuyển.
 */
function guessListId(set: Pick<VocabularySet, "title" | "tags">): string {
  const haystack = `${set.title} ${set.tags.join(" ")}`.toLowerCase();
  if (/\bc1[_\s-]?c2\b/.test(haystack)) return "c1_c2";
  if (/\b15[_\s-]?day/.test(haystack) || /15\s*ngày/.test(haystack)) return "15_day_practice";
  if (/cambridge/.test(haystack)) return "cambridge";
  return FALLBACK_LIST_ID;
}

/**
 * Đảm bảo 4 danh sách mặc định luôn tồn tại, và mọi set (trừ set sao — xem
 * isStarSet) đều có một listId hợp lệ. Gọi bên trong setData của useAppData,
 * cùng chỗ với syncStarSets, để mọi đường ghi dữ liệu đều đi qua đây.
 */
export function syncSetLists(data: AppData): AppData {
  const listIds = new Set(data.lists.map((list) => list.id));
  const missingDefaults = DEFAULT_LISTS.filter((list) => !listIds.has(list.id));
  const lists = missingDefaults.length ? [...data.lists, ...missingDefaults] : data.lists;
  const validListIds = new Set(lists.map((list) => list.id));

  let changed = missingDefaults.length > 0;
  const sets = data.sets.map((set) => {
    if (isStarSet(set)) return set;
    if (set.listId && validListIds.has(set.listId)) return set;
    changed = true;
    return { ...set, listId: guessListId(set) };
  });

  if (!changed) return data;
  return { ...data, lists, sets };
}
