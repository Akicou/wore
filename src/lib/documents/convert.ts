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

      // The first usable line becomes the document title (when it's short
      // enough to plausibly be one).
      if (!titleSet) {
        titleSet = true;
        if (line.length <= 90) {
          children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: line, bold: true })] }));
          continue;
        }
      }

      const isHeading =
        line.length <= 70 &&
        /^[A-Z0-9][\w\s\-:'.,&()]*$/.test(line) &&
        !/[.!?,;]$/.test(line) &&
        line.split(" ").length <= 12;

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
