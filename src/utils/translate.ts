/** Dịch một đoạn văn bản sang tiếng Việt qua /api/translate. */
export async function translateToVietnamese(text: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ text }),
    cache: "no-store",
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as { translation?: string; error?: string };
  if (!response.ok || !payload.translation) throw new Error(payload.error || "Không thể tải bản dịch.");
  return payload.translation;
}
