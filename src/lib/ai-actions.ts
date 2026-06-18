import type { AIProfile, ChatImagePart, ChatMessage } from "./ai";
import { chat, chatStream } from "./ai";
import { htmlToPlainText } from "./documents/html";
import { markdownToHtml } from "./documents/markdown";

export const WORE_SYSTEM = `You are WoRe, an in-document writing agent embedded in the WoRe editor by Nayhein.com.
You help the user write, edit and think about the document open in front of them.

Rules:
- When asked to rewrite or transform a selection, return ONLY the result text — no preamble, no "Here is...", no explanations, no markdown code fences around the whole answer.
- Preserve the author's intent, facts and names. If you must guess, keep it minimal.
- Match the surrounding tone and language unless told otherwise.
- You may use light Markdown for structure (headings, **bold**, lists, tables, \`code\`) when it improves the result.
- Be concise and high-quality.`;

/** Build messages for a selection edit. */
export function selectionMessages({
  instruction,
  selection,
  docContext,
  extra,
}: {
  instruction: string;
  selection: string;
  docContext?: string;
  extra?: string;
}): ChatMessage[] {
  const ctx = (docContext ?? "").trim();
  const user = `${extra ? extra + "\n\n" : ""}${instruction}

Selected text:
"""
${selection}
"""
${ctx ? `\nFor context, here is the surrounding document (reference only — edit only the selection):\n"""\n${ctx.slice(0, 8000)}\n"""` : ""}

Return only the rewritten text.`;
  return [
    { role: "system", content: WORE_SYSTEM },
    { role: "user", content: user },
  ];
}

/** Build messages for a whole-document conversation. */
export function docChatMessages({
  question,
  docContext,
  history,
  images = [],
}: {
  question: string;
  docContext: string;
  history: ChatMessage[];
  images?: ChatImagePart[];
}): ChatMessage[] {
  const imageNote = images.length
    ? `\n\nThe current document also contains ${images.length} image${images.length === 1 ? "" : "s"}. They are attached to the user's message. Use them when the question asks about figures, diagrams, screenshots, visual layout, or image content.`
    : "";
  const userContent = images.length
    ? [
        { type: "text" as const, text: question || "Answer about the current document." },
        ...images,
      ]
    : question;
  return [
    { role: "system", content: `${WORE_SYSTEM}\n\nYou are answering questions about the user's document. When useful, quote short excerpts. The full document text is provided below.${imageNote}\n\nDOCUMENT TEXT:\n"""\n${docContext.slice(0, 20000)}\n"""` },
    ...history.slice(-6),
    { role: "user", content: userContent },
  ];
}

/** Convert a free-form instruction + preset hint into a prompt. */
export function buildInstruction(hint: string, custom: string): string {
  return custom.trim() ? custom.trim() : hint;
}

/** Stream a selection edit. */
export async function* streamSelectionEdit(
  profile: AIProfile,
  args: { instruction: string; selection: string; docContext?: string; model?: string; signal?: AbortSignal },
  opts: { onReasoning?: (t: string) => void } = {}
) {
  const messages = selectionMessages(args);
  let acc = "";
  for await (const ev of chatStream(profile, messages, {
    model: args.model,
    reasoning: true,
    signal: args.signal,
  })) {
    if (ev.reasoning) opts.onReasoning?.(ev.reasoning);
    if (ev.delta) {
      acc += ev.delta;
      yield acc;
    }
  }
}

/** Non-streaming doc answer. */
export async function askDocument(
  profile: AIProfile,
  args: { question: string; docContext: string; history: ChatMessage[]; model?: string; signal?: AbortSignal }
): Promise<string> {
  const messages = docChatMessages(args);
  const res = await chat(profile, messages, { model: args.model, reasoning: true, signal: args.signal });
  return res.text;
}

/** Convert a markdown-ish AI result into HTML safe to insert into the editor. */
export function resultToInsertHtml(markdownResult: string): string {
  const html = markdownToHtml(markdownResult.trim());
  // parse top-level nodes
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const kids = [...tpl.content.children];
  if (kids.length === 1) {
    const only = kids[0] as HTMLElement;
    if (["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI"].includes(only.tagName)) {
      return only.innerHTML;
    }
  }
  return html;
}

export { htmlToPlainText };
