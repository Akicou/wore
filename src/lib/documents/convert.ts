import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { extractPdfText } from "./pdf";

/**
 * Convert a PDF to a DOCX by reconstructing its text structure.
 * Headings are detected heuristically; everything else becomes paragraphs.
 */
export async function pdfToDocx(data: ArrayBuffer, title = "Converted Document"): Promise<Blob> {
  const { pages } = await extractPdfText(data);

  const children: Paragraph[] = [];
  let titleSet = false;

  for (const page of pages) {
    for (const raw of page.lines) {
      const line = raw.trim();
      if (!line) continue;
      const isHeading = !titleSet
        ? (titleSet = true) && line.length <= 90 && !/[.!?,;:]$/.test(line)
        : (line.length <= 70 &&
            /^[A-Z0-9][\w\s\-:'.,&()]*$/.test(line) &&
            !/[.!?,;]$/.test(line) &&
            line.split(" ").length <= 12);

      if (!titleSet && line.length <= 90) {
        titleSet = true;
        children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: line, bold: true })] }));
        continue;
      }

      if (isHeading) {
        children.push(
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: line })] })
        );
      } else {
        children.push(new Paragraph({ children: [new TextRun({ text: line })] }));
      }
    }
    // soft page break marker between source pages
    children.push(new Paragraph({ children: [new TextRun({ text: "" })], pageBreakBefore: false }));
  }

  if (!children.length)
    children.push(new Paragraph({ children: [new TextRun({ text: "" })] }));

  const doc = new Document({
    creator: "WoRe by Nayhein.com",
    title,
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

/** Extract a compact plain-text snapshot of a PDF for AI context. */
export async function pdfContextText(data: ArrayBuffer, maxChars = 24000): Promise<string> {
  const { total } = await extractPdfText(data);
  return total.length > maxChars ? total.slice(0, maxChars) + "\n…[truncated]" : total;
}
