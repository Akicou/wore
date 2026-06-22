import type { DocFormat, RecentDoc } from "../store";
import { idbGet, idbSet, idbDel } from "../idb";
import { uid } from "../utils";
import { markdownToHtml, htmlToMarkdown } from "./markdown";
import { docxToHtml, docxToText, htmlToDocx } from "./docx";
import { extractPdfText } from "./pdf";
import { pdfToDocx } from "./convert";
import { sanitizeHtml, sanitizeDocxImportHtml, wrapStandaloneHtml, escapeHtml, htmlToPlainText } from "./html";
import { parsePptx, savePptxSlides, deletePptxSlides } from "./pptx";

export interface StoredDoc {
  id: string;
  title: string;
  format: DocFormat;
  contentHtml: string;
  createdAt: number;
  updatedAt: number;
}

const contentKey = (id: string) => `doc:${id}`;
const sourceKey = (id: string) => `doc:${id}:source`;

/* --------------------------------------------------------------------------
   CRUD
-------------------------------------------------------------------------- */
export async function saveDoc(doc: StoredDoc): Promise<void> {
  await idbSet(contentKey(doc.id), doc);
}

export async function loadDoc(id: string): Promise<StoredDoc | undefined> {
  return idbGet<StoredDoc>(contentKey(id));
}

export async function getSourceBytes(id: string): Promise<ArrayBuffer | undefined> {
  const buf = await idbGet<ArrayBuffer>(sourceKey(id));
  return buf;
}

export async function setSourceBytes(id: string, bytes: ArrayBuffer): Promise<void> {
  await idbSet(sourceKey(id), bytes);
}

export async function deleteDoc(id: string): Promise<void> {
  await idbDel(contentKey(id));
  await idbDel(sourceKey(id));
  await deletePptxSlides(id);
}

export function newDoc(
  format: DocFormat,
  title: string,
  contentHtml = "<p><br></p>"
): StoredDoc {
  const now = Date.now();
  return { id: uid(), title, format, contentHtml, createdAt: now, updatedAt: now };
}

/* --------------------------------------------------------------------------
   Import from a File
-------------------------------------------------------------------------- */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const clean = base64.replace(/\s/g, "");
  const binary = window.atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function readPathBytes(path: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<{
    ok: boolean;
    path: string;
    name: string;
    ext: string;
    size: number;
    bytes_base64?: string;
    error?: string;
  }>("read_document_bytes", { path });
}

