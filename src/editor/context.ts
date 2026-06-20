import { createContext, useContext } from "react";
import type { AIProfile, ChatImagePart } from "@/lib/ai";
import type { StoredDoc } from "@/lib/documents/manager";

export interface FormatState {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  ul?: boolean;
  ol?: boolean;
  block?: string; // H1..H6, P, BLOCKQUOTE, PRE
  align?: string;
}

export interface SelectionTarget {
  range: Range;
  rect: DOMRect;
  text: string;
  readOnly?: boolean;
}

export interface DocumentImage extends ChatImagePart {
  index: number;
  caption?: string;
}

export interface EditorContextValue {
  editorEl: React.RefObject<HTMLDivElement | null>;
  getHTML: () => string;
  getDocumentText: () => string;
  getDocumentImages: () => Promise<DocumentImage[]>;
  setHTML: (html: string) => void;
  focus: () => void;
  /** re-read editor HTML into app state (for autosave) */
  sync: () => void;
  formats: FormatState;
  selection: SelectionTarget | null;
  openSelectionChat: (t: SelectionTarget) => void;
  closeSelectionChat: () => void;
  /** attach selected document text to the assistant composer */
  addChatReference: (text: string) => void;
  doc: StoredDoc | null;
  content: string;
  setContent: (html: string) => void;
  profile: AIProfile | undefined;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used within EditorContext");
  return ctx;
}
