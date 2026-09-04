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
  reopenedCount: number;
}

export interface BooksSyncOutcome {
  /** bookId -> id node sách bên Life Management. */
  bookTaskIds: Record<string, string>;
  /** bookId -> (passageId -> taskId). */
  passageTaskIds: Record<string, Record<string, string>>;
  createdCount: number;
  reusedCount: number;
  completedCount: number;
  reopenedCount: number;
}

/**
 * Dựng (hoặc nhận lại) node sách bên Life Management cùng các node bài đọc con,
 * rồi phản chiếu trạng thái: bài đã làm ít nhất một lượt thì node tương ứng
 * xanh, ngược lại thì mở lại.
 *
 * Cùng nguyên tắc với cây từ vựng: id đã lưu trước và còn đúng chỗ → trùng tên
 * trong đúng node cha → mới tạo. Nhờ vậy gọi lại lần hai không đẻ ra cây thứ
 * hai, và một lần hỏng giữa chừng chỉ cần chạy lại là đi tiếp.
 */
async function syncBookWithSnapshot(
  config: LifeManagementConfig,
  snapshot: TreeSnapshot,
  book: ReadingBook,
  attemptedPassages: Set<string>,
): Promise<SyncOutcome & { createdCount: number; reusedCount: number }> {
  let createdCount = 0;
  let reusedCount = 0;

  const existingBookTask =
    storedChild(snapshot, book.lifeManagementTaskId, config.readingTaskId) ??
    childrenOf(snapshot, config.readingTaskId).find((task) => sameTitle(task.title, book.title));

  let bookTaskId: string;
  if (existingBookTask) {
    bookTaskId = existingBookTask.id;
    reusedCount += 1;
  } else {
    const created = await createTask(config, {
      title: book.title,
      parentTaskId: config.readingTaskId,
      description: `${book.passages.length} bài đọc · nhập từ ${book.sourceFileName}`,
    });
    bookTaskId = created.id;
    remember(snapshot, {
      id: created.id,
      title: created.title,
      parent_task_id: config.readingTaskId,
      status: "not_completed",
    });
    createdCount += 1;
  }

  const bookChildren = childrenOf(snapshot, bookTaskId);
  const passageTaskIds: Record<string, string> = {};
  let completedCount = 0;
  let reopenedCount = 0;

  for (const passage of book.passages) {
    const matched =
      storedChild(snapshot, passage.lifeManagementTaskId, bookTaskId) ??
      bookChildren.find((task) => sameTitle(task.title, passage.title));

    let passageTask: RemoteTask;
    if (matched) {
      passageTask = matched;
      reusedCount += 1;
    } else {
      const created = await createTask(config, {
        title: passage.title.slice(0, 250),
        parentTaskId: bookTaskId,
        description: `${passage.questions.length} câu hỏi`,
      });
      passageTask = { id: created.id, title: created.title, parent_task_id: bookTaskId, status: "not_completed" };
      remember(snapshot, passageTask);
      createdCount += 1;
    }
    passageTaskIds[passage.id] = passageTask.id;

    const shouldBeDone = attemptedPassages.has(passage.id);
    if (shouldBeDone !== (passageTask.status === "completed")) {
      const next = shouldBeDone ? "completed" : "not_completed";
      await setTaskStatus(config, passageTask.id, next);
      passageTask.status = next;
      if (shouldBeDone) completedCount += 1;
      else reopenedCount += 1;
    }
  }

  return {
    bookTaskId,
    passageTaskIds,
    passageTaskCount: Object.keys(passageTaskIds).length,
    completedCount,
    reopenedCount,
    createdCount,
    reusedCount,
  };
}

/** Đồng bộ MỘT quyển, dùng ngay sau khi nhập sách mới. */
export async function syncBookToLifeManagement(
  config: LifeManagementConfig,
  book: ReadingBook,
  attempts: { passageId: string }[] = [],
): Promise<SyncOutcome> {
  if (!config.baseUrl.trim()) throw new Error("Chưa cấu hình địa chỉ Life Management.");
  const snapshot = makeSnapshot(await fetchTasks(config));
  return syncBookWithSnapshot(config, snapshot, book, new Set(attempts.map((a) => a.passageId)));
}

