import mammoth from "mammoth/mammoth.browser";
import JSZip from "jszip";
import { renderAsync as renderDocxPreview } from "docx-preview";
import {
  AlignmentType,
  Document as DocxDocument,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  BorderStyle,
} from "docx";
import type { ISectionOptions } from "docx";

/* --------------------------------------------------------------------------
   READ: .docx -> HTML
-------------------------------------------------------------------------- */
export async function docxToText(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer.slice(0) });
  return (result.value || "").replace(/\u00a0/g, " ").trim();
}

export async function docxToHtml(arrayBuffer: ArrayBuffer): Promise<string> {
  // Primary path: visual OOXML renderer. Mammoth is semantic and editable, but
  // it does not preserve exact fonts/sizes/layout. docx-preview renders Word's
  // own styles to CSS, which is much better for reading/import fidelity.
  try {
    const visual = await docxPreviewToHtml(arrayBuffer.slice(0));
    if (visual.trim()) return visual;
  } catch {
    // Fall back to Mammoth below.
  }

  const result = await mammoth.convertToHtml({
    arrayBuffer: arrayBuffer.slice(0),
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Subtitle'] => p.subtitle:fresh",
      "p[style-name='Quote'] => blockquote:fresh",
      "p[style-name='Intense Quote'] => blockquote:fresh",
    ],
  });
  const html = result.value || "<p></p>";
  try {
    return await applyDocxLayoutHints(arrayBuffer.slice(0), html);
  } catch {
    return html;
  }
}

async function docxPreviewToHtml(arrayBuffer: ArrayBuffer): Promise<string> {
  const body = document.createElement("div");
  const styles = document.createElement("div");
  await renderDocxPreview(arrayBuffer, body, styles, {
    className: "wore-docx",
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: true,
    experimental: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderComments: true,
    renderAltChunks: true,
    renderChanges: true,
    ignoreLastRenderedPageBreak: false,
    useBase64URL: true,
  });

  if (!body.textContent?.trim() && !body.querySelector("img,svg,canvas,table")) return "";
  const css = styles.innerHTML;
  const content = body.innerHTML;
  return `<div class="wore-docx-import"><div class="wore-docx-style-host" aria-hidden="true">${css}</div>${content}</div>`;
}

interface ParagraphLayout {
  align?: "left" | "center" | "right" | "justify";
  marginLeft?: number;
  marginRight?: number;
  textIndent?: number;
  marginTop?: number;
  marginBottom?: number;
  pageBreakBefore?: boolean;
  avoidBreakInside?: boolean;
  background?: string;
  borderLeft?: string;
  styleId?: string;
}

interface RunLayout {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  background?: string;
  subscript?: boolean;
  superscript?: boolean;
  smallCaps?: boolean;
  styleId?: string;
}

interface WordRun {
  text: string;
  style: RunLayout;
}

async function applyDocxLayoutHints(arrayBuffer: ArrayBuffer, html: string): Promise<string> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) return html;

  const parser = new DOMParser();
  const documentDoc = parser.parseFromString(documentXml, "application/xml");
  const stylesXml = await zip.file("word/styles.xml")?.async("text").catch(() => undefined);
  const stylesDoc = stylesXml ? parser.parseFromString(stylesXml, "application/xml") : null;
  const paragraphStyles = stylesDoc ? readParagraphStyles(stylesDoc) : new Map<string, ParagraphLayout>();
  const paragraphRunStyles = stylesDoc ? readParagraphStyleRunProperties(stylesDoc) : new Map<string, RunLayout>();
  const characterStyles = stylesDoc ? readCharacterStyles(stylesDoc) : new Map<string, RunLayout>();
  const defaultParagraphStyle = stylesDoc ? readDefaultParagraphStyle(stylesDoc) : {};
  const defaultRunStyle = stylesDoc ? readDefaultRunStyle(stylesDoc) : {};

  const wordParagraphs = elementsByLocalName(documentDoc, "p").map((p) => {
    const pPr = childByLocalName(p, "pPr");
    const directLayout = pPr ? readParagraphProperties(pPr) : {};
    const styleId = directLayout.styleId;
    const styleLayout = styleId ? paragraphStyles.get(styleId) ?? {} : {};
    const pPrRunStyle = pPr ? readParagraphDefaultRunProperties(pPr) : {};
    const paragraphRunStyle = mergeRunLayout(
      defaultRunStyle,
      styleId ? paragraphRunStyles.get(styleId) ?? {} : {},
      pPrRunStyle
    );
    return {
      layout: mergeLayout(defaultParagraphStyle, styleLayout, directLayout),
      runs: readWordRuns(p, paragraphRunStyle, characterStyles),
    };
  });

  if (!wordParagraphs.length) return html;

  const htmlDoc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const targets = htmlParagraphTargets(htmlDoc.body);
  const count = Math.min(targets.length, wordParagraphs.length);
  for (let i = 0; i < count; i++) {
    const p = wordParagraphs[i];
    if (hasUsefulLayout(p.layout)) applyLayoutToElement(targets[i], p.layout);
    if (p.runs.some((run) => hasUsefulRunLayout(run.style))) applyRunStylesToElement(targets[i], p.runs);
  }
  return htmlDoc.body.innerHTML;
}

