import { useEffect } from "react";

// Một tab mở từ trước lần deploy vẫn chạy JS cũ cho tới khi được tải lại — trên
// điện thoại điều đó có thể kéo dài nhiều ngày, nên các bản sửa (ví dụ đồng bộ
// lịch sử Reading) không bao giờ tới được máy đó. Định kỳ so tên file JS trong
// index.html mới nhất với file đang chạy; nếu khác thì tải lại, nhưng chỉ khi
// người dùng vừa quay lại tab và không đang dở một bài làm hay buổi học.
const SAFE_TO_RELOAD = (path: string) => !/^\/(reading\/[^/]+\/[^/]+|study\/)/.test(path);

export function useVersionReload() {
  useEffect(() => {
    const running = Array.from(document.querySelectorAll<HTMLScriptElement>("script[type='module'][src]"))
      .map((script) => script.getAttribute("src") ?? "")
      .find((src) => /\/assets\/index-[\w-]+\.js$/.test(src));
    if (!running) return; // dev server: không có bundle để so

    let updateReady = false;
    const check = async () => {
      try {
        const html = await fetch("/", { cache: "no-store" }).then((response) => response.text());
        const latest = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
        if (latest && !running.endsWith(latest)) updateReady = true;
      } catch {
        /* mất mạng: thử lại lần sau */
      }
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
