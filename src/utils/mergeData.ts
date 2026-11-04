import { AppData, StudyResult } from "../types";
import type { PendingChanges } from "./storage";

/**
 * Gộp dữ liệu Google Sheet với dữ liệu trên máy khi máy này còn thay đổi CHƯA
 * kịp đồng bộ (lần lưu trước lỗi, mất mạng, đóng tab giữa chừng).
 *
 * Trước đây tải lại trang là thay thế hẳn bằng bản cloud, nên mọi lượt học vừa
 * hoàn thành mà chưa lên được cloud đều biến mất — trạng thái "hoàn thành" của
 * set quay về chưa xanh. Gộp thì không bên nào mất gì:
 *  - kết quả học: hợp theo id (id là UUID nên không trùng nhầm);
 *  - set: hợp theo id; set có ở cả hai bên thì lấy bản mới hơn theo updatedAt,
 *    bằng nhau thì lấy bản trên máy (bản có thay đổi chưa đồng bộ);
 *  - danh sách: hợp theo id; thời gian ghép thẻ tốt nhất: lấy số nhỏ hơn;
 *  - set/danh sách người dùng đã XOÁ trên máy này từ lần đồng bộ trước (deleted)
 *    thì bỏ khỏi bản gộp, nếu không việc hợp sẽ làm chúng sống lại từ cloud.
 */
export function mergeAppData(cloud: AppData, local: AppData, deleted: Pick<PendingChanges, "sets" | "lists"> = { sets: [], lists: [] }): AppData {
  const deletedSets = new Set(deleted.sets);
  const deletedLists = new Set(deleted.lists);
  const resultsById = new Map<string, StudyResult>();
  for (const result of [...cloud.results, ...local.results]) resultsById.set(result.id, result);
  const results = [...resultsById.values()]
    .filter((result) => result.mode === "listening" || !("setId" in result) || !String(result.setId).split(",").every((id) => deletedSets.has(id)))
    .sort((a, b) => b.studiedAt.localeCompare(a.studiedAt));

  const sets = new Map(cloud.sets.map((set) => [set.id, set]));
  for (const set of local.sets) {
    const other = sets.get(set.id);
    if (!other || set.updatedAt >= other.updatedAt) sets.set(set.id, set);
  }

  const lists = new Map(cloud.lists.map((list) => [list.id, list]));
  for (const list of local.lists) if (!lists.has(list.id)) lists.set(list.id, list);

  const matchBestTimes = { ...cloud.matchBestTimes };
  for (const [key, time] of Object.entries(local.matchBestTimes)) {
    matchBestTimes[key] = key in matchBestTimes ? Math.min(matchBestTimes[key], time) : time;
  }

  return {
    ...cloud,
    sets: [...sets.values()].filter((set) => !deletedSets.has(set.id)),
    results,
    lists: [...lists.values()].filter((list) => !deletedLists.has(list.id)),
    matchBestTimes,
    settings: local.settings,
  };
}