function readParagraphStyles(stylesDoc: Document): Map<string, ParagraphLayout> {
  const map = new Map<string, ParagraphLayout>();
  for (const style of elementsByLocalName(stylesDoc, "style")) {
    if (attr(style, "type") !== "paragraph") continue;
    const id = attr(style, "styleId");
    const pPr = childByLocalName(style, "pPr");
    if (id && pPr) map.set(id, readParagraphProperties(pPr));
  }
  return map;
}

function readParagraphStyleRunProperties(stylesDoc: Document): Map<string, RunLayout> {
  const map = new Map<string, RunLayout>();
  for (const style of elementsByLocalName(stylesDoc, "style")) {
    if (attr(style, "type") !== "paragraph") continue;
    const id = attr(style, "styleId");
    const rPr = childByLocalName(style, "rPr");
    if (id && rPr) map.set(id, readRunProperties(rPr));
  }
  return map;
}

function readCharacterStyles(stylesDoc: Document): Map<string, RunLayout> {
  const map = new Map<string, RunLayout>();
  for (const style of elementsByLocalName(stylesDoc, "style")) {
    if (attr(style, "type") !== "character") continue;
    const id = attr(style, "styleId");
    const rPr = childByLocalName(style, "rPr");
    if (id && rPr) map.set(id, readRunProperties(rPr));
  }
  return map;
}

function readDefaultParagraphStyle(stylesDoc: Document): ParagraphLayout {
  const docDefaults = childByLocalName(stylesDoc.documentElement, "docDefaults");
  const pPrDefault = docDefaults ? childByLocalName(docDefaults, "pPrDefault") : null;
  const pPr = pPrDefault ? childByLocalName(pPrDefault, "pPr") : null;
  return pPr ? readParagraphProperties(pPr) : {};
}

function readDefaultRunStyle(stylesDoc: Document): RunLayout {
  const docDefaults = childByLocalName(stylesDoc.documentElement, "docDefaults");
  const rPrDefault = docDefaults ? childByLocalName(docDefaults, "rPrDefault") : null;
  const rPr = rPrDefault ? childByLocalName(rPrDefault, "rPr") : null;
  return rPr ? readRunProperties(rPr) : {};
}

function readParagraphDefaultRunProperties(pPr: Element): RunLayout {
  const rPr = childByLocalName(pPr, "rPr");
  return rPr ? readRunProperties(rPr) : {};
}

