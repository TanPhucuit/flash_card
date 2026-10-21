import { ReactNode } from "react";

// Dạng "Label the diagram" vẽ sơ đồ bằng ký tự khung (│ ┌ ═ ▒ ~ ...). Những
// dòng đó phải giữ nguyên khoảng trắng và dùng font đều nét, nếu không các
// đường kẻ sẽ lệch nhau; trên màn hình hẹp thì cho cuộn ngang thay vì xuống dòng.
const DIAGRAM_LINE = /[─│┌┐└┘├┤┬┴╱╲‾═▒┃▼▲↓↑←→✿]|~~~/;

/**
 * Chia lời dẫn thành các đoạn văn thường và các khối sơ đồ liền nhau.
 * `renderLine` quyết định cách in một dòng văn thường (mobile in danh sách
 * nhãn thành hàng riêng, desktop in nguyên dòng).
 */
export function InstructionBlocks({ text, renderLine }: { text: string; renderLine: (line: string, key: number) => ReactNode }) {
  const lines = text.split("\n");
  // Sơ đồ luôn là phần cuối của lời dẫn; một số dòng của nó (vd. "\ | /") không
  // chứa ký tự khung nào, nên lấy từ dòng sơ đồ đầu tiên tới hết.
  const start = lines.findIndex((line) => DIAGRAM_LINE.test(line));
  const textLines = start < 0 ? lines : lines.slice(0, start);
  return (
    <>
      {textLines.map((line, i) => renderLine(line, i))}
      {start >= 0 ? (
        <pre className="my-sm overflow-x-auto whitespace-pre rounded-lg bg-white/70 p-sm font-mono text-[12px] leading-5 text-on-surface dark:bg-black/20 dark:text-white/85">
          {lines.slice(start).join("\n")}
        </pre>
      ) : null}
    </>
  );
}
