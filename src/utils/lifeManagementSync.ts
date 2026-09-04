import { StudyResult, VocabularySet, VocabularySetList } from "../types";
import { LifeManagementConfig, ReadingBook } from "../types/reading";
import { getCompletedSetModes, SetModeKey } from "./study";

/**
 * Bốn node chế độ nằm giữa node danh sách và node set, khớp đúng tên những
 * node người dùng đã dựng sẵn bên Life Management. Các node khác từng có ở đó
 * (RE-LEARN MULTISET, LISTENING) cố ý KHÔNG nằm trong danh sách này: bên web
 * từ vựng không có dữ liệu hoàn thành theo từng set cho chúng — Mix Set trộn
 * nhiều set nên kết quả không thuộc set nào, còn kết quả nghe thì không gắn
 * setId — nên không có gì để đánh dấu, đồng bộ vào chỉ tạo node chết.
 */
export const VOCAB_MODE_NODES: { key: SetModeKey; title: string; aliases?: string[] }[] = [
  { key: "eng-eng", title: "LEARN ENG_ENG" },
  { key: "viet-eng", title: "LEARN VIET_ENG" },
  { key: "eng-viet", title: "LEARN ENG_VIET" },
  // Node chế độ viết bên Life Management đang mang tên "LEARN WRITE" cho khớp
  // ba node kia; "WRITING" là tên của thế hệ cũ, vẫn nhận để không bỏ sót cây
  // nào người dùng đã dựng, nhưng node tạo mới thì dùng tên chuẩn.
  { key: "write", title: "LEARN WRITE", aliases: ["WRITING"] },
];

// Đổ dữ liệu hai web (từ vựng + reading) sang cây task của Life Management.
// Route /api/tasks bên đó đã trả sẵn CORS thoáng và xử lý preflight, nên gọi
// thẳng từ trình duyệt được.

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
  /** passageId (bên app) -> taskId (bên Life Management). */
  passageTaskIds: Record<string, string>;
  passageTaskCount: number;
  completedCount: number;
}

/**
 * Dựng (hoặc nhận lại) node sách bên Life Management cùng các node bài đọc con,
 * rồi đánh dấu hoàn thành những bài đã làm.
 *
 * Cùng nguyên tắc với cây từ vựng: id đã lưu trước → trùng tên trong đúng node
 * cha → mới tạo. Nhờ vậy gọi lại lần hai không đẻ ra cây thứ hai, và một lần
 * hỏng giữa chừng chỉ cần chạy lại là đi tiếp chứ không bỏ lại cây dở dang.
 */
export async function syncBookToLifeManagement(
  config: LifeManagementConfig,
  book: ReadingBook,
  attempts: { passageId: string }[] = [],
): Promise<SyncOutcome> {
  if (!config.baseUrl.trim()) throw new Error("Chưa cấu hình địa chỉ Life Management.");

  const remoteTasks = await fetchTasks(config);
  const byId = new Map(remoteTasks.map((task) => [task.id, task]));
  const childrenOf = (parentId: string) => remoteTasks.filter((task) => task.parent_task_id === parentId);

  const existingBookTask =
    (book.lifeManagementTaskId && byId.get(book.lifeManagementTaskId)) ||
    childrenOf(config.readingTaskId).find((task) => sameTitle(task.title, book.title));

  const bookTaskId = existingBookTask
    ? existingBookTask.id
    : (
        await createTask(config, {
          title: book.title,
          parentTaskId: config.readingTaskId,
          description: `${book.passages.length} bài đọc · nhập từ ${book.sourceFileName}`,
        })
      ).id;

  const bookChildren = existingBookTask ? childrenOf(bookTaskId) : [];
  const attemptedPassages = new Set(attempts.map((attempt) => attempt.passageId));

  const passageTaskIds: Record<string, string> = {};
  let completedCount = 0;
  for (const passage of book.passages) {
    const matched =
      (passage.lifeManagementTaskId && byId.get(passage.lifeManagementTaskId)) ||
      bookChildren.find((task) => sameTitle(task.title, passage.title));

    let passageTaskId: string;
    let remoteStatus: string | undefined;
    if (matched) {
      passageTaskId = matched.id;
      remoteStatus = matched.status ?? undefined;
    } else {
      const created = await createTask(config, {
        title: passage.title.slice(0, 250),
        parentTaskId: bookTaskId,
        description: `${passage.questions.length} câu hỏi`,
      });
      passageTaskId = created.id;
      remoteStatus = "not_completed";
    }
    passageTaskIds[passage.id] = passageTaskId;

    if (attemptedPassages.has(passage.id) && remoteStatus !== "completed") {
      await markTaskCompleted(config, passageTaskId);
      completedCount += 1;
    }
  }

  return {
    bookTaskId,
    passageTaskIds,
    passageTaskCount: Object.keys(passageTaskIds).length,
    completedCount,
  };
}

/** Task đọc về từ Life Management — chỉ lấy đúng những trường cần để đối chiếu. */
interface RemoteTask {
  id: string;
  title: string;
  parent_task_id?: string | null;
  status?: string | null;
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

/**
 * Đánh dấu MỘT node lá là đã hoàn thành. Chỉ dùng được cho node lá: bên Life
 * Management, task có con sẽ từ chối đổi trạng thái vì trạng thái của nó được
 * suy ra từ các con. Nhờ vậy chỉ cần đẩy trạng thái ở tầng set, còn node chế độ
 * và node danh sách tự xanh khi đủ con — không phải đụng tới.
 */
export async function markTaskCompleted(config: LifeManagementConfig, taskId: string): Promise<void> {
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/api/tasks`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: taskId, status: "completed" }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Không đánh dấu được task ${taskId} (${response.status}). ${detail}`);
  }
}