function readParagraphProperties(pPr: Element): ParagraphLayout {
  const layout: ParagraphLayout = {};

  const pStyle = childByLocalName(pPr, "pStyle");
  if (pStyle) layout.styleId = attr(pStyle, "val");

  const jc = childByLocalName(pPr, "jc");
  const align = jc ? attr(jc, "val") : undefined;
  if (align) {
    if (["center"].includes(align)) layout.align = "center";
    else if (["right", "end"].includes(align)) layout.align = "right";
    else if (["both", "distribute", "thaiDistribute", "mediumKashida", "highKashida", "lowKashida"].includes(align)) layout.align = "justify";
    else if (["left", "start"].includes(align)) layout.align = "left";
  }

  const ind = childByLocalName(pPr, "ind");
  if (ind) {
    const left = numAttr(ind, "left") ?? numAttr(ind, "start");
    const right = numAttr(ind, "right") ?? numAttr(ind, "end");
    const firstLine = numAttr(ind, "firstLine");
    const hanging = numAttr(ind, "hanging");
    if (left !== undefined) layout.marginLeft = twipsToPx(left);
    if (right !== undefined) layout.marginRight = twipsToPx(right);
    if (firstLine !== undefined) layout.textIndent = twipsToPx(firstLine);
    if (hanging !== undefined) layout.textIndent = -twipsToPx(hanging);
  }

  const spacing = childByLocalName(pPr, "spacing");
  if (spacing) {
    const before = numAttr(spacing, "before");
    const after = numAttr(spacing, "after");
    if (before !== undefined) layout.marginTop = twipsToPx(before);
    if (after !== undefined) layout.marginBottom = twipsToPx(after);
  }

  const shading = childByLocalName(pPr, "shd");
  const fill = shading ? attr(shading, "fill") : undefined;
  if (fill && /^[0-9A-Fa-f]{6}$/.test(fill) && fill.toLowerCase() !== "auto") {
    layout.background = `#${fill}`;
  }

  const borders = childByLocalName(pPr, "pBdr");
  const leftBorder = borders ? childByLocalName(borders, "left") : null;
  const borderColor = leftBorder ? attr(leftBorder, "color") : undefined;
  if (borderColor && borderColor.toLowerCase() !== "auto") {
    layout.borderLeft = `3px solid #${borderColor}`;
  }

  if (childByLocalName(pPr, "pageBreakBefore")) layout.pageBreakBefore = true;
  if (childByLocalName(pPr, "keepLines") || childByLocalName(pPr, "keepNext")) layout.avoidBreakInside = true;

  return layout;
}

function readRunProperties(rPr: Element): RunLayout {
  const style: RunLayout = {};

  const rStyle = childByLocalName(rPr, "rStyle");
  if (rStyle) style.styleId = attr(rStyle, "val");

  const rFonts = childByLocalName(rPr, "rFonts");
  if (rFonts) {
    const font =
      attr(rFonts, "ascii") ??
      attr(rFonts, "hAnsi") ??
      attr(rFonts, "eastAsia") ??
      attr(rFonts, "cs") ??
      attr(rFonts, "asciiTheme") ??
      attr(rFonts, "hAnsiTheme");
    if (font) style.fontFamily = themeFontName(font);
  }

  const sz = childByLocalName(rPr, "sz") ?? childByLocalName(rPr, "szCs");
  const halfPoints = sz ? numAttr(sz, "val") : undefined;
  if (halfPoints !== undefined) style.fontSize = halfPointsToPx(halfPoints);

  if (hasOnProperty(rPr, "b") || hasOnProperty(rPr, "bCs")) style.bold = true;
  if (hasOnProperty(rPr, "i") || hasOnProperty(rPr, "iCs")) style.italic = true;
  if (hasOnProperty(rPr, "u")) style.underline = true;
  if (hasOnProperty(rPr, "strike") || hasOnProperty(rPr, "dstrike")) style.strike = true;
  if (hasOnProperty(rPr, "smallCaps")) style.smallCaps = true;

  const color = childByLocalName(rPr, "color");
  const colorVal = color ? attr(color, "val") : undefined;
  if (colorVal && /^[0-9A-Fa-f]{6}$/.test(colorVal) && colorVal.toLowerCase() !== "auto") {
    style.color = `#${colorVal}`;
  }

  const highlight = childByLocalName(rPr, "highlight");
  const highlightVal = highlight ? attr(highlight, "val") : undefined;
  if (highlightVal && highlightVal !== "none") style.background = wordHighlightToCss(highlightVal);
  const shd = childByLocalName(rPr, "shd");
  const fill = shd ? attr(shd, "fill") : undefined;
  if (fill && /^[0-9A-Fa-f]{6}$/.test(fill) && fill.toLowerCase() !== "auto") style.background = `#${fill}`;

  const vert = childByLocalName(rPr, "vertAlign");
  const vertVal = vert ? attr(vert, "val") : undefined;
  if (vertVal === "subscript") style.subscript = true;
  if (vertVal === "superscript") style.superscript = true;

  return style;
}

