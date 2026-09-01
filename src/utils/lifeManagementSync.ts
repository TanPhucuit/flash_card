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

/** Cheap reachability probe so the settings panel can confirm the URL works. */
export async function pingLifeManagement(config: LifeManagementConfig): Promise<boolean> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/api/tasks?userId=${encodeURIComponent(config.userId)}`;
  const response = await fetch(url, { method: "GET" });
  return response.ok;
}
