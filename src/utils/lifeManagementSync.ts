import { VocabularySet, VocabularySetList } from "../types";
import { LifeManagementConfig, ReadingBook } from "../types/reading";

// Mirrors a parsed book into the Life Management task tree: one node named
// after the book under READING, and one child node per passage. Life
// Management's /api/tasks route already sends permissive CORS headers and
// handles the preflight, so this can be called straight from the browser.

interface CreatedTask {
  id: string;
  title: string;
}

async function createTask(
  config: LifeManagementConfig,
  payload: { title: string; parentTaskId: string; description?: string },
): Promise<CreatedTask> {
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: config.userId,
      topicId: config.topicId,
      parentTaskId: payload.parentTaskId,
      title: payload.title,
      description: payload.description,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Life Management refused the task "${payload.title}" (${response.status}). ${detail}`);
  }
  return (await response.json()) as CreatedTask;
}

export interface SyncOutcome {
  bookTaskId: string;
  passageTaskCount: number;
}

/**
 * Creates the book node then its passage children in order. The book node is
 * created first and its id returned even if a later passage fails, so a retry
 * does not orphan a half-built tree — the caller stores the id and can see
 * which passages already exist.
 */
export async function syncBookToLifeManagement(config: LifeManagementConfig, book: ReadingBook): Promise<SyncOutcome> {
  if (!config.baseUrl.trim()) throw new Error("Chưa cấu hình địa chỉ Life Management.");

  const bookTask = await createTask(config, {
    title: book.title,
    parentTaskId: config.readingTaskId,
    description: `${book.passages.length} bài đọc · nhập từ ${book.sourceFileName}`,
  });

  let passageTaskCount = 0;
  for (const passage of book.passages) {
    await createTask(config, {
      title: passage.title.slice(0, 250),
      parentTaskId: bookTask.id,
      description: `${passage.questions.length} câu hỏi`,
    });
    passageTaskCount += 1;
  }

  return { bookTaskId: bookTask.id, passageTaskCount };
}

/** Task đọc về từ Life Management — chỉ lấy đúng những trường cần để đối chiếu. */
interface RemoteTask {
  id: string;
  title: string;
  parent_task_id?: string | null;
}

async function fetchTasks(config: LifeManagementConfig): Promise<RemoteTask[]> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/api/tasks?userId=${encodeURIComponent(config.userId)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Không đọc được danh sách task từ Life Management (${response.status}).`);
  }
  const rows = (await response.json()) as RemoteTask[];
  return Array.isArray(rows) ? rows : [];
}

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface ListSyncOutcome {
  listTaskId: string;
  /** setId (bên app từ vựng) -> taskId (bên Life Management). */
  setTaskIds: Record<string, string>;
  createdCount: number;
  reusedCount: number;
}

/**
 * Đẩy MỘT danh sách từ vựng sang Life Management đúng theo cấu trúc cây:
 * danh sách là node CHA, mỗi set bên trong là một node CON.
 *
 * Chạy lại nhiều lần không sinh ra bản sao. Thứ tự tìm node đã có:
 *   1. Id đã lưu từ lần đồng bộ trước — nhưng vẫn phải kiểm tra id đó còn tồn
 *      tại bên kia, vì node có thể đã bị xoá tay.
 *   2. Trùng tên trong đúng node cha — nhờ vậy nó NHẬN luôn những node người
 *      dùng đã tự tạo sẵn (kiểu Cam_vocab → cam_economy) thay vì dựng thêm
 *      một cây thứ hai y hệt bên cạnh.
 *   3. Không thấy thì mới tạo mới.
 */
export async function syncSetListToLifeManagement(
  config: LifeManagementConfig,
  list: VocabularySetList,
  sets: VocabularySet[],
): Promise<ListSyncOutcome> {
  if (!config.baseUrl.trim()) throw new Error("Chưa cấu hình địa chỉ Life Management.");
  // Cấu hình lưu từ trước khi có trường này sẽ được readingStorage điền mặc
  // định, nhưng vẫn đọc phòng thủ để một cấu hình cũ không làm nổ TypeError.
  const vocabParentId = (config.vocabTaskId ?? "").trim();
  if (!vocabParentId) throw new Error("Chưa cấu hình node cha cho danh sách từ vựng.");

  const remoteTasks = await fetchTasks(config);
  const byId = new Map(remoteTasks.map((task) => [task.id, task]));
  const childrenOf = (parentId: string) => remoteTasks.filter((task) => task.parent_task_id === parentId);

  let createdCount = 0;
  let reusedCount = 0;

  const existingListTask =
    (list.lifeManagementTaskId && byId.get(list.lifeManagementTaskId)) ||
    childrenOf(vocabParentId).find((task) => sameTitle(task.title, list.title));

  let listTaskId: string;
  if (existingListTask) {
    listTaskId = existingListTask.id;
    reusedCount += 1;
  } else {
    const created = await createTask(config, {
      title: list.title.slice(0, 250),
      parentTaskId: vocabParentId,
      description: `${sets.length} học phần từ vựng`,
    });
    listTaskId = created.id;
    createdCount += 1;
  }

  // Con của node danh sách được đọc lại từ dữ liệu vừa tải: nếu node danh sách
  // vừa mới tạo thì đương nhiên chưa có con nào.
  const existingChildren = existingListTask ? childrenOf(listTaskId) : [];

  const setTaskIds: Record<string, string> = {};
  for (const set of sets) {
    const matched =
      (set.lifeManagementTaskId && byId.get(set.lifeManagementTaskId)) ||
      existingChildren.find((task) => sameTitle(task.title, set.title));

    if (matched) {
      setTaskIds[set.id] = matched.id;
      reusedCount += 1;
      continue;
    }

    const created = await createTask(config, {
      title: set.title.slice(0, 250),
      parentTaskId: listTaskId,
      description: `${set.cards.length} từ`,
    });
    setTaskIds[set.id] = created.id;
    createdCount += 1;
  }

  return { listTaskId, setTaskIds, createdCount, reusedCount };
}

/** Cheap reachability probe so the settings panel can confirm the URL works. */
export async function pingLifeManagement(config: LifeManagementConfig): Promise<boolean> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/api/tasks?userId=${encodeURIComponent(config.userId)}`;
  const response = await fetch(url, { method: "GET" });
  return response.ok;
}
