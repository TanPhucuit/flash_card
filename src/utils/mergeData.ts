import { AppData, StudyResult } from "../types";

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
 *  - danh sách: hợp theo id; thời gian ghép thẻ tốt nhất: lấy số nhỏ hơn.
 */
export function mergeAppData(cloud: AppData, local: AppData): AppData {
  const resultsById = new Map<string, StudyResult>();
  for (const result of [...cloud.results, ...local.results]) resultsById.set(result.id, result);
  const results = [...resultsById.values()].sort((a, b) => b.studiedAt.localeCompare(a.studiedAt));

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

  return { ...cloud, sets: [...sets.values()], results, lists: [...lists.values()], matchBestTimes, settings: local.settings };
}
