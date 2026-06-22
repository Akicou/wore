import JSZip from "jszip";

export interface PptxSlide {
  index: number;
  html: string;
  notes: string;
  title: string;
}

export interface ParsedPptx {
  title: string;
  slides: PptxSlide[];
}

/* --------------------------------------------------------------------------
   PPTX parser — extract slides, images and speaker notes
-------------------------------------------------------------------------- */

export async function parsePptx(arrayBuffer: ArrayBuffer): Promise<ParsedPptx> {
  const zip = await JSZip.loadAsync(arrayBuffer);

  const presentationXml = await zip.file("ppt/presentation.xml")?.async("text");
  if (!presentationXml) throw new Error("Invalid .pptx: missing presentation.xml");

  const parser = new DOMParser();
  const presentationDoc = parser.parseFromString(presentationXml, "application/xml");

  const presRelsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("text");
  if (!presRelsXml) throw new Error("Invalid .pptx: missing presentation rels");
  const presRelsDoc = parser.parseFromString(presRelsXml, "application/xml");

  const slideRels = new Map<string, string>();
  for (const rel of elementsByLocalName(presRelsDoc, "Relationship")) {
    const id = attr(rel, "Id");
    const type = attr(rel, "Type") ?? "";
    const target = attr(rel, "Target");
    if (id && target && type.includes("/slide")) {
      slideRels.set(id, resolveZipPath("ppt", target));
    }
  }

  const sldIdLst = childByLocalName(presentationDoc.documentElement, "sldIdLst");
  const orderedRids: string[] = [];
  if (sldIdLst) {
    for (const sldId of elementsByLocalName(sldIdLst, "sldId")) {
      const rid = attr(sldId, "id") ?? attr(sldId, "Id");
      if (rid && slideRels.has(rid)) orderedRids.push(rid);
    }
  }

  let overallTitle = "Presentation";
  const coreXml = await zip.file("docProps/core.xml")?.async("text");
  if (coreXml) {
    const coreDoc = parser.parseFromString(coreXml, "application/xml");
    const titleEl = [...coreDoc.getElementsByTagName("*")].find((el) => el.localName === "title");
    if (titleEl?.textContent) overallTitle = titleEl.textContent.trim();
  }

  const slides: PptxSlide[] = [];

  for (let i = 0; i < orderedRids.length; i++) {
    const rid = orderedRids[i];
    const slidePath = slideRels.get(rid)!;

    const slideXml = await zip.file(slidePath)?.async("text");
    if (!slideXml) continue;

    const slideDoc = parser.parseFromString(slideXml, "application/xml");

    const baseFolder = slidePath.substring(0, slidePath.lastIndexOf("/"));
    const slideRelPath = `${baseFolder}/_rels/${slidePath.split("/").pop()!}.rels`;
    const imageMap = new Map<string, string>(); // r:id → data url
    let notesPath: string | null = null;

    const slideRelsXml = await zip.file(slideRelPath)?.async("text");
    if (slideRelsXml) {
      const sRelsDoc = parser.parseFromString(slideRelsXml, "application/xml");
      for (const rel of elementsByLocalName(sRelsDoc, "Relationship")) {
        const id = attr(rel, "Id");
        const type = attr(rel, "Type") ?? "";
        const target = attr(rel, "Target");
        if (!id || !target) continue;
        if (type.includes("/image")) {
          const imgPath = resolveZipPath(baseFolder, target);
          const imgBytes = await zip.file(imgPath)?.async("uint8array");
          if (imgBytes) {
            const mime = imageMimeFromBytes(imgBytes, imgPath);
            if (mime) imageMap.set(id, `data:${mime};base64,${bytesToBase64(imgBytes)}`);
          }
        } else if (type.includes("/notesSlide")) {
          notesPath = resolveZipPath(baseFolder, target);
        }
      }
    }

    const slideHtml = slideToHtml(slideDoc, imageMap);
    const title = extractSlideTitle(slideDoc) || `Slide ${i + 1}`;

    let notesText = "";
    if (notesPath) {
      const notesXml = await zip.file(notesPath)?.async("text");
      if (notesXml) {
        const notesDoc = parser.parseFromString(notesXml, "application/xml");
        notesText = extractNotesText(notesDoc);
      }
    }

    slides.push({ index: i, html: slideHtml, notes: notesText, title });
  }

  // fallback title from first slide title
  if (!overallTitle && slides[0]?.title) overallTitle = slides[0].title;

  return { title: overallTitle, slides };
}

