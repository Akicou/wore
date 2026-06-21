import { marked } from "marked";
import TurndownService from "turndown";
import { sanitizeHtml } from "./html";

marked.setOptions({ gfm: true, breaks: false });

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});
// Preserve common rich elements the editor produces.
turndown.addRule("strikethrough", {
  filter: ["del", "s", "strike"] as unknown as TurndownService.Filter,
  replacement: (content) => `~~${content}~~`,
});

/** Markdown source -> editor HTML. Sanitized: marked passes raw HTML through. */
export function markdownToHtml(md: string): string {
  return sanitizeHtml(marked.parse(md, { async: false }) as string);
}

/** Editor HTML -> Markdown source. */
export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}

/** Create a friendly starter markdown document. */
export function starterMarkdown(title: string): string {
  return `# ${title}

Start writing here. Select any text and press **Ctrl + P** to summon the AI.

## What WoRe can do

- Read and edit **Markdown**, **DOCX** and **PDF**.
- Ask the agent to rewrite, shorten, expand, translate or proofread a selection.
- Generate images and drop them straight into the page.
- Export to PDF (print), DOCX, Markdown or HTML.

> Tip: try "Summarise this in one sentence" on the paragraph above.

\`\`\`bash
wore --open my-document.md
\`\`\`
`;
}
