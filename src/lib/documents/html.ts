/* HTML helpers shared by the editor, converters and exporters. */

/* --------------------------------------------------------------------------
   Sanitization
   --------------------------------------------------------------------------
   All HTML that ends up in the editor via innerHTML / dangerouslySetInnerHTML
   (markdown imports, HTML imports, DOCX imports, AI output) must pass through
   here first. The strict CSP blocks inline scripts, but sanitizing is the
   primary defense — we never rely on the CSP alone.
*/

// Tags that may appear in editor/document content. Anything not listed is
// either dropped entirely (dangerous) or unwrapped (unknown but harmless).
const ALLOWED_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br",
  "caption", "cite", "code", "col", "colgroup", "data", "dd", "del", "details", "dfn",
  "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main", "mark", "nav",
  "ol", "p", "pre", "q", "s", "samp", "section", "small", "span", "strong", "sub",
  "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr",
  "u", "ul", "var", "wbr",
]);

// Tags removed together with all of their children (never just unwrapped).
const DANGEROUS_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "link", "meta", "base",
  "form", "input", "textarea", "select", "button", "option", "svg", "math",
  "noscript", "template", "frame", "frameset", "applet", "audio", "video", "source", "track",
]);

const ALLOWED_ATTR = new Set([
  "style", "class", "id", "title", "dir", "lang", "align", "valign",
  "href", "target", "rel",
  "src", "alt", "width", "height", "loading",
  "colspan", "rowspan", "scope", "headers", "start", "reversed", "type",
  "value", "datetime", "cite",
]);

/** Reject dangerous URL schemes (javascript:, vbscript:, data:text/html, …). */
function safeUrl(value: string, opts: { allowDataImage?: boolean } = {}): string | null {
  const v = value.trim();
  // Relative URLs, anchors and protocol-relative-to-same-origin are fine.
  if (v === "" || v.startsWith("#") || v.startsWith("/")) return v;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v)?.[1]?.toLowerCase();
  if (!scheme) return v; // relative path
  if (scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel" || scheme === "blob") return v;
  if (scheme === "data") {
    // Only allow image data URLs (used for embedded/pasted/generated images).
    if (opts.allowDataImage && /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif);/i.test(v)) return v;
    return null;
  }
  return null; // javascript:, vbscript:, file:, etc.
}

/** Drop inline styles that can execute script or break out of the sandbox. */
function safeStyle(value: string): string | null {
  if (/expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:|@import/i.test(value)) return null;
  return value;
}

function scrubAttributes(el: Element, opts: { keepStyle?: boolean } = {}) {
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on") || !ALLOWED_ATTR.has(name)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === "href") {
      const safe = safeUrl(attr.value);
      if (safe === null) el.removeAttribute(attr.name);
    } else if (name === "src") {
      const safe = safeUrl(attr.value, { allowDataImage: true });
      if (safe === null) el.removeAttribute(attr.name);
    } else if (name === "style") {
      if (!opts.keepStyle || safeStyle(attr.value) === null) el.removeAttribute(attr.name);
    }
  }
  // Harden any link that opens a new context.
  if (el.tagName === "A" && el.getAttribute("target") === "_blank") {
    el.setAttribute("rel", "noopener noreferrer");
  }
}

function walkSanitize(root: ParentNode) {
  // Snapshot first — we mutate the tree as we go.
  for (const el of [...root.querySelectorAll("*")]) {
    if (!el.isConnected) continue;
    const tag = el.tagName.toLowerCase();
    if (DANGEROUS_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown but not inherently dangerous: keep the text, drop the wrapper.
      el.replaceWith(...el.childNodes);
      continue;
    }
    scrubAttributes(el, { keepStyle: true });
  }
}

/** Allowlist sanitizer for editor/import/AI HTML. Strips <style>, scripts and handlers. */
export function sanitizeHtml(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  walkSanitize(tpl.content);
  return tpl.innerHTML;
}