export async function readDocumentTextFromPath(path: string): Promise<{ title: string; text: string; html: string; path: string; size: number }> {
  const result = await readPathBytes(path);
  if (!result.ok || !result.bytes_base64) throw new Error(result.error ?? "Could not read file");

  const buf = base64ToArrayBuffer(result.bytes_base64);
  const title = result.name || "document";
  const ext = result.ext.toLowerCase();
  const decoder = new TextDecoder("utf-8");
  let html = "";

  if (ext === "md" || ext === "markdown") {
    html = markdownToHtml(decoder.decode(buf));
  } else if (ext === "txt") {
    const text = decoder.decode(buf);
    html = `<p>${escapeHtml(text).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  } else if (ext === "html" || ext === "htm") {
    html = sanitizeHtml(decoder.decode(buf));
  } else if (ext === "docx") {
    const text = await docxToText(buf.slice(0));
    html = text ? `<p>${escapeHtml(text).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</p>` : sanitizeDocxImportHtml(await docxToHtml(buf.slice(0)));
  } else if (ext === "pptx" || ext === "ppt") {
    let parsed: Awaited<ReturnType<typeof parsePptx>>;
    try {
      parsed = await parsePptx(buf.slice(0));
    } catch (e) {
      if (ext === "ppt") {
        throw new Error("This .ppt file is not a PPTX package. Please save/export it as .pptx first.");
      }
      throw e;
    }
    html = `<h1>${escapeHtml(parsed.title)}</h1>` + parsed.slides.map((s) => `<h2>${escapeHtml(s.title)}</h2><p>${escapeHtml(s.notes || "")}</p>`).join("");
  } else if (ext === "pdf") {
    const { pages } = await extractPdfText(buf.slice(0));
    html = pages
      .map((p) => `<h2>Page ${p.page}</h2>` + p.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(""))
      .join("");
  } else {
    html = `<p>${escapeHtml(decoder.decode(buf))}</p>`;
  }

  return { title, html, text: htmlToPlainText(html), path: result.path, size: result.size };
}

export async function importFromPath(path: string): Promise<{ doc: StoredDoc; recent: RecentDoc; error?: string }> {
  const result = await readPathBytes(path);
  if (!result.ok || !result.bytes_base64) {
    const doc = newDoc("txt", "error", "");
    return { doc, recent: toRecent(doc, 0, false), error: result.error ?? "Could not read file" };
  }

  const buf = base64ToArrayBuffer(result.bytes_base64);
  const blob = new Blob([buf.slice(0)]);
  const file = new File([blob], `${result.name}.${result.ext}`, { type: blob.type });
  return importFile(file);
}

export async function checkDocumentPath(path: string): Promise<{ ok: boolean; name: string; size: number; error?: string }> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke("check_document_path", { path });
}

export async function importFile(
  file: File
): Promise<{ doc: StoredDoc; recent: RecentDoc }> {
  const name = file.name;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const title = name.replace(/\.[^.]+$/, "");
  let format: DocFormat = "txt";
  let contentHtml = "";
  let hasSource = false;

  if (ext === "md" || ext === "markdown") {
    format = "md";
    contentHtml = markdownToHtml(await file.text());
  } else if (ext === "txt") {
    format = "txt";
    contentHtml = `<p>${escapeHtml(await file.text()).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  } else if (ext === "html" || ext === "htm") {
    format = "html";
    contentHtml = sanitizeHtml(await file.text());
  } else if (ext === "docx") {
    format = "docx";
    const buf = await file.arrayBuffer();
    const sourceBytes = buf.slice(0);
    contentHtml = sanitizeDocxImportHtml(await docxToHtml(buf.slice(0)));
    hasSource = true;
    const doc = newDoc(format, title, contentHtml);
    await saveDoc(doc);
    await setSourceBytes(doc.id, sourceBytes);
    return { doc, recent: toRecent(doc, file.size, hasSource) };
  } else if (ext === "pptx" || ext === "ppt") {
    format = "pptx";
    const buf = await file.arrayBuffer();
    const sourceBytes = buf.slice(0);
    let parsed: Awaited<ReturnType<typeof parsePptx>>;
    try {
      parsed = await parsePptx(sourceBytes);
    } catch (e) {
      if (ext === "ppt") {
        throw new Error("This .ppt file is not a PPTX package. Please save/export it as .pptx first.");
      }
      throw e;
    }
    const docTitle = parsed.title && parsed.title !== "Presentation" ? parsed.title : title;
    contentHtml = `<h1>${escapeHtml(parsed.title || docTitle)}</h1><p>${parsed.slides.length} slide${parsed.slides.length > 1 ? "s" : ""}</p>`;
    hasSource = true;
    const doc = newDoc(format, docTitle, contentHtml);
    await saveDoc(doc);
    await setSourceBytes(doc.id, sourceBytes);
    await savePptxSlides(doc.id, parsed);
    return { doc, recent: toRecent(doc, file.size, hasSource) };
  } else if (ext === "pdf") {
    format = "pdf";
    const buf = await file.arrayBuffer();
    const sourceBytes = buf.slice(0);
    const { pages } = await extractPdfText(buf.slice(0));
    contentHtml = pages
      .map(
        (p) =>
          `<h2>Page ${p.page}</h2>` +
          p.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")
      )
      .join("");
    hasSource = true;
    const doc = newDoc(format, title, contentHtml);
    await saveDoc(doc);
    await setSourceBytes(doc.id, sourceBytes);
    return { doc, recent: toRecent(doc, file.size, hasSource) };
  } else {
    format = "txt";
    contentHtml = `<p>${escapeHtml(await file.text())}</p>`;
  }

  const doc = newDoc(format, title, contentHtml);
  await saveDoc(doc);
  return { doc, recent: toRecent(doc, file.size, hasSource) };
}

function toRecent(doc: StoredDoc, size: number, hasSource: boolean): RecentDoc {
  return {
    id: doc.id,
    title: doc.title,
    format: doc.format,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    openedAt: Date.now(),
    size,
    hasSource,
  };
}

/* --------------------------------------------------------------------------
   Export a StoredDoc to a Blob
-------------------------------------------------------------------------- */
export async function exportDoc(
  doc: StoredDoc,
  target: DocFormat | "pdf-print"
): Promise<{ blob: Blob; filename: string } | { print: true }> {
  const base = doc.title.replace(/[\\/:*?"<>|]+/g, "_") || "document";

  if (target === "md") {
    return { blob: new Blob([htmlToMarkdown(doc.contentHtml)], { type: "text/markdown" }), filename: `${base}.md` };
  }
  if (target === "html") {
    return { blob: new Blob([wrapStandaloneHtml(doc.contentHtml, doc.title)], { type: "text/html" }), filename: `${base}.html` };
  }
  if (target === "txt") {
    return { blob: new Blob([htmlToPlainText(doc.contentHtml)], { type: "text/plain" }), filename: `${base}.txt` };
  }
  if (target === "docx") {
    const blob = await htmlToDocx(doc.contentHtml, doc.title);
    return { blob, filename: `${base}.docx` };
  }
  if (target === "pdf-print") {
    return { print: true };
  }
  // pdf as a real blob file is produced via print-to-PDF in the UI.
  return { blob: new Blob([doc.contentHtml], { type: "text/html" }), filename: `${base}.html` };
}

/** Convert the current PDF source into a DOCX blob (PDF -> DOCX). */
export async function exportPdfToDocx(doc: StoredDoc): Promise<{ blob: Blob; filename: string }> {
  const bytes = await getSourceBytes(doc.id);
  if (!bytes) throw new Error("Original PDF bytes are missing — cannot convert.");
  const blob = await pdfToDocx(bytes, doc.title);
  return { blob, filename: `${doc.title.replace(/[\\/:*?"<>|]+/g, "_") || "document"}.docx` };
}
