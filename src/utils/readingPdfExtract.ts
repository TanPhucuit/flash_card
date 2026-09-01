import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Vite hands us a hashed URL for the worker bundle; pdfjs refuses to run
// without one being registered up front. Kept in its own module (separate
// from readingPdf.ts's pure parsing logic) so that parsing logic can be unit
// tested in plain Node/tsx without pulling in this browser-only worker wiring.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Pull text out of a PDF one page at a time, rebuilding line breaks from the
 * glyph positions. pdfjs gives us positioned text runs with no notion of
 * "line", so we group runs by their baseline (transform[5]) and treat a
 * vertical jump as a new line — without this every page collapses into one
 * unbroken string and none of the structural regexes in readingPdf.ts can match.
 */
export async function extractPdfLines(file: File, onProgress?: (page: number, total: number) => void): Promise<string[]> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    let currentY: number | null = null;
    let current = "";

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = Math.round((item.transform[5] as number) * 10) / 10;
      if (currentY === null) currentY = y;
      // A baseline shift of more than ~2.5pt is a genuine new line rather than
      // sub/superscript jitter within the same one.
      if (Math.abs(y - currentY) > 2.5) {
        lines.push(current.trim());
        current = "";
        currentY = y;
      }
      current += item.str;
      if (item.hasEOL) {
        lines.push(current.trim());
        current = "";
      }
    }
    if (current.trim()) lines.push(current.trim());
    // Page break marker: keeps a passage from bleeding into the next page's
    // header when we later rejoin paragraphs.
    lines.push("");
    onProgress?.(pageNumber, doc.numPages);
  }

  await doc.destroy();
  return lines;
}
