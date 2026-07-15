import { RefObject, useCallback, useEffect, useRef, useState } from "react";

interface YouTubePlayer {
  destroy(): void;
  loadVideoById(options: { videoId: string; startSeconds: number; endSeconds: number }): void;
  pauseVideo(): void;
  playVideo(): void;
}

interface YouTubePlayerEvent {
  data: number;
  target: YouTubePlayer;
}

interface YouTubeNamespace {
  Player: new (element: HTMLElement, options: {
    videoId: string;
    playerVars: Record<string, string | number>;
    events: {
      onError: (event: YouTubePlayerEvent) => void;
      onReady: (event: YouTubePlayerEvent) => void;
      onStateChange: (event: YouTubePlayerEvent) => void;
    };
  }) => YouTubePlayer;
  PlayerState: { PLAYING: number };
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeNamespace> | null = null;

function loadYouTubeApi() {
  if (window.YT) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => {
      youtubeApiPromise = null;
      reject(new Error("YouTube API load timed out"));
    }, 15000);
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      window.clearTimeout(timeout);
      if (window.YT) resolve(window.YT);
      else {
        youtubeApiPromise = null;
        reject(new Error("YouTube API is unavailable"));
      }
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        youtubeApiPromise = null;
        reject(new Error("Cannot load YouTube API"));
      };
      document.head.appendChild(script);
    }
  });
  return youtubeApiPromise;
}

export function useYouTubePlayer(videoId: string | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!videoId || !containerRef.current) return;
    let cancelled = false;
    setReady(false);
    setPlaying(false);
    setError("");
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !containerRef.current) return;
        playerRef.current = new YT.Player(containerRef.current, {
          videoId,
          playerVars: {
            controls: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: () => setReady(true),
            onStateChange: (event) => setPlaying(event.data === YT.PlayerState.PLAYING),
            onError: () => {
              setPlaying(false);
              setError("Video này không thể phát trong trình nhúng YouTube.");
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setError("Không tải được YouTube Player. Hãy kiểm tra kết nối mạng.");
      });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId]);

  const playSegment = useCallback((startSeconds: number, endSeconds: number) => {
    if (!videoId || !playerRef.current) return;
    playerRef.current.loadVideoById({
      videoId,
      startSeconds: Math.max(0, startSeconds - 0.18),
      endSeconds: endSeconds + 0.22,
    });
  }, [videoId]);

  const pause = useCallback(() => playerRef.current?.pauseVideo(), []);
  const resume = useCallback(() => playerRef.current?.playVideo(), []);

  return { containerRef: containerRef as RefObject<HTMLDivElement>, ready, playing, error, playSegment, pause, resume };
}
