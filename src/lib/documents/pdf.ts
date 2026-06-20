import * as pdfjsLib from "pdfjs-dist";
// Vite-friendly worker URL.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;

export interface PdfPageText {
  page: number;
  text: string;
  /** lines roughly reconstructed */
  lines: string[];
}

/** Load a PDF document proxy from bytes. */
export async function loadPdf(data: ArrayBuffer): Promise<PdfDocument> {
  const task = pdfjsLib.getDocument({ data });
  return task.promise;
}

/** Extract plain text for every page (used for AI context + conversion). */
export async function extractPdfText(
  data: ArrayBuffer
): Promise<{ pages: PdfPageText[]; total: string }> {
  const doc = await loadPdf(data);
  const pages: PdfPageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Reconstruct lines using item y-positions.
    const lines: string[] = [];
    let curY: number | null = null;
    let cur = "";
    for (const item of content.items as any[]) {
      const str = item.str ?? "";
      const y = item.transform?.[5];
      if (curY === null || Math.abs(y - curY) < 4) {
        cur += (cur && !cur.endsWith(" ") && str && !str.startsWith(" ") ? " " : "") + str;
        curY = y;
      } else {
        if (cur.trim()) lines.push(cur.trim());
        cur = str;
        curY = y;
      }
    }
    if (cur.trim()) lines.push(cur.trim());
    const text = lines.join("\n");
    pages.push({ page: i, text, lines });
    page.cleanup();
  }
  await doc.destroy();
  return { pages, total: pages.map((p) => p.text).join("\n\n") };
}

export interface RenderedPage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Render many pages (with a callback for progress). */
export async function renderPdfPages(
  data: ArrayBuffer,
  scale = 1.4,
  onPage?: (page: number, total: number, rendered: RenderedPage) => void
): Promise<RenderedPage[]> {
  const doc = await loadPdf(data);
  const out: RenderedPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    const dataUrl = canvas.toDataURL("image/png");
    out.push({ dataUrl, width: canvas.width, height: canvas.height });
    onPage?.(i, doc.numPages, out[out.length - 1]);
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

export { pdfjsLib };
