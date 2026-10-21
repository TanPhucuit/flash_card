import { useState } from "react";
import { ReadingApi } from "../hooks/useReadingData";
import { isUpdateAvailable, runningVersion } from "../hooks/useVersionReload";
import { Icon } from "./ui";

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

/**
 * Trạng thái đồng bộ lịch sử làm bài giữa các thiết bị, kèm số liệu chẩn đoán
 * (máy này / máy chủ / phiên bản) và nút đồng bộ ngay — nút này cũng tải lại
 * trang nếu đang chạy một bản cũ, vì bản cũ có thể chưa biết cách đồng bộ.
 */
export function ReadingSyncStatus({ api, className = "" }: { api: ReadingApi; className?: string }) {
  const { cloudState, lastSyncedAt, cloudInfo } = api;
  const [checking, setChecking] = useState(false);
  const error = cloudState === "error";
  const busy = cloudState === "syncing" || checking;
  const label =
    busy
      ? "Đang đồng bộ lịch sử làm bài..."
      : error
        ? "Chưa đồng bộ được với máy chủ — kết quả trên thiết bị khác có thể chưa hiện."
        : lastSyncedAt
          ? `Đã đồng bộ với các thiết bị khác lúc ${timeOf(lastSyncedAt)}`
          : "Đã đồng bộ";

  const syncNow = async () => {
    setChecking(true);
    const update = await isUpdateAvailable();
    if (update) {
      window.location.reload();
      return;
    }
    setChecking(false);
    await api.syncNow();
  };

  return (
    <div
      className={`rounded-xl px-md py-sm text-sm ${
        error ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100" : "bg-surface-container-low text-on-surface-variant dark:bg-white/5 dark:text-white/60"
      } ${className}`}
    >
      <div className="flex items-center gap-sm">
        <Icon name={error ? "cloud_off" : busy ? "cloud_sync" : "cloud_done"} className={`shrink-0 text-[20px] ${busy ? "animate-pulse" : ""}`} />
        <span className="min-w-0 flex-1 leading-5">{label}</span>
        <button
          type="button"
          onClick={() => void syncNow()}
          disabled={busy}
          className="min-h-10 shrink-0 rounded-lg px-sm font-bold text-primary transition active:scale-95 disabled:opacity-50 dark:text-[#c9c5ff]"
        >
          Đồng bộ
        </button>
      </div>
      <p className="mt-xs pl-7 text-xs opacity-80">
        Máy này: {cloudInfo.local} lượt · Máy chủ: {cloudInfo.remote} lượt
        {cloudInfo.pushed ? ` · vừa đẩy lên ${cloudInfo.pushed}` : ""} · bản {runningVersion()}
        {error && cloudInfo.error ? ` · lỗi: ${cloudInfo.error}` : ""}
      </p>
    </div>
  );
}
