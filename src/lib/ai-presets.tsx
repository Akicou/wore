import {
  AlignLeft,
  ArrowRightLeft,
  Brain,
  Braces,
  CheckSquare,
  Clapperboard,
  Contrast,
  Eraser,
  Gauge,
  Heading,
  HelpCircle,
  Image as ImageIcon,
  Languages,
  List,
  ListOrdered,
  type LucideIcon,
  Maximize2,
  PenLine,
  Plus,
  Quote,
  Scissors,
  Send,
  Sparkles,
  Tags,
  TrendingUp,
  Type,
  Wand2,
} from "lucide-react";

export type AIMode = "selection" | "document" | "insert";

export interface AIPreset {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** prompt template; {selection} is replaced with the selected text */
  prompt: string;
  mode: AIMode;
  /** hint shown in the mini prompt box */
  hint?: string;
  accent?: boolean;
}

/**
 * The selection-aware AI actions. "selection" actions rewrite the highlighted
 * text; "insert" actions drop new content at the cursor; "document" actions
 * answer questions about the whole document.
 */
export const AI_PRESETS: AIPreset[] = [
  {
    id: "shorten",
    label: "Shorten",
    description: "Condense to 1–3 punchy sentences.",
    icon: Scissors,
    prompt:
      "Shorten the following text to 1–3 clear, faithful sentences. Keep the core meaning and key facts. Return only the rewritten text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Shorten this paragraph to 1–3 sentences",
    accent: true,
  },
  {
    id: "expand",
    label: "Expand",
    description: "Add depth, examples and explanation.",
    icon: Maximize2,
    prompt:
      "Expand the following text with relevant detail, examples and explanation. Preserve the original meaning and tone. Return only the rewritten text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Expand this with examples and detail",
  },
  {
    id: "grammar",
    label: "Fix grammar",
    description: "Correct spelling, grammar & punctuation.",
    icon: Eraser,
    prompt:
      "Fix spelling, grammar and punctuation in the following text. Keep the meaning and voice. Return only the corrected text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Fix grammar and spelling",
    accent: true,
  },
  {
    id: "rewrite-clear",
    label: "Rewrite clearer",
    description: "Make it clearer and easier to read.",
    icon: Wand2,
    prompt:
      "Rewrite the following text to be clearer, tighter and easier to read, without changing the meaning. Return only the rewritten text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Rewrite this to be clearer",
  },
  {
    id: "formal",
    label: "Make formal",
    description: "Professional, polished register.",
    icon: Contrast,
    prompt:
      "Rewrite the following text in a formal, professional register. Return only the rewritten text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Make this more formal",
  },
  {
    id: "casual",
    label: "Make casual",
    description: "Friendly, conversational tone.",
    icon: Type,
    prompt:
      "Rewrite the following text in a friendly, casual, conversational tone. Return only the rewritten text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Make this more casual",
  },
  {
    id: "simplify",
    label: "Simplify",
    description: "Plain language, ~grade-6 reading level.",
    icon: Gauge,
    prompt:
      "Rewrite the following text in plain language at roughly a 6th-grade reading level. Keep meaning. Return only the rewritten text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Simplify this to plain language",
  },
  {
    id: "summarize",
    label: "Summarize",
    description: "Bullet-point summary.",
    icon: List,
    prompt:
      "Summarize the following text as 3–6 concise bullet points (Markdown list). Return only the list.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Summarize this as bullet points",
  },
  {
    id: "bullets",
    label: "To bullet list",
    description: "Turn prose into a clean list.",
    icon: ListOrdered,
    prompt:
      "Convert the following text into a clear Markdown bullet list, preserving all key points. Return only the list.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Turn this into a bullet list",
  },
  {
    id: "paragraph",
    label: "To paragraph",
    description: "Turn a list into prose.",
    icon: AlignLeft,
    prompt:
      "Rewrite the following as a single flowing paragraph of prose. Return only the paragraph.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Turn this list into a paragraph",
  },
  {
    id: "translate",
    label: "Translate",
    description: "Translate into another language.",
    icon: Languages,
    prompt:
      "Translate the following text into {lang}. Return only the translation.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Translate this to Spanish",
  },
  {
    id: "active",
    label: "Active voice",
    description: "Convert to active voice.",
    icon: ArrowRightLeft,
    prompt:
      "Rewrite the following text using active voice and strong verbs. Keep meaning. Return only the rewritten text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Rewrite in active voice",
  },
  {
    id: "stronger-verbs",
    label: "Stronger verbs",
    description: "Replace weak verbs with vivid ones.",
    icon: TrendingUp,
    prompt:
      "Rewrite the following text replacing weak verbs and adverbs with precise, vivid verbs. Keep meaning. Return only the rewritten text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Use stronger verbs",
  },
  {
    id: "examples",
    label: "Add examples",
    description: "Illustrate with concrete examples.",
    icon: Plus,
    prompt:
      "Add concrete, relevant examples to the following text to illustrate its points. Return only the rewritten text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Add examples to this",
  },
  {
    id: "title",
    label: "Generate title",
    description: "Suggest a fitting heading.",
    icon: Heading,
    prompt:
      "Write a single compelling title (no quotes, no punctuation at the end) for the following text. Return only the title.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Suggest a title for this",
  },
  {
    id: "define",
    label: "Define jargon",
    description: "Explain technical terms inline.",
    icon: Braces,
    prompt:
      "Identify technical or jargon terms in the following text and briefly define each in plain words, appended in parentheses after first use. Return only the rewritten text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Define the jargon here",
  },
  {
    id: "actions",
    label: "Action items",
    description: "Extract next steps & to-dos.",
    icon: CheckSquare,
    prompt:
      "Extract any action items, decisions and to-dos implied by the following text as a Markdown checklist. Return only the list.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Extract action items",
  },
  {
    id: "outline",
    label: "Outline",
    description: "Generate a structured outline.",
    icon: PenLine,
    prompt:
      "Create a structured Markdown outline (headings and sub-points) from the following text. Return only the outline.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Outline this section",
  },
  {
    id: "continue",
    label: "Continue writing",
    description: "Pick up where you left off.",
    icon: Send,
    prompt:
      "Continue writing seamlessly from the end of the following text, matching its style and content. Return only the continuation (no preamble).\n\nText so far:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Continue writing from here",
  },
  {
    id: "quote",
    label: "Make blockquote",
    description: "Frame as a pull-quote.",
    icon: Quote,
    prompt:
      "Distill the following text into one powerful, quotable sentence suitable for a pull-quote. Return only the sentence.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Turn this into a pull-quote",
  },
  {
    id: "tone-confident",
    label: "Confident tone",
    description: "Assertive, decisive voice.",
    icon: Sparkles,
    prompt:
      "Rewrite the following text in a confident, assertive and decisive tone without arrogance. Return only the rewritten text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Make this more confident",
  },
  {
    id: "emoji",
    label: "Clean emojis",
    description: "Add tasteful relevant emojis.",
    icon: Clapperboard,
    prompt:
      "Add a few tasteful, relevant emojis to the following text to aid scanning. Return only the rewritten text.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "selection",
    hint: "Add a few tasteful emojis",
  },
  /* document-level actions */
  {
    id: "ask-doc",
    label: "Ask the document",
    description: "Answer questions using the whole doc.",
    icon: HelpCircle,
    prompt: "{question}",
    mode: "document",
    hint: "What is this document about?",
  },
  {
    id: "brainstorm",
    label: "Brainstorm",
    description: "Generate fresh ideas to insert.",
    icon: Brain,
    prompt:
      "Brainstorm 8 fresh, specific ideas related to the following topic. Return a concise Markdown bullet list only.\n\nTopic / context:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "insert",
    hint: "Brainstorm ideas about…",
  },
  {
    id: "image-prompt",
    label: "Image prompt",
    description: "Craft a prompt for image-gen.",
    icon: Tags,
    prompt:
      "Turn the following text into a vivid, detailed text-to-image generation prompt (one paragraph). Return only the prompt.\n\nText:\n\"\"\"\n{selection}\n\"\"\"",
    mode: "insert",
    hint: "Turn this into an image prompt",
  },
];

export const SELECTION_PRESETS = AI_PRESETS.filter((p) => p.mode === "selection");
