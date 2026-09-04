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
  // Không đặt \b ở cuối "c2": tên set luôn có hậu tố ngay sau nó (c1_c2_01,
  // c1_c2 unit 3...) và "_" cũng là ký tự "chữ" với regex, nên \b ở đó sẽ
  // KHÔNG khớp giữa "2" và "_" — "c1_c2_01" từng bị trượt mất vì lý do này và
  // rơi hết vào mobile_set.
  if (/\bc1[\s_-]?c2/.test(haystack)) return "c1_c2";
  // "15_day_practice", "15-day"... hoặc tên từng set khi nhập sách 15 ngày,
  // thường chỉ là "Day 1".."Day 15" — không phải lúc nào cũng có số "15" đứng
  // cạnh chữ "day".
  if (
    /\b15[\s_-]?day/.test(haystack) ||
    /15\s*ngày/.test(haystack) ||
    /^day[\s_-]?\d{1,2}\b/.test(haystack)
  ) return "15_day_practice";
  // "cambridge" hoặc viết tắt "cam" (cam_01, cam-1, Cam Unit 2...). "cam" một
  // mình rất ngắn nên chỉ nhận khi đứng đầu tên hoặc đi kèm số, tránh khớp
  // nhầm vào một từ tiếng Việt hay tên khác tình cờ chứa "cam".
  if (
    /cambridge/.test(haystack) ||
    /^cam\b/.test(haystack) ||
    /\bcam[\s_-]?\d/.test(haystack)
  ) return "cambridge";
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
    const hasValidList = Boolean(set.listId && validListIds.has(set.listId));
    // Set đã có một danh sách CỤ THỂ (không phải bucket mặc định mobile_set)
    // thì luôn giữ nguyên — đây có thể là lựa chọn thủ công của người dùng.
    if (hasValidList && set.listId !== FALLBACK_LIST_ID) return set;
    // Set do chính tính năng "Thêm từ nhanh" trên điện thoại tạo ra (tag
    // "Mobile") thực sự THUỘC mobile_set, không phải đoán nhầm — bỏ qua.
    if (hasValidList && set.tags.includes("Mobile")) return set;
    // Còn lại: set nào đang nằm trong mobile_set (dù đã có listId hợp lệ hay
    // chưa từng có) đều được đoán lại mỗi lần đồng bộ. Bản đoán từng có lỗi
    // (ví dụ "c1_c2_01" không khớp vì \b sai) khiến nhiều set bị dồn hết vào
    // đây — sửa quy tắc đoán mà không đoán lại thì các set đã "lỡ" nằm sai
    // chỗ sẽ mắc kẹt vĩnh viễn, vì nhánh phía trên coi listId đó là hợp lệ và
    // không bao giờ tính lại.
    const guessed = guessListId(set);
    if (hasValidList && guessed === set.listId) return set;
    changed = true;
    return { ...set, listId: guessed };
  });

  if (!changed) return data;
  return { ...data, lists, sets };
}