const normalizeTitle = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^vocab[\s_-]+|[\s_-]+vocab$/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();

const sameTitle = (a: string, b: string) => normalizeTitle(a) === normalizeTitle(b);

/** setId -> (chế độ -> taskId của node set nằm dưới node chế độ đó). */
export type SetModeTaskIds = Partial<Record<SetModeKey, string>>;

export interface ListSyncOutcome {
  listTaskId: string;
  setTaskIds: Record<string, SetModeTaskIds>;
  createdCount: number;
  reusedCount: number;
  completedCount: number;
}

/**
 * Đẩy MỘT danh sách từ vựng sang Life Management đúng theo cây ba tầng mà
 * người dùng đang dùng bên đó:
 *
 *   danh sách (vd. vocab_15_day_practice)
 *     └─ node chế độ (LEARN ENG_VIET, LEARN ENG_ENG, LEARN VIET_ENG, WRITING)
 *          └─ node set (vd. 15_day_practice_01)
 *
 * Cùng một set xuất hiện dưới cả bốn node chế độ, mỗi bản là một task riêng —
 * đó mới là thứ đánh dấu được: "set 01 xong chế độ eng-viet" tick node set 01
 * nằm dưới LEARN ENG_VIET, không đụng ba bản còn lại.
 *
 * Chạy lại nhiều lần không sinh bản sao. Thứ tự tìm node đã có:
 *   1. Id đã lưu từ lần đồng bộ trước — vẫn phải kiểm tra id đó còn tồn tại
 *      bên kia, vì node có thể đã bị xoá tay.
 *   2. Trùng tên trong đúng node cha, so sau khi chuẩn hoá dấu ngăn cách nên
 *      "15-Day Practice" nhận đúng node "vocab_15_day_practice" người dùng đã
 *      tự dựng, thay vì đẻ thêm một cây thứ hai y hệt bên cạnh.
 *   3. Không thấy thì mới tạo mới.
 */
export async function syncSetListToLifeManagement(
  config: LifeManagementConfig,
  list: VocabularySetList,
  sets: VocabularySet[],
  results: StudyResult[],
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
  let completedCount = 0;

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

  // Con của node danh sách đọc lại từ dữ liệu vừa tải: node danh sách vừa tạo
  // thì đương nhiên chưa có con nào.
  const listChildren = existingListTask ? childrenOf(listTaskId) : [];
  const completedBySet = new Map(sets.map((set) => [set.id, new Set<SetModeKey>(getCompletedSetModes(set, results))]));
  const setTaskIds: Record<string, SetModeTaskIds> = {};

  for (const mode of VOCAB_MODE_NODES) {
    const modeTitles = [mode.title, ...(mode.aliases ?? [])];
    const existingModeTask = modeTitles.reduce<RemoteTask | undefined>(
      (found, title) => found ?? listChildren.find((task) => sameTitle(task.title, title)),
      undefined,
    );

    let modeTaskId: string;
    let modeChildren: RemoteTask[] = [];
    if (existingModeTask) {
      modeTaskId = existingModeTask.id;
      modeChildren = childrenOf(modeTaskId);
      reusedCount += 1;
    } else {
      const created = await createTask(config, {
        title: mode.title,
        parentTaskId: listTaskId,
        description: `${sets.length} học phần`,
      });
      modeTaskId = created.id;
      createdCount += 1;
    }

    for (const set of sets) {
      const storedId = set.lifeManagementTaskIds?.[mode.key];
      const matched =
        (storedId && byId.get(storedId)) || modeChildren.find((task) => sameTitle(task.title, set.title));

      let setTaskId: string;
      let remoteStatus: string | undefined;
      if (matched) {
        setTaskId = matched.id;
        remoteStatus = matched.status ?? undefined;
        reusedCount += 1;
      } else {
        const created = await createTask(config, {
          title: set.title.slice(0, 250),
          parentTaskId: modeTaskId,
          description: `${set.cards.length} từ`,
        });
        setTaskId = created.id;
        remoteStatus = "not_completed";
        createdCount += 1;
      }

      setTaskIds[set.id] = { ...setTaskIds[set.id], [mode.key]: setTaskId };

      if (completedBySet.get(set.id)?.has(mode.key) && remoteStatus !== "completed") {
        await markTaskCompleted(config, setTaskId);
        completedCount += 1;
      }
    }
  }

  return { listTaskId, setTaskIds, createdCount, reusedCount, completedCount };
}

/**
 * Đẩy trạng thái "hoàn thành" cho một loạt node lá đã biết id, dùng cho việc
 * đồng bộ tự động khi người dùng vừa học xong một chế độ.
 *
 * Đọc trạng thái hiện tại bên kia trước bằng MỘT lần GET rồi chỉ PUT những
 * node thật sự còn đang dở: tránh bắn hàng chục request thừa mỗi lần mở app,
 * và cũng tránh ghi đè lên node đã bị xoá tay (id không còn thì bỏ qua).
 */
export async function pushCompletedTasks(config: LifeManagementConfig, taskIds: string[]): Promise<number> {
  if (!config.baseUrl.trim() || !taskIds.length) return 0;
  const remote = await fetchTasks(config);
  const statusById = new Map(remote.map((task) => [task.id, task.status ?? undefined]));

  let pushed = 0;
  for (const taskId of taskIds) {
    if (!statusById.has(taskId) || statusById.get(taskId) === "completed") continue;
    await markTaskCompleted(config, taskId);
    pushed += 1;
  }
  return pushed;
}

/** Cheap reachability probe so the settings panel can confirm the URL works. */
export async function pingLifeManagement(config: LifeManagementConfig): Promise<boolean> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/api/tasks?userId=${encodeURIComponent(config.userId)}`;
  const response = await fetch(url, { method: "GET" });
  return response.ok;
}
