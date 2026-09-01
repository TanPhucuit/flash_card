import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PageItem, reconstructPageLines } from "./readingPdf";

// Vite hands us a hashed URL for the worker bundle; pdfjs refuses to run
// without one being registered up front. Kept in its own module (separate
// from readingPdf.ts's pure parsing logic) so that parsing logic can be unit
// tested in plain Node/tsx without pulling in this browser-only worker wiring.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Pull text out of a PDF one page at a time. pdfjs hands back positioned
 * text runs with no notion of "line" or "column" — reconstructPageLines
 * (readingPdf.ts) does the actual work of turning those positions back into
 * an ordered line stream, including unscrambling multi-column answer-key
 * tables; this function's only job is collecting the raw (str, x, y, hasEOL)
 * per page and handing it off.
 */
export async function extractPdfLines(file: File, onProgress?: (page: number, total: number) => void): Promise<string[]> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PageItem[] = content.items
      .filter((item): item is import("pdfjs-dist/types/src/display/api").TextItem => "str" in item && "transform" in item)
      .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5], hasEOL: Boolean(item.hasEOL) }));

    lines.push(...reconstructPageLines(items));
    // Page break marker: keeps a passage from bleeding into the next page's
    // header when we later rejoin paragraphs.
    lines.push("");
    onProgress?.(pageNumber, doc.numPages);
  }

  await doc.destroy();
  return lines;
}