/* --------------------------------------------------------------------------
   Storage helpers (separate from StoredDoc so we don't bloat contentHtml)
-------------------------------------------------------------------------- */

const pptxKey = (id: string) => `pptx:${id}`;

import { idbGet, idbSet, idbDel } from "../idb";

export async function savePptxSlides(id: string, parsed: ParsedPptx): Promise<void> {
  await idbSet(pptxKey(id), parsed);
}

export async function loadPptxSlides(id: string): Promise<ParsedPptx | undefined> {
  return idbGet<ParsedPptx>(pptxKey(id));
}

export async function deletePptxSlides(id: string): Promise<void> {
  await idbDel(pptxKey(id));
}

/* --------------------------------------------------------------------------
   HTML generation from slide XML
-------------------------------------------------------------------------- */

function slideToHtml(slideDoc: Document, imageMap: Map<string, string>): string {
  const items = extractSlideItems(slideDoc, imageMap);
  const parts = items.map((item) => {
    if (item.type === "text") {
      return `<div class="pptx-shape-text">${item.content}</div>`;
    }
    return `<img src="${item.content}" class="pptx-shape-img" alt="" />`;
  });

  // Background colour heuristic
  const bgFill = slideDoc.querySelector("cSld > bg > bgPr > solidFill > srgbClr") ??
    slideDoc.querySelector("cSld > bg > bgRef > srgbClr");
  let bgStyle = "";
  if (bgFill) {
    const val = attr(bgFill, "val");
    if (val && /^[0-9A-Fa-f]{6}$/.test(val)) bgStyle = `background:#${val};`;
  }

  return `<div class="pptx-slide" style="${bgStyle}">${parts.join("")}</div>`;
}

interface SlideItem {
  type: "text" | "image";
  x: number;
  y: number;
  content: string;
}

function extractSlideItems(slideDoc: Document, imageMap: Map<string, string>): SlideItem[] {
  const spTree = childByLocalName(slideDoc.documentElement, "cSld")
    ? childByLocalName(slideDoc.documentElement, "cSld")
    : null;
  const tree = spTree ? childByLocalName(spTree, "spTree") : null;
  if (!tree) return [];

  const items: SlideItem[] = [];

  for (const child of [...tree.children]) {
    const local = child.localName;
    const spPr = childByLocalName(child, "spPr");
    const xf = spPr ? childByLocalName(spPr, "xfrm") : null;
    let x = 0, y = 0;
    if (xf) {
      const off = childByLocalName(xf, "off");
      if (off) {
        x = Number(off.getAttribute("x") || off.getAttribute("X") || "0");
        y = Number(off.getAttribute("y") || off.getAttribute("Y") || "0");
      }
    }

    if (local === "sp") {
      const txBody = childByLocalName(child, "txBody");
      if (txBody) {
        const paragraphs: string[] = [];
        for (const p of elementsByLocalName(txBody, "p")) {
          let text = "";
          for (const t of elementsByLocalName(p, "t")) {
            text += t.textContent ?? "";
          }
          if (text.trim()) paragraphs.push(escapeHtml(text.trim()));
        }
        if (paragraphs.length) {
          const html = paragraphs.map((t) => `<p>${t}</p>`).join("");
          items.push({ type: "text", x, y, content: html });
        }
      }
    } else if (local === "pic") {
      const blip = childByLocalNameDeep(child, "blip");
      if (blip) {
        const embed = attr(blip, "embed") ?? blip.getAttribute("r:embed") ??
          blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed");
        if (embed && imageMap.has(embed)) {
          items.push({ type: "image", x, y, content: imageMap.get(embed)! });
        }
      }
    } else if (local === "graphicFrame") {
      // Tables / SmartArt — extract text as plain paragraphs for now
      const paragraphs: string[] = [];
      for (const p of elementsByLocalName(child, "p")) {
        let text = "";
        for (const t of elementsByLocalName(p, "t")) {
          text += t.textContent ?? "";
        }
        if (text.trim()) paragraphs.push(escapeHtml(text.trim()));
      }
      if (paragraphs.length) {
        items.push({ type: "text", x, y, content: paragraphs.map((t) => `<p>${t}</p>`).join("") });
      }
    }
  }

  items.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  return items;
}

