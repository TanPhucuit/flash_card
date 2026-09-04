import { useEffect, useRef } from "react";
import { DataApi, ReadingDataApi } from "../App";
import { pushCompletedTasks } from "../utils/lifeManagementSync";
import { getCompletedSetModes } from "../utils/study";
import { isStarSet } from "../utils/starSets";

/**
 * Đẩy trạng thái hoàn thành sang Life Management NGAY khi nó xảy ra, không đợi
 * người dùng bấm nút đồng bộ: học xong chế độ eng-viet của 15_day_practice_01
 * thì node 15_day_practice_01 nằm dưới LEARN ENG_VIET bên kia tự xanh.
 *
 * Chỉ quan tâm những cặp (set, chế độ) đã có id task — tức là danh sách đó đã
 * được đồng bộ ít nhất một lần. Chưa đồng bộ thì không có gì để đánh dấu, và
 * hook này cố ý KHÔNG tự tạo node: tạo cây là việc của nút đồng bộ, để việc mở
 * app không bao giờ tự đẻ task bên Life Management.
 *
 * Effect chỉ chạy lại khi tập cặp-đã-hoàn-thành thật sự đổi (so bằng chuỗi
 * khoá đã sắp xếp), nên mở app rồi ngồi yên sẽ không sinh request nào.
 */
export function useLifeManagementStatusSync(api: DataApi, reading: ReadingDataApi) {
  const config = reading.data.lifeManagement;
  const baseUrl = config.baseUrl;
  const userId = config.userId;

  const vocabTaskIds = api.data.sets
    .filter((set) => !isStarSet(set))
    .flatMap((set) =>
      getCompletedSetModes(set, api.data.results)
        .map((mode) => set.lifeManagementTaskIds?.[mode])
        .filter((taskId): taskId is string => Boolean(taskId)),
    );

  // Bên reading, "hoàn thành" đơn giản là bài đọc đó đã được làm ít nhất một
  // lượt — chấm điểm xong là task tương ứng bên kia xanh.
  const attemptedPassageIds = new Set(reading.data.attempts.map((attempt) => attempt.passageId));
  const readingTaskIds = reading.data.books.flatMap((book) =>
    book.passages
      .filter((passage) => attemptedPassageIds.has(passage.id))
      .map((passage) => passage.lifeManagementTaskId)
      .filter((taskId): taskId is string => Boolean(taskId)),
  );

  const completedTaskIds = [...vocabTaskIds, ...readingTaskIds].sort();
  const fingerprint = completedTaskIds.join(",");

  // Một lần chạy có thể kéo dài nhiều request; nếu dữ liệu đổi giữa chừng thì
  // lần chạy mới sẽ lo nốt, không cần hai lượt chồng lên nhau.
  const running = useRef(false);

  useEffect(() => {
    if (!baseUrl.trim() || !fingerprint || running.current) return;
    running.current = true;
    pushCompletedTasks({ ...config, baseUrl, userId }, fingerprint.split(","))
      .catch((error) => {
        // Hỏng mạng hay Life Management đang ngủ không được phép làm gãy app từ
        // vựng — nút đồng bộ thủ công vẫn bù lại được lần sau.
        console.warn("Không đẩy được trạng thái sang Life Management:", error);
      })
      .finally(() => {
        running.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, baseUrl, userId]);
}