function readWordRuns(p: Element, paragraphRunStyle: RunLayout, characterStyles: Map<string, RunLayout>): WordRun[] {
  const runs: WordRun[] = [];
  for (const r of [...p.children].filter((el) => el.localName === "r" || el.localName === "hyperlink")) {
    if (r.localName === "hyperlink") {
      for (const nested of [...r.children].filter((el) => el.localName === "r")) {
        pushWordRun(nested, paragraphRunStyle, characterStyles, runs);
      }
    } else {
      pushWordRun(r, paragraphRunStyle, characterStyles, runs);
    }
  }
  return runs;
}

function pushWordRun(r: Element, paragraphRunStyle: RunLayout, characterStyles: Map<string, RunLayout>, out: WordRun[]) {
  const directRPr = childByLocalName(r, "rPr");
  const direct = directRPr ? readRunProperties(directRPr) : {};
  const fromCharacterStyle = direct.styleId ? characterStyles.get(direct.styleId) ?? {} : {};
  const style = mergeRunLayout(paragraphRunStyle, fromCharacterStyle, direct);
  const text = readRunText(r);
  if (text) out.push({ text, style });
}

function readRunText(r: Element): string {
  let text = "";
  for (const child of [...r.children]) {
    switch (child.localName) {
      case "t":
        text += child.textContent ?? "";
        break;
      case "tab":
        text += "\t";
        break;
      case "br":
      case "cr":
        text += "\n";
        break;
      case "noBreakHyphen":
        text += "‑";
        break;
      case "softHyphen":
        text += "\u00ad";
        break;
    }
  }
  return text;
}

function applyRunStylesToElement(el: HTMLElement, runs: WordRun[]) {
  const textNodes = collectTextNodes(el);
  if (!textNodes.length || !runs.length) return;

  let runIndex = 0;
  let runOffset = 0;

  for (const node of textNodes) {
    const source = node.nodeValue ?? "";
    if (!source) continue;
    const frag = el.ownerDocument.createDocumentFragment();
    let offset = 0;

    while (offset < source.length) {
      const run = runs[runIndex];
      if (!run) {
        frag.append(source.slice(offset));
        offset = source.length;
        break;
      }

      const remainingRun = Math.max(1, run.text.length - runOffset);
      const take = Math.min(source.length - offset, remainingRun);
      const piece = source.slice(offset, offset + take);
      frag.append(runStyleNode(el.ownerDocument, piece, run.style));
      offset += take;
      runOffset += take;

      if (runOffset >= run.text.length) {
        runIndex++;
        runOffset = 0;
      }
    }

    node.parentNode?.replaceChild(frag, node);
  }
}

function collectTextNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT) ?? document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) out.push(walker.currentNode as Text);
  return out;
}

function runStyleNode(doc: Document, text: string, style: RunLayout): Node {
  if (!hasUsefulRunLayout(style)) return doc.createTextNode(text);
  const span = doc.createElement("span");
  span.textContent = text;
  applyRunLayoutToElement(span, style);
  return span;
}

function applyRunLayoutToElement(el: HTMLElement, style: RunLayout) {
  if (style.fontFamily) el.style.fontFamily = quoteFontFamily(style.fontFamily);
  if (style.fontSize !== undefined) el.style.fontSize = `${style.fontSize}px`;
  if (style.bold) el.style.fontWeight = "700";
  if (style.italic) el.style.fontStyle = "italic";
  if (style.underline && style.strike) el.style.textDecoration = "underline line-through";
  else if (style.underline) el.style.textDecoration = "underline";
  else if (style.strike) el.style.textDecoration = "line-through";
  if (style.color) el.style.color = style.color;
  if (style.background) el.style.backgroundColor = style.background;
  if (style.subscript) el.style.verticalAlign = "sub";
  if (style.superscript) el.style.verticalAlign = "super";
  if (style.subscript || style.superscript) el.style.fontSize = style.fontSize ? `${Math.round(style.fontSize * 0.75)}px` : "75%";
  if (style.smallCaps) el.style.fontVariant = "small-caps";
}

function mergeRunLayout(...styles: RunLayout[]): RunLayout {
  return Object.assign({}, ...styles.filter(Boolean));
}

function hasUsefulRunLayout(style: RunLayout): boolean {
  return Boolean(
    style.fontFamily ||
      style.fontSize !== undefined ||
      style.bold ||
      style.italic ||
      style.underline ||
      style.strike ||
      style.color ||
      style.background ||
      style.subscript ||
      style.superscript ||
      style.smallCaps
  );
}