function extractSlideTitle(slideDoc: Document): string | undefined {
  const tree = childByLocalName(slideDoc.documentElement, "cSld")
    ? childByLocalName(slideDoc.documentElement, "cSld")
    : null;
  const spTree = tree ? childByLocalName(tree, "spTree") : null;
  if (!spTree) return undefined;

  for (const sp of elementsByLocalName(spTree, "sp")) {
    const nvSpPr = childByLocalName(sp, "nvSpPr");
    const nvPr = nvSpPr ? childByLocalName(nvSpPr, "nvPr") : null;
    const ph = nvPr ? childByLocalName(nvPr, "ph") : null;
    const phType = ph ? attr(ph, "type") : undefined;
    if (phType !== "title" && phType !== "ctrTitle") continue;

    const txBody = childByLocalName(sp, "txBody");
    if (!txBody) continue;
    let text = "";
    for (const p of elementsByLocalName(txBody, "p")) {
      for (const t of elementsByLocalName(p, "t")) text += t.textContent ?? "";
    }
    if (text.trim()) return text.trim();
  }

  return undefined;
}

function extractNotesText(notesDoc: Document): string {
  const cSld = childByLocalName(notesDoc.documentElement, "cSld");
  const spTree = cSld ? childByLocalName(cSld, "spTree") : null;
  if (!spTree) return "";

  const texts: string[] = [];
  for (const sp of elementsByLocalName(spTree, "sp")) {
    const nvSpPr = childByLocalName(sp, "nvSpPr");
    const nvPr = nvSpPr ? childByLocalName(nvSpPr, "nvPr") : null;
    const ph = nvPr ? childByLocalName(nvPr, "ph") : null;
    const phType = ph ? attr(ph, "type") : undefined;
    if (phType === "slideImage") continue;

    const txBody = childByLocalName(sp, "txBody");
    if (!txBody) continue;
    for (const p of elementsByLocalName(txBody, "p")) {
      let text = "";
      for (const t of elementsByLocalName(p, "t")) text += t.textContent ?? "";
      if (text.trim()) texts.push(text.trim());
    }
  }
  return texts.join("\n");
}

/* --------------------------------------------------------------------------
   Helpers
-------------------------------------------------------------------------- */

function elementsByLocalName(root: Document | Element, localName: string): Element[] {
  return [...root.getElementsByTagName("*")].filter((el) => el.localName === localName);
}

function childByLocalName(root: Element, localName: string): Element | null {
  return [...root.children].find((el) => el.localName === localName) ?? null;
}

function childByLocalNameDeep(root: Element, localName: string): Element | null {
  const found = root.querySelector(localName);
  if (found && found.localName === localName) return found;
  // In XML documents with prefixes, querySelector(localName) may not match.
  // Walk descendants.
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_ELEMENT) ?? document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    if ((walker.currentNode as Element).localName === localName) return walker.currentNode as Element;
  }
  return null;
}

function attr(el: Element, localName: string): string | undefined {
  return (
    el.getAttribute(`p:${localName}`) ??
    el.getAttribute(`a:${localName}`) ??
    el.getAttribute(`r:${localName}`) ??
    el.getAttribute(localName) ??
    [...el.attributes].find((a) => a.localName === localName)?.value ??
    undefined
  );
}

function resolveZipPath(baseDir: string, target: string): string {
  const raw = target.startsWith("/") ? target.slice(1) : `${baseDir}/${target}`;
  const parts: string[] = [];
  for (const part of raw.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function imageMimeFromBytes(bytes: Uint8Array, fileName = ""): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6) {
    const sig6 = asciiPrefix(bytes, 6);
    if (sig6 === "GIF87a" || sig6 === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  if (bytes.length >= 12 && asciiPrefix(bytes, 4) === "RIFF" && asciiSlice(bytes, 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "image/avif";
  const text = asciiPrefix(bytes, Math.min(bytes.length, 64)).trimStart().toLowerCase();
  if (text.startsWith("<svg") || text.startsWith("<?xml")) return "image/svg+xml";

  const ext = fileName.toLowerCase().split(".").pop();
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "bmp": return "image/bmp";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    case "avif": return "image/avif";
    default: return null;
  }
}

function asciiPrefix(bytes: Uint8Array, n: number): string {
  return asciiSlice(bytes, 0, Math.min(n, bytes.length));
}

function asciiSlice(bytes: Uint8Array, start: number, end: number): string {
  let text = "";
  for (let i = start; i < end && i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
