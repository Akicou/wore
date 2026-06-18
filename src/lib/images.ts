/*
  Editor image helpers — paste handling + content-width-aware sizing.
  Used by the contenteditable surface so pasted/dropped images become real
  <img> data URLs (not broken placeholder icons) and never exceed the page.
*/

/** Read the first image File (if any) from a clipboard/drop event. */
export function imageFileFromClipboard(e: ClipboardEvent): File | null {
  const dt = e.clipboardData;
  if (!dt) return null;
  const items = dt.items ? Array.from(dt.items) : [];
  for (const it of items) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  const files = dt.files ? Array.from(dt.files) : [];
  return files.find((f) => f.type.startsWith("image/")) ?? null;
}

/** Read a File/Blob into a data URL. */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

/**
 * Decoded dimensions of an image data/remote URL. Returns 0×0 on failure.
 */
export function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || img.width || 0, h: img.naturalHeight || img.height || 0 });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = src;
  });
}

/**
 * Available content width (px) for images inside the editor. Walks from a
 * node up to the nearest `.wore-editor`/`.wore-page` and subtracts padding
 * so a freshly pasted image never overflows the sheet.
 */
export function editorContentWidth(refNode?: Node | null): number {
  let host: HTMLElement | null =
    refNode && refNode.nodeType === Node.ELEMENT_NODE ? (refNode as HTMLElement) : null;
  if (!host && refNode && refNode.parentElement) host = refNode.parentElement;
  let el: HTMLElement | null = host;
  while (el) {
    if (el.classList?.contains("wore-editor") || el.classList?.contains("wore-page")) break;
    el = el.parentElement;
  }
  const measure = el ?? (host && host.closest ? (host.closest(".wore-editor, .wore-page") as HTMLElement | null) : null);
  if (!measure) return 640;
  const style = getComputedStyle(measure);
  const padX = parseFloat(style.paddingLeft || "0") + parseFloat(style.paddingRight || "0");
  const inner = Math.max(120, (measure.clientWidth || 640) - (isNaN(padX) ? 0 : padX));
  return inner;
}

/**
 * Build the inline style string for an inserted image so it fits the content
 * column. We set an explicit pixel width capped at the editor's inner width
 * (leaving a little breathing room) so it reads as "smaller than the page".
 */
export async function fittedImageStyle(src: string, refNode?: Node | null): Promise<string> {
  const { w, h } = await imageSize(src);
  const maxW = Math.max(160, editorContentWidth(refNode) - 8);
  let css = "border-radius: 8px;";
  if (w > 0) {
    const width = Math.min(w, maxW);
    css += `width:${width}px;`;
    if (h > 0) css += `height:auto;`;
  } else {
    // unknown size → cap by percent of column
    css += "max-width:100%;";
  }
  return css;
}

export function escapeHtmlAttr(s: string) {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