function htmlParagraphTargets(body: HTMLElement): HTMLElement[] {
  const selector = "p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th";
  return [...body.querySelectorAll<HTMLElement>(selector)].filter((el) => {
    if (el.matches("td,th")) {
      return !el.querySelector("p,h1,h2,h3,h4,h5,h6,li,blockquote");
    }
    return true;
  });
}

function applyLayoutToElement(el: HTMLElement, layout: ParagraphLayout) {
  if (layout.align) el.style.textAlign = layout.align;
  if (layout.marginLeft !== undefined) el.style.marginLeft = `${layout.marginLeft}px`;
  if (layout.marginRight !== undefined) el.style.marginRight = `${layout.marginRight}px`;
  if (layout.textIndent !== undefined) el.style.textIndent = `${layout.textIndent}px`;
  if (layout.marginTop !== undefined) el.style.marginTop = `${layout.marginTop}px`;
  if (layout.marginBottom !== undefined) el.style.marginBottom = `${layout.marginBottom}px`;
  if (layout.pageBreakBefore) el.style.breakBefore = "page";
  if (layout.avoidBreakInside) el.style.breakInside = "avoid";
  if (layout.background) {
    el.style.backgroundColor = layout.background;
    el.style.paddingInline = el.style.paddingInline || "0.25rem";
  }
  if (layout.borderLeft) {
    el.style.borderLeft = layout.borderLeft;
    el.style.paddingLeft = el.style.paddingLeft || "0.5rem";
  }
}

function mergeLayout(...layouts: ParagraphLayout[]): ParagraphLayout {
  return Object.assign({}, ...layouts.filter(Boolean));
}

function hasUsefulLayout(layout: ParagraphLayout): boolean {
  return Boolean(
    layout.align ||
      layout.marginLeft !== undefined ||
      layout.marginRight !== undefined ||
      layout.textIndent !== undefined ||
      layout.marginTop !== undefined ||
      layout.marginBottom !== undefined ||
      layout.pageBreakBefore ||
      layout.avoidBreakInside ||
      layout.background ||
      layout.borderLeft
  );
}

function elementsByLocalName(root: Document | Element, localName: string): Element[] {
  return [...root.getElementsByTagName("*")].filter((el) => el.localName === localName);
}

function childByLocalName(root: Element, localName: string): Element | null {
  return [...root.children].find((el) => el.localName === localName) ?? null;
}

function attr(el: Element, localName: string): string | undefined {
  return (
    el.getAttribute(`w:${localName}`) ??
    el.getAttribute(localName) ??
    [...el.attributes].find((a) => a.localName === localName)?.value ??
    undefined
  );
}

function numAttr(el: Element, localName: string): number | undefined {
  const v = attr(el, localName);
  if (!v || !/^-?\d+$/.test(v)) return undefined;
  return Number(v);
}

function hasOnProperty(parent: Element, localName: string): boolean {
  const el = childByLocalName(parent, localName);
  if (!el) return false;
  const val = attr(el, "val");
  return val !== "0" && val !== "false" && val !== "off";
}

function twipsToPx(twips: number): number {
  return Math.round((twips / 1440) * 96);
}

function halfPointsToPx(halfPoints: number): number {
  return Math.round(((halfPoints / 2) * 96) / 72);
}

function themeFontName(font: string): string {
  const map: Record<string, string> = {
    majorHAnsi: "Aptos Display",
    majorAscii: "Aptos Display",
    majorEastAsia: "Aptos Display",
    majorBidi: "Aptos Display",
    minorHAnsi: "Aptos",
    minorAscii: "Aptos",
    minorEastAsia: "Aptos",
    minorBidi: "Aptos",
  };
  return map[font] ?? font;
}

function wordHighlightToCss(v: string): string {
  const map: Record<string, string> = {
    yellow: "#ffff00",
    green: "#00ff00",
    cyan: "#00ffff",
    magenta: "#ff00ff",
    blue: "#0000ff",
    red: "#ff0000",
    darkBlue: "#000080",
    darkCyan: "#008080",
    darkGreen: "#008000",
    darkMagenta: "#800080",
    darkRed: "#800000",
    darkYellow: "#808000",
    darkGray: "#808080",
    lightGray: "#c0c0c0",
    black: "#000000",
  };
  return map[v] ?? v;
}

