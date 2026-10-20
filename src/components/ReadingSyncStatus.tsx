import { ReadingApi } from "../hooks/useReadingData";
import { Icon } from "./ui";

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

/** Trạng thái đồng bộ lịch sử làm bài giữa các thiết bị, kèm nút đồng bộ ngay. */
export function ReadingSyncStatus({ api, className = "" }: { api: ReadingApi; className?: string }) {
  const { cloudState, lastSyncedAt } = api;
  const error = cloudState === "error";
  const label =
    cloudState === "syncing"
      ? "Đang đồng bộ lịch sử làm bài..."
      : error
        ? "Chưa đồng bộ được với máy chủ — kết quả trên thiết bị khác có thể chưa hiện."
        : lastSyncedAt
          ? `Đã đồng bộ với các thiết bị khác lúc ${timeOf(lastSyncedAt)}`
          : "Đã đồng bộ";
  return (
    <div
      className={`flex items-center gap-sm rounded-xl px-md py-sm text-sm ${
        error ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100" : "bg-surface-container-low text-on-surface-variant dark:bg-white/5 dark:text-white/60"
      } ${className}`}
    >
      <Icon name={error ? "cloud_off" : cloudState === "syncing" ? "cloud_sync" : "cloud_done"} className={`shrink-0 text-[20px] ${cloudState === "syncing" ? "animate-pulse" : ""}`} />
      <span className="min-w-0 flex-1 leading-5">{label}</span>
      <button
        type="button"
        onClick={() => void api.syncNow()}
        disabled={cloudState === "syncing"}
        className="min-h-10 shrink-0 rounded-lg px-sm font-bold text-primary transition active:scale-95 disabled:opacity-50 dark:text-[#c9c5ff]"
      >
        Đồng bộ
      </button>
    </div>
  );
}