/** Đồng bộ TOÀN BỘ sách trong một lượt, dùng chung một ảnh chụp cây. */
export async function syncBooksToLifeManagement(
  config: LifeManagementConfig,
  books: ReadingBook[],
  attempts: { passageId: string }[],
): Promise<BooksSyncOutcome> {
  if (!config.baseUrl.trim()) throw new Error("Chưa cấu hình địa chỉ Life Management.");
  const snapshot = makeSnapshot(await fetchTasks(config));
  const attemptedPassages = new Set(attempts.map((attempt) => attempt.passageId));

  const outcome: BooksSyncOutcome = {
    bookTaskIds: {},
    passageTaskIds: {},
    createdCount: 0,
    reusedCount: 0,
    completedCount: 0,
    reopenedCount: 0,
  };

  for (const book of books) {
    if (!book.passages.length) continue;
    const one = await syncBookWithSnapshot(config, snapshot, book, attemptedPassages);
    outcome.bookTaskIds[book.id] = one.bookTaskId;
    outcome.passageTaskIds[book.id] = one.passageTaskIds;
    outcome.createdCount += one.createdCount;
    outcome.reusedCount += one.reusedCount;
    outcome.completedCount += one.completedCount;
    outcome.reopenedCount += one.reopenedCount;
  }

  return outcome;
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
 * Đặt trạng thái cho MỘT node lá. Chỉ dùng được cho node lá: bên Life
 * Management, task có con sẽ từ chối đổi trạng thái vì trạng thái của nó được
 * suy ra từ các con. Nhờ vậy chỉ cần đẩy trạng thái ở tầng set, còn node chế độ
 * và node danh sách tự xanh khi đủ con — không phải đụng tới.
 */
async function setTaskStatus(
  config: LifeManagementConfig,
  taskId: string,
  status: "completed" | "not_completed",
): Promise<void> {
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/api/tasks`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: taskId, status }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Không đổi được trạng thái task ${taskId} (${response.status}). ${detail}`);
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

/**
 * Tên node bên Life Management không phải lúc nào cũng trùng tên danh sách bên
 * web từ vựng. Chuẩn hoá dấu ngăn cách đã lo được "15-Day Practice" ↔
 * "vocab_15_day_practice", nhưng "Cambridge" ↔ "Cam_vocab" thì phải khai tay.
 * Khai ở đây để khỏi dựng thêm một cây thứ hai bên cạnh cây người dùng đã có.
 */
const LIST_TITLE_ALIASES: Record<string, string[]> = {
  cambridge: ["Cam_vocab"],
  "15_day_practice": ["vocab_15_day_practice"],
};

export interface ListSyncOutcome {
  listTaskId: string;
  setTaskIds: Record<string, SetModeTaskIds>;
  createdCount: number;
  reusedCount: number;
  completedCount: number;
  /** Node bị gỡ cờ hoàn thành vì bên web từ vựng không còn đạt tuyệt đối. */
  reopenedCount: number;
}

export interface AllListsSyncOutcome {
  /** listId -> id node danh sách bên Life Management. */
  listTaskIds: Record<string, string>;
  setTaskIds: Record<string, SetModeTaskIds>;
  createdCount: number;
  reusedCount: number;
  completedCount: number;
  reopenedCount: number;
}

/**
 * Ảnh chụp cây task bên Life Management, dùng chung cho cả lượt đồng bộ.
 *
 * Đọc MỘT lần rồi tự cập nhật khi tạo node mới: nếu mỗi danh sách lại gọi GET
 * riêng thì một lượt đồng bộ không-có-gì-thay-đổi vẫn tốn bốn vòng mạng, mà
 * lượt như vậy là đa số vì hook tự động chạy lại mỗi khi dữ liệu đổi.
 */
interface TreeSnapshot {
  tasks: RemoteTask[];
  byId: Map<string, RemoteTask>;
}

function makeSnapshot(tasks: RemoteTask[]): TreeSnapshot {
  return { tasks, byId: new Map(tasks.map((task) => [task.id, task])) };
}

const childrenOf = (snapshot: TreeSnapshot, parentId: string) =>
  snapshot.tasks.filter((task) => task.parent_task_id === parentId);

function remember(snapshot: TreeSnapshot, task: RemoteTask) {
  snapshot.tasks.push(task);
  snapshot.byId.set(task.id, task);
}

/**
 * Node đã lưu id từ lần trước — nhưng chỉ nhận nếu nó CÒN nằm đúng dưới node
 * cha đang xét. Một id cũ trỏ sang nhánh khác (node bị kéo đi chỗ khác, hoặc id
 * còn sót từ cấu trúc hai tầng ngày trước) mà cứ dùng bừa thì sẽ đánh dấu hoàn
 * thành nhầm node của chế độ khác.
 */
function storedChild(snapshot: TreeSnapshot, storedId: string | undefined, parentId: string) {
  if (!storedId) return undefined;
  const task = snapshot.byId.get(storedId);
  return task && task.parent_task_id === parentId ? task : undefined;
}

/**
 * Đẩy MỘT danh sách từ vựng sang Life Management đúng theo cây ba tầng mà người
 * dùng đang dùng bên đó:
 *
 *   danh sách (vd. vocab_15_day_practice)
 *     └─ node chế độ (LEARN ENG_VIET, LEARN ENG_ENG, LEARN VIET_ENG, LEARN WRITE)
 *          └─ node set (vd. 15_day_practice_01)
 *
 * Cùng một set xuất hiện dưới cả bốn node chế độ, mỗi bản là một task riêng —
 * đó mới là thứ đánh dấu được: "set 01 xong chế độ eng-viet" tick node set 01
 * nằm dưới LEARN ENG_VIET, không đụng ba bản còn lại.
 *
 * Chạy lại nhiều lần không sinh bản sao. Thứ tự tìm node đã có:
 *   1. Id đã lưu từ lần đồng bộ trước, và phải còn đúng chỗ (xem storedChild).
 *   2. Trùng tên trong đúng node cha, so sau khi chuẩn hoá dấu ngăn cách và qua
 *      bảng tên gọi khác, nên "Cambridge" nhận đúng node "Cam_vocab" đã có.
 *   3. Không thấy thì mới tạo mới.
 *
 * Trạng thái được PHẢN CHIẾU chứ không chỉ cộng dồn: mất điều kiện đạt tuyệt
 * đối bên web từ vựng thì node bên kia cũng được mở lại, nếu không một lần học
 * lại tụt điểm sẽ để lại cờ xanh vĩnh viễn không bao giờ đúng nữa.
 */
async function syncListWithSnapshot(
  config: LifeManagementConfig,
  snapshot: TreeSnapshot,
  vocabParentId: string,
  list: VocabularySetList,
  sets: VocabularySet[],
  results: StudyResult[],
): Promise<ListSyncOutcome> {
  let createdCount = 0;
  let reusedCount = 0;
  let completedCount = 0;
  let reopenedCount = 0;

  const listTitles = [list.title, ...(LIST_TITLE_ALIASES[list.id] ?? [])];
  const listSiblings = childrenOf(snapshot, vocabParentId);
  const existingListTask =
    storedChild(snapshot, list.lifeManagementTaskId, vocabParentId) ??
    listTitles.reduce<RemoteTask | undefined>(
      (found, title) => found ?? listSiblings.find((task) => sameTitle(task.title, title)),
      undefined,
    );

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
    remember(snapshot, { id: created.id, title: created.title, parent_task_id: vocabParentId, status: "not_completed" });
    createdCount += 1;
  }

  const listChildren = childrenOf(snapshot, listTaskId);
  const completedBySet = new Map(sets.map((set) => [set.id, new Set<SetModeKey>(getCompletedSetModes(set, results))]));
  const setTaskIds: Record<string, SetModeTaskIds> = {};

  for (const mode of VOCAB_MODE_NODES) {
    const modeTitles = [mode.title, ...(mode.aliases ?? [])];
    const existingModeTask = modeTitles.reduce<RemoteTask | undefined>(
      (found, title) => found ?? listChildren.find((task) => sameTitle(task.title, title)),
      undefined,
    );

    let modeTaskId: string;
    if (existingModeTask) {
      modeTaskId = existingModeTask.id;
      reusedCount += 1;
    } else {
      const created = await createTask(config, {
        title: mode.title,
        parentTaskId: listTaskId,
        description: `${sets.length} học phần`,
      });
      modeTaskId = created.id;
      remember(snapshot, { id: created.id, title: created.title, parent_task_id: listTaskId, status: "not_completed" });
      createdCount += 1;
    }

    const modeChildren = childrenOf(snapshot, modeTaskId);

    for (const set of sets) {
      const matched =
        storedChild(snapshot, set.lifeManagementTaskIds?.[mode.key], modeTaskId) ??
        modeChildren.find((task) => sameTitle(task.title, set.title));

      let setTask: RemoteTask;
      if (matched) {
        setTask = matched;
        reusedCount += 1;
      } else {
        const created = await createTask(config, {
          title: set.title.slice(0, 250),
          parentTaskId: modeTaskId,
          description: `${set.cards.length} từ`,
        });
        setTask = { id: created.id, title: created.title, parent_task_id: modeTaskId, status: "not_completed" };
        remember(snapshot, setTask);
        createdCount += 1;
      }

      setTaskIds[set.id] = { ...setTaskIds[set.id], [mode.key]: setTask.id };

      const shouldBeDone = completedBySet.get(set.id)?.has(mode.key) ?? false;
      if (shouldBeDone !== (setTask.status === "completed")) {
        const next = shouldBeDone ? "completed" : "not_completed";
        await setTaskStatus(config, setTask.id, next);
        setTask.status = next;
        if (shouldBeDone) completedCount += 1;
        else reopenedCount += 1;
      }
    }
  }

  return { listTaskId, setTaskIds, createdCount, reusedCount, completedCount, reopenedCount };
}