function quoteFontFamily(font: string): string {
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(font)) return font;
  return font.includes(" ") ? `"${font.replace(/"/g, "")}"` : font;
}

/* --------------------------------------------------------------------------
   WRITE: HTML -> .docx Blob
-------------------------------------------------------------------------- */

const INCH = 96; // CSS px per inch
const DEFAULT_MARGIN_IN = 1;
const TWIPS_PER_INCH = 1440; // Word page margins are expressed in twips.

/**
 * Collect the top-level block elements to emit, in document order.
 *
 * Imported DOCX content is wrapped as
 *   <div class="wore-docx-import"><div class="wore-docx-style-host">…CSS…</div>…</div>
 * with the real content deeply nested (section > article > p/h/table). Walking
 * `body.children` would treat the whole wrapper as one block and dump the CSS as
 * body text. Instead we strip the style host and pick the real block-level
 * elements, skipping any nested inside a container we already handle (table,
 * list, figure, blockquote, pre).
 */
function collectBlockElements(body: HTMLElement): HTMLElement[] {
  body.querySelectorAll(".wore-docx-style-host, style, script").forEach((n) => n.remove());
  const wrapper = body.querySelector<HTMLElement>(".wore-docx-import, .wore-docx");
  if (!wrapper) return [...body.children] as HTMLElement[];

  const HANDLED_CONTAINERS = "table,ul,ol,figure,blockquote,pre";
  const blocks = [
    ...wrapper.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote,pre,figure,img"),
  ];
  return blocks.filter((el) => {
    // Skip elements nested inside a container that has its own handler.
    const container = el.parentElement?.closest(HANDLED_CONTAINERS);
    if (container && wrapper.contains(container)) return false;
    // Skip a bare <img> that lives inside a <figure> (handled by figure branch).
    if (el.tagName === "IMG" && el.closest("figure")) return false;
    return true;
  });
}

async function fetchImageBytes(src: string): Promise<{ data: Uint8Array; width: number; height: number; type: "png" | "jpg" | "gif" | "bmp" } | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    const data = new Uint8Array(await blob.arrayBuffer());
    const dims = await imageSize(blob).catch(() => null);
    const type: "png" | "jpg" | "gif" | "bmp" = blob.type.includes("png")
      ? "png"
      : blob.type.includes("gif")
      ? "gif"
      : blob.type.includes("bmp")
      ? "bmp"
      : "jpg";
    return { data, width: dims?.width ?? 400, height: dims?.height ?? 300, type };
  } catch {
    return null;
  }
}

async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    if (blob.type.includes("png") || blob.type.includes("jpeg") || blob.type.includes("webp")) {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  return { width: 400, height: 300 };
}

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  size?: number;
  font?: string;
  highlight?: boolean;
}