/**
 * Sanitizer for imported DOCX HTML. Unlike `sanitizeHtml`, it preserves the
 * `<style>` host that docx-preview emits (needed for layout fidelity) but
 * neutralizes script vectors and strips remote `url(...)` / `@import` so a
 * malicious document cannot beacon out or execute code.
 */
export function sanitizeDocxImportHtml(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;

  // Remove genuinely dangerous tags but keep <style>.
  tpl.content
    .querySelectorAll(
      "script, iframe, object, embed, link, meta, base, form, input, textarea, select, button, frame, frameset, applet"
    )
    .forEach((n) => n.remove());

  // Scrub stylesheet text: kill @import, javascript: and remote url() beacons.
  tpl.content.querySelectorAll("style").forEach((styleEl) => {
    styleEl.textContent = (styleEl.textContent ?? "")
      .replace(/@import[^;]+;?/gi, "")
      .replace(/expression\s*\([^)]*\)/gi, "")
      .replace(/url\(\s*(['"]?)\s*(?:https?:|\/\/)[^)]*\1\s*\)/gi, "url()")
      .replace(/javascript:/gi, "");
  });

  // Scrub element attributes (keep inline styles for fidelity).
  tpl.content.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if (name === "href") {
        if (safeUrl(attr.value) === null) el.removeAttribute(attr.name);
      } else if (name === "src") {
        if (safeUrl(attr.value, { allowDataImage: true }) === null) el.removeAttribute(attr.name);
      } else if (name === "style") {
        const safe = safeStyle(attr.value);
        if (safe === null) el.removeAttribute(attr.name);
        else el.setAttribute("style", safe.replace(/url\(\s*(['"]?)\s*(?:https?:|\/\/)[^)]*\1\s*\)/gi, "url()"));
      }
    }
  });

  return tpl.innerHTML;
}

/** Strip block-level wrappers to get plain paragraphs of text. */
export function htmlToPlainText(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return nodeToPlainText(tpl.content);
}

/** Extract human-visible text from a DOM tree. Never include CSS/JS/style hosts. */
export function nodeToPlainText(root: ParentNode): string {
  const clone = root.cloneNode(true) as ParentNode;
  if ("querySelectorAll" in clone) {
    clone
      .querySelectorAll(
        "script, style, noscript, template, iframe, object, embed, link, meta, [aria-hidden='true'], .wore-docx-style-host"
      )
      .forEach((n) => n.remove());
    clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    clone.querySelectorAll("p,div,section,article,header,footer,li,tr,h1,h2,h3,h4,h5,h6").forEach((el) => {
      el.append(document.createTextNode("\n"));
    });
  }
  return ((clone as Node).textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Inline the CSS color for a node tree is intentionally not done here —
 *  exporters handle formatting explicitly. */

/** Count words from an HTML string. */
export function wordCount(html: string): number {
  const t = htmlToPlainText(html);
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

/** Count characters (excluding HTML). */
export function charCount(html: string): number {
  return htmlToPlainText(html).length;
}

/** Approx reading time in minutes (200 wpm). */
export function readingTimeMin(html: string): number {
  return Math.max(1, Math.round(wordCount(html) / 200));
}

/** Wrap a raw HTML fragment into a full, styled standalone document. */
export function wrapStandaloneHtml(bodyHtml: string, title: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 740px; margin: 48px auto; padding: 0 24px; line-height: 1.7; color: #1b1812; }
  h1,h2,h3 { line-height: 1.25; }
  img { max-width: 100%; }
  table { border-collapse: collapse; width: 100%; }
  th,td { border: 1px solid #ccc; padding: 6px 10px; }
  pre { background: #f3f0e7; padding: 12px; border-radius: 8px; overflow:auto; }
  blockquote { border-left: 3px solid #b06a12; margin: 0; padding-left: 16px; color: #555; }
  code { background:#f3f0e7; padding:2px 5px; border-radius:4px; font-size:.9em; }
</style></head>
<body>
${bodyHtml}
</body></html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