/**
 * Đồng bộ TOÀN BỘ danh sách trong một lượt, dùng chung một ảnh chụp cây. Đây là
 * đường chạy duy nhất — cả đồng bộ tự động lẫn nút bấm tay đều đi qua đây, nên
 * không có chuyện hai đường xử lý lệch nhau.
 */
export async function syncAllListsToLifeManagement(
  config: LifeManagementConfig,
  lists: VocabularySetList[],
  setsOfList: (list: VocabularySetList) => VocabularySet[],
  results: StudyResult[],
): Promise<AllListsSyncOutcome> {
  const vocabParentId = requireVocabParent(config);
  const snapshot = makeSnapshot(await fetchTasks(config));

  const outcome: AllListsSyncOutcome = {
    listTaskIds: {},
    setTaskIds: {},
    createdCount: 0,
    reusedCount: 0,
    completedCount: 0,
    reopenedCount: 0,
  };

  for (const list of lists) {
    const sets = setsOfList(list);
    // Danh sách rỗng cố ý bị bỏ qua: đồng bộ nó chỉ tạo ra một node danh sách và
    // bốn node chế độ trống rỗng bên kia, không mang thông tin gì.
    if (!sets.length) continue;
    const one = await syncListWithSnapshot(config, snapshot, vocabParentId, list, sets, results);
    outcome.listTaskIds[list.id] = one.listTaskId;
    Object.assign(outcome.setTaskIds, one.setTaskIds);
    outcome.createdCount += one.createdCount;
    outcome.reusedCount += one.reusedCount;
    outcome.completedCount += one.completedCount;
    outcome.reopenedCount += one.reopenedCount;
  }

  return outcome;
}

function requireVocabParent(config: LifeManagementConfig): string {
  if (!config.baseUrl.trim()) throw new Error("Chưa cấu hình địa chỉ Life Management.");
  // Cấu hình lưu từ trước khi có trường này sẽ được readingStorage điền mặc
  // định, nhưng vẫn đọc phòng thủ để một cấu hình cũ không làm nổ TypeError.
  const vocabParentId = (config.vocabTaskId ?? "").trim();
  if (!vocabParentId) throw new Error("Chưa cấu hình node cha cho danh sách từ vựng.");
  return vocabParentId;
}

/** Cheap reachability probe so the settings panel can confirm the URL works. */
export async function pingLifeManagement(config: LifeManagementConfig): Promise<boolean> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/api/tasks?userId=${encodeURIComponent(config.userId)}`;
  const response = await fetch(url, { method: "GET" });
  return response.ok;
}