function parseColor(style: string): string | undefined {
  const m = style.match(/color:\s*(#?[0-9a-fA-F]{3,8}|[a-z]+)/);
  if (!m) return undefined;
  let c = m[1].replace("#", "");
  if (c === "inherit" || c === "currentColor" || c === "transparent") return undefined;
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  if (/^[0-9a-fA-F]{6}$/.test(c)) return c.toUpperCase();
  return undefined;
}

function inlineToRuns(node: Node, base: RunStyle, out: (TextRun | ExternalHyperlink)[], link?: string) {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (!text) return;
      const runOpts = {
        text,
        bold: base.bold,
        italics: base.italics,
        underline: base.underline ? {} : undefined,
        strike: base.strike,
        color: base.color,
        size: base.size,
        font: base.font,
        highlight: base.highlight ? "yellow" : undefined,
      } as Record<string, unknown>;
      if (link) {
        out.push(new ExternalHyperlink({ link, children: [new TextRun({ ...runOpts, style: "Hyperlink" })] }));
      } else {
        out.push(new TextRun(runOpts));
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const style = el.getAttribute("style") ?? "";
      const next: RunStyle = {
        ...base,
        color: parseColor(style) ?? base.color,
        font: /font-family:\s*([^;]+)/i.exec(style)?.[1]?.replace(/["']/g, "").split(",")[0]?.trim() ?? base.font,
      };
      const sizeMatch = style.match(/font-size:\s*([\d.]+)px/);
      if (sizeMatch) next.size = Math.round(parseFloat(sizeMatch[1]) * 2);
      switch (tag) {
        case "strong":
        case "b":
          next.bold = true;
          break;
        case "em":
        case "i":
          next.italics = true;
          break;
        case "u":
          next.underline = true;
          break;
        case "s":
        case "strike":
        case "del":
          next.strike = true;
          break;
        case "mark":
          next.highlight = true;
          break;
        case "code":
          next.font = "Consolas";
          break;
        case "a": {
          const href = el.getAttribute("href") || "#";
          inlineToRuns(el, next, out, href);
          return;
        }
        case "br":
          out.push(new TextRun({ text: "", break: 1 }));
          return;
      }
      inlineToRuns(el, next, out, link);
    }
  });
}

function paraFromInline(htmlEl: HTMLElement, opts: Record<string, unknown> = {}): Paragraph {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  inlineToRuns(htmlEl, {}, runs);
  return new Paragraph({ children: runs.length ? runs : [new TextRun({ text: "" })], ...opts });
}

function headingLevel(tag: string): (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined {
  switch (tag) {
    case "h1": return HeadingLevel.HEADING_1;
    case "h2": return HeadingLevel.HEADING_2;
    case "h3": return HeadingLevel.HEADING_3;
    case "h4": return HeadingLevel.HEADING_4;
    case "h5": return HeadingLevel.HEADING_5;
    case "h6": return HeadingLevel.HEADING_6;
    default: return undefined;
  }
}

const alignMap: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

async function imageRunFrom(img: HTMLImageElement): Promise<ImageRun | null> {
  const fetched = await fetchImageBytes(img.src);
  if (!fetched) return null;
  const styleW = img.style.width;
  const pct = styleW?.includes("%") ? parseFloat(styleW) : 100;
  const maxW = Math.round(576 * (pct / 100));
  let { width, height } = fetched;
  if (width > maxW) {
    height = Math.round((height * maxW) / width);
    width = maxW;
  }
  return new ImageRun({ data: fetched.data, transformation: { width, height }, type: fetched.type });
}

function pushListItems(list: HTMLElement, out: (Paragraph | Table)[], level = 0) {
  const ordered = list.tagName.toLowerCase() === "ol";
  list.querySelectorAll(":scope > li").forEach((li) => {
    const runs: (TextRun | ExternalHyperlink)[] = [];
    const nested: HTMLElement[] = [];
    li.childNodes.forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE && /^UL|OL$/i.test((child as HTMLElement).tagName)) {
        nested.push(child as HTMLElement);
      } else if (child.nodeType === Node.TEXT_NODE && child.textContent) {
        runs.push(new TextRun({ text: child.textContent }));
      } else {
        inlineToRuns(child as HTMLElement, {}, runs);
      }
    });
    out.push(new Paragraph({
      children: runs.length ? runs : [new TextRun({ text: "" })],
      numbering: ordered ? { reference: "wore-num", level } : { reference: "wore-bul", level },
    }));
    nested.forEach((n) => pushListItems(n, out, level + 1));
  });
}

function htmlTableToDocx(table: HTMLElement): Table {
  const rows: TableRow[] = [];
  table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr").forEach((tr) => {
    const cells: TableCell[] = [];
    tr.querySelectorAll(":scope > th, :scope > td").forEach((cellEl) => {
      const runs: (TextRun | ExternalHyperlink)[] = [];
      inlineToRuns(cellEl as HTMLElement, { bold: cellEl.tagName.toLowerCase() === "th" }, runs);
      cells.push(new TableCell({ children: [new Paragraph({ children: runs.length ? runs : [new TextRun({ text: "" })] })] }));
    });
    if (cells.length) rows.push(new TableRow({ children: cells }));
  });
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

