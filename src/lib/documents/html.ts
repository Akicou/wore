/* HTML helpers shared by the editor, converters and exporters. */

/** Remove script/event handlers/iframe for safe content from imports. */
export function sanitizeHtml(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.querySelectorAll("script, style, iframe, object, embed, link").forEach((n) => n.remove());
  tpl.content.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const val = attr.value;
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(val))
        el.removeAttribute(attr.name);
    });
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
