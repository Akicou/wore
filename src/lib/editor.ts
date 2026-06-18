/*
  Editor engine — selection utilities + formatting commands.
  Uses contenteditable + execCommand (universally supported) plus direct
  DOM surgery for richer blocks (text boxes, figures, callouts).
*/

export function focusEditor(el: HTMLElement) {
  el.focus();
}

/** Run an execCommand while keeping focus in the editor. */
export function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export function bold() {
  exec("bold");
}
export function italic() {
  exec("italic");
}
export function underline() {
  exec("underline");
}
export function strikeThrough() {
  exec("strikeThrough");
}
export function subscript() {
  exec("subscript");
}
export function superscript() {
  exec("superscript");
}

export function formatBlock(tag: string) {
  exec("formatBlock", tag);
}
export const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) => formatBlock(`H${level}`);
export const paragraph = () => formatBlock("P");
export const blockquote = () => formatBlock("BLOCKQUOTE");
export const preformatted = () => formatBlock("PRE");

export function align(type: "left" | "center" | "right" | "justify") {
  exec(`justify${type[0].toUpperCase()}${type.slice(1)}`);
}
export function indent() {
  exec("indent");
}
export function outdent() {
  exec("outdent");
}
export function orderedList() {
  exec("insertOrderedList");
}
export function unorderedList() {
  exec("insertUnorderedList");
}
export function undo() {
  exec("undo");
}
export function redo() {
  exec("redo");
}
export function removeFormat() {
  exec("removeFormat");
}

export function setForeColor(color: string) {
  exec("foreColor", color);
}
export function setBackColor(color: string) {
  exec("hiliteColor", color);
}
export function setFontName(font: string) {
  exec("fontName", font);
}
export function setFontSize(size: number) {
  // execCommand fontSize uses 1-7; we instead wrap selection in a span.
  wrapSelectionWithStyle({ fontSize: `${size}px` });
}

export function createLink(url: string) {
  exec("createLink", url);
}

export function insertHorizontalRule() {
  exec("insertHorizontalRule");
}

/** Insert arbitrary HTML at the current selection. */
export function insertHTML(html: string) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  if (document.queryCommandSupported?.("insertHTML")) {
    exec("insertHTML", html);
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const frag = range.createContextualFragment(html);
  range.insertNode(frag);
  range.collapse(false);
}

export function insertImage(src: string, opts?: { alt?: string; caption?: string; style?: string }) {
  const style = opts?.style ? ` style="${opts.style}"` : "";
  const html = opts?.caption
    ? `<figure><img src="${src}" alt="${opts?.alt ?? ""}"${style}/><figcaption>${escapeAttr(opts.caption)}</figcaption></figure><p><br/></p>`
    : `<img src="${src}" alt="${opts?.alt ?? ""}"${style}/><p><br/></p>`;
  insertHTML(html);
}

/** Wrap the current selection in a styled span. */
export function wrapSelectionWithStyle(style: Partial<CSSStyleDeclaration> | Record<string, string>) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement("span");
  Object.entries(style).forEach(([k, v]) => {
    (span.style as any)[k] = v;
  });
  try {
    range.surroundContents(span);
  } catch {
    // selection crosses element boundaries — extract + wrap
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }
  sel.removeAllRanges();
  const nr = document.createRange();
  nr.selectNodeContents(span);
  sel.addRange(nr);
}

/** Insert a styled text-box block. */
export function insertTextBox(text = "") {
  insertHTML(
    `<div class="wore-textbox" contenteditable="true">${text || "Write here…"}</div><p><br/></p>`
  );
}

/** Insert a callout (accent-tinted block). */
export function insertCallout() {
  insertHTML(
    `<div class="wore-textbox" style="border-style:solid;background:var(--accent-soft)" contenteditable="true">Callout: highlight a key insight.</div><p><br/></p>`
  );
}

/** Insert an N×M table. */
export function insertTable(rows: number, cols: number) {
  const thead = `<tr>${"<th>Heading</th>".repeat(cols)}</tr>`;
  const body = Array.from({ length: Math.max(0, rows - 1) })
    .map(() => `<tr>${"<td>·</td>".repeat(cols)}</tr>`)
    .join("");
  insertHTML(
    `<table><thead>${thead}</thead><tbody>${body}</tbody></table><p><br/></p>`
  );
}

/* ---------------------------- selection helpers --------------------------- */

export function getSelectedText(): string {
  return window.getSelection()?.toString() ?? "";
}

export function getSelectedHTML(): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return "";
  const range = sel.getRangeAt(0);
  const frag = range.cloneContents();
  const div = document.createElement("div");
  div.appendChild(frag);
  return div.innerHTML;
}

export function getSelectionRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

/** True when a non-collapsed selection exists inside `root`. */
export function hasEditableSelection(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  return root.contains(node);
}

/** Replace the current selection with the given HTML. */
export function replaceSelectionWithHTML(html: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  return replaceRangeWithHTML(sel.getRangeAt(0), html);
}

/** Replace a stored Range directly. Safer for floating UI where focus moved away. */
export function replaceRangeWithHTML(range: Range, html: string): boolean {
  try {
    const work = range.cloneRange();
    work.deleteContents();
    const frag = work.createContextualFragment(html);
    const last = frag.lastChild;
    work.insertNode(frag);
    if (last) {
      const sel = window.getSelection();
      const after = document.createRange();
      after.setStartAfter(last);
      after.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(after);
    }
    return true;
  } catch {
    return false;
  }
}

/** Insert HTML at a stored Range boundary. */
export function insertHTMLAtRange(range: Range, html: string, collapseToEnd = true): boolean {
  try {
    const work = range.cloneRange();
    if (collapseToEnd) work.collapse(false);
    const frag = work.createContextualFragment(html);
    const last = frag.lastChild;
    work.insertNode(frag);
    if (last) {
      const sel = window.getSelection();
      const after = document.createRange();
      after.setStartAfter(last);
      after.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(after);
    }
    return true;
  } catch {
    return false;
  }
}

export function clearSelectionFormatting() {
  exec("removeFormat");
}

function escapeAttr(s: string) {
  return s.replace(/"/g, "&quot;");
}
