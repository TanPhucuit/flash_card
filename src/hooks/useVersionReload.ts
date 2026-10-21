import { useEffect } from "react";

// Một tab mở từ trước lần deploy vẫn chạy JS cũ cho tới khi được tải lại — trên
// điện thoại điều đó có thể kéo dài nhiều ngày, nên các bản sửa (ví dụ đồng bộ
// lịch sử Reading) không bao giờ tới được máy đó. Định kỳ so tên file JS trong
// index.html mới nhất với file đang chạy; nếu khác thì tải lại, nhưng chỉ khi
// người dùng vừa quay lại tab và không đang dở một bài làm hay buổi học.
const SAFE_TO_RELOAD = (path: string) => !/^\/(reading\/[^/]+\/[^/]+|study\/)/.test(path);

/** Tên file JS đang chạy, ví dụ "/assets/index-DSbd1saj.js"; rỗng khi chạy dev server. */
export function runningBundle(): string {
  return (
    Array.from(document.querySelectorAll<HTMLScriptElement>("script[type='module'][src]"))
      .map((script) => new URL(script.src, window.location.href).pathname)
      .find((src) => /\/assets\/index-[\w-]+\.js$/.test(src)) ?? ""
  );
}

/** Mã ngắn của phiên bản đang chạy để hiển thị khi cần chẩn đoán. */
export function runningVersion(): string {
  return runningBundle().match(/index-([\w-]+)\.js$/)?.[1] ?? "dev";
}

/** true nếu server đang phục vụ một bản build khác bản đang chạy. */
export async function isUpdateAvailable(): Promise<boolean> {
  const running = runningBundle();
  if (!running) return false;
  try {
    const html = await fetch("/", { cache: "no-store" }).then((response) => response.text());
    const latest = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
    return Boolean(latest && latest !== running);
  } catch {
    return false;
  }
}

export function useVersionReload() {
  useEffect(() => {
    if (!runningBundle()) return; // dev server: không có bundle để so

    let updateReady = false;
    const check = async () => {
      if (await isUpdateAvailable()) updateReady = true;
    };
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      await check();
      if (updateReady && SAFE_TO_RELOAD(window.location.pathname)) window.location.reload();
    };

    void check();
    const timer = window.setInterval(check, 5 * 60_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
