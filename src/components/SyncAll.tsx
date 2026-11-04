import { useState } from "react";
import { DataApi, ReadingDataApi } from "../App";
import { Button, Card, Icon } from "./ui";

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * Một lần đồng bộ cho TOÀN BỘ dữ liệu: bộ từ vựng, kết quả học (cùng một tab
 * Google Sheet) và lịch sử làm bài Reading (tab riêng). Đây, cộng với lần tự
 * đồng bộ lúc mở web, là hai thời điểm DUY NHẤT web gọi Google Sheet.
 */
function useSyncAll(api: DataApi, reading: ReadingDataApi) {
  const [running, setRunning] = useState(false);
  const busy = running || api.syncState === "loading" || api.syncState === "saving" || reading.cloudState === "syncing";
  const failed = api.syncState === "error" || reading.cloudState === "error";
  const run = async () => {
    if (busy) return;
    setRunning(true);
    try {
      await Promise.all([api.syncNow(), reading.syncNow()]);
    } finally {
      setRunning(false);
    }
  };
  return { busy, failed, run };
}

/** Nút tròn nhỏ trên thanh tiêu đề mobile — mobile không có trang Settings. */
export function SyncIconButton({ api, reading }: { api: DataApi; reading: ReadingDataApi }) {
  const { busy, failed, run } = useSyncAll(api, reading);
  const dirty = api.unsynced && !failed;
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      aria-label="Đồng bộ dữ liệu"
      title={busy ? "Đang đồng bộ..." : failed ? "Đồng bộ lỗi — bấm để thử lại" : dirty ? "Có thay đổi chưa đồng bộ" : "Đã đồng bộ"}
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-surface-variant bg-white text-primary transition active:scale-95 disabled:opacity-70 dark:border-white/10 dark:bg-[#242728] dark:text-[#c9c5ff]"
    >
      <Icon name={failed ? "cloud_off" : "sync"} className={busy ? "animate-spin" : ""} />
      {!busy ? <span className={`absolute right-2 top-2 h-2.5 w-2.5 rounded-full ${failed ? "bg-red-500" : dirty ? "bg-amber-500" : "bg-emerald-500"}`} /> : null}
    </button>
  );
}

export function SyncAllCard({ api, reading }: { api: DataApi; reading: ReadingDataApi }) {
  const { busy, failed, run } = useSyncAll(api, reading);
  const lastAt = Math.max(api.lastSyncedAt ?? 0, reading.lastSyncedAt ?? 0);
  const lines: string[] = [];
  if (busy) lines.push("Đang đồng bộ...");
  else if (failed) lines.push("Đồng bộ chưa thành công — dữ liệu vẫn an toàn trên máy này, hãy bấm lại.");
  else if (api.unsynced) lines.push("Máy này có thay đổi chưa đồng bộ.");
  else lines.push("Dữ liệu trên máy này khớp với Google Sheet.");
  if (lastAt) lines.push(`Lần đồng bộ gần nhất: ${timeOf(lastAt)}`);
  return (
    <Card className="space-y-md">
      <h2 className="font-headline-md text-headline-md">Đồng bộ dữ liệu</h2>
      <p className="text-sm text-on-surface-variant dark:text-white/70">
        Web chỉ đồng bộ với Google Sheet <strong>khi mở trang</strong> và <strong>khi bấm nút này</strong> — không tự đồng bộ liên tục.
        Làm xong ở máy này, hãy bấm đồng bộ trước khi sang máy khác để máy kia thấy kết quả. Nút đồng bộ cả bộ từ vựng, kết quả học
        lẫn lịch sử Reading.
      </p>
      <Button disabled={busy} onClick={() => void run()}>
        <Icon name="sync" className={busy ? "animate-spin" : ""} /> {busy ? "Đang đồng bộ..." : "Đồng bộ ngay"}
      </Button>
      <div className={`rounded-xl p-md text-sm ${failed ? "bg-error-container font-semibold text-on-error-container" : "bg-surface-container-low text-on-surface-variant dark:bg-white/5 dark:text-white/70"}`}>
        {lines.map((line) => <div key={line}>{line}</div>)}
        <div className="mt-xs text-xs opacity-80">Reading: máy này {reading.cloudInfo.local} lượt · Google Sheet {reading.cloudInfo.remote} lượt</div>
      </div>
    </Card>
  );
}