export async function htmlToDocx(html: string, title = "Document"): Promise<Blob> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;
  const children: (Paragraph | Table)[] = [];
  const blockEls = collectBlockElements(body);

  for (const el of blockEls) {
    const tag = el.tagName.toLowerCase();
    const style = el.getAttribute("style") ?? "";
    const align = /text-align:\s*(left|center|right|justify)/i.exec(style)?.[1];

    if (/^h[1-6]$/.test(tag)) {
      const level = headingLevel(tag);
      const runs: (TextRun | ExternalHyperlink)[] = [];
      inlineToRuns(el, { bold: true }, runs);
      children.push(new Paragraph({ heading: level, alignment: align ? (alignMap as any)[align] : undefined, children: runs }));
    } else if (tag === "p") {
      children.push(paraFromInline(el, { alignment: align ? (alignMap as any)[align] : undefined }));
    } else if (tag === "ul" || tag === "ol") {
      pushListItems(el, children);
    } else if (tag === "blockquote") {
      const runs: (TextRun | ExternalHyperlink)[] = [];
      inlineToRuns(el, { italics: true }, runs);
      children.push(new Paragraph({ children: runs.length ? runs : [new TextRun({ text: "" })], indent: { left: 720 }, spacing: { before: 120, after: 120 } }));
    } else if (tag === "pre") {
      const code = el.textContent ?? "";
      code.split("\n").forEach((line) =>
        children.push(new Paragraph({ children: [new TextRun({ text: line || " ", font: "Consolas", size: 20 })], shading: { type: ShadingType.SOLID, color: "auto", fill: "F3F0E7" } }))
      );
    } else if (tag === "hr") {
      children.push(new Paragraph({ border: { bottom: { color: "CCCCCC", style: BorderStyle.SINGLE, size: 6, space: 1 } } }));
    } else if (tag === "table") {
      children.push(htmlTableToDocx(el));
    } else if (tag === "img") {
      const img = await imageRunFrom(el as HTMLImageElement);
      if (img) children.push(new Paragraph({ children: [img], alignment: AlignmentType.CENTER }));
    } else if (tag === "figure") {
      const img = el.querySelector("img");
      if (img) {
        const run = await imageRunFrom(img as HTMLImageElement);
        if (run) children.push(new Paragraph({ children: [run], alignment: AlignmentType.CENTER }));
      }
      const cap = el.querySelector("figcaption");
      if (cap) children.push(new Paragraph({ children: [new TextRun({ text: cap.textContent ?? "", italics: true, size: 18, color: "6F6657" })], alignment: AlignmentType.CENTER }));
    } else if (el.classList.contains("wore-textbox")) {
      const runs: (TextRun | ExternalHyperlink)[] = [];
      inlineToRuns(el, {}, runs);
      children.push(new Paragraph({
        children: runs.length ? runs : [new TextRun({ text: "" })],
        border: { left: { color: "B06A12", style: BorderStyle.SINGLE, size: 18, space: 4 } },
        shading: { type: ShadingType.SOLID, color: "auto", fill: "F3E6CF" },
        spacing: { before: 120, after: 120 },
      }));
    } else {
      children.push(paraFromInline(el));
    }
  }

  if (!children.length) children.push(new Paragraph({ children: [new TextRun({ text: "" })] }));

  const section: ISectionOptions = {
    properties: {
      page: {
        margin: {
          top: DEFAULT_MARGIN_IN * TWIPS_PER_INCH,
          bottom: DEFAULT_MARGIN_IN * TWIPS_PER_INCH,
          left: DEFAULT_MARGIN_IN * TWIPS_PER_INCH,
          right: DEFAULT_MARGIN_IN * TWIPS_PER_INCH,
        },
      },
    },
    children,
  };

  const docx = new DocxDocument({
    creator: "WoRe by Nayhein.com",
    title,
    numbering: {
      config: [
        {
          reference: "wore-bul",
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
            { level: 1, format: LevelFormat.BULLET, text: "\u25e6", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 940, hanging: 360 } } } },
            { level: 2, format: LevelFormat.BULLET, text: "\u25b8", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1160, hanging: 360 } } } },
            { level: 3, format: LevelFormat.BULLET, text: "\u25aa", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1380, hanging: 360 } } } },
          ],
        },
        {
          reference: "wore-num",
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
            { level: 1, format: LevelFormat.DECIMAL, text: "%1.%2.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 940, hanging: 360 } } } },
            { level: 2, format: LevelFormat.DECIMAL, text: "%1.%2.%3.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1160, hanging: 360 } } } },
            { level: 3, format: LevelFormat.DECIMAL, text: "%1.%2.%3.%4.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1380, hanging: 360 } } } },
          ],
        },
      ],
    },
    sections: [section],
  });

  return Packer.toBlob(docx);
}
