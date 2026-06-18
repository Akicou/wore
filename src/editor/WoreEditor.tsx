import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { FormatState } from "./context";
import { useEditor } from "./context";
import { ImageToolbar } from "./ImageToolbar";
import { insertHTML, replaceSelectionWithHTML } from "@/lib/editor";

function currentBlock(el: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode) return "";
  let node: Node | null = sel.anchorNode;
  while (node && node !== el) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as HTMLElement).tagName;
      if (/^H[1-6]$/.test(tag) || ["P", "BLOCKQUOTE", "PRE", "LI", "DIV"].includes(tag)) {
        return tag === "DIV" ? "" : tag;
      }
    }
    node = node.parentNode;
  }
  return "";
}

function currentAlign(): string {
  try {
    if (document.queryCommandState("justifyCenter")) return "center";
    if (document.queryCommandState("justifyRight")) return "right";
    if (document.queryCommandState("justifyFull")) return "justify";
    return "left";
  } catch {
    return "left";
  }
}

/** Track active formats while the selection is inside the editor. */
export function useFormats(editorRef: RefObject<HTMLElement | null>): FormatState {
  const [formats, setFormats] = useState<FormatState>({});
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const update = () => {
      const sel = window.getSelection();
      if (!sel || !sel.anchorNode || !el.contains(sel.anchorNode)) return;
      setFormats({
        bold: tryState("bold"),
        italic: tryState("italic"),
        underline: tryState("underline"),
        strike: tryState("strikeThrough"),
        ul: tryState("insertUnorderedList"),
        ol: tryState("insertOrderedList"),
        block: currentBlock(el),
        align: currentAlign(),
      });
    };
    document.addEventListener("selectionchange", update);
    el.addEventListener("keyup", update);
    el.addEventListener("mouseup", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      el.removeEventListener("keyup", update);
      el.removeEventListener("mouseup", update);
    };
  }, [editorRef]);
  return formats;
}

function tryState(cmd: string): boolean {
  try {
    return document.queryCommandState(cmd);
  } catch {
    return false;
  }
}

interface WoreEditorProps {
  editorRef: RefObject<HTMLDivElement | null>;
  initialHTML: string;
  onChange: (html: string) => void;
  onSelectionTarget: (rect: DOMRect) => void;
  fontSize?: number;
  visualDocx?: boolean;
}

/**
 * The contenteditable writing surface. Uncontrolled after mount: it seeds
 * innerHTML from `initialHTML` (keyed by doc id upstream) and reports changes.
 */
export function WoreEditor({
  editorRef,
  initialHTML,
  onChange,
  onSelectionTarget,
  fontSize,
  visualDocx = false,
}: WoreEditorProps) {
  const placeholder = "Start writing… select text and press Ctrl+P to summon the agent.";
  const seeded = useRef(false);
  const pageWidth = useStore((s) => s.pageWidth);
  const ctx = useEditor();
  const [activeImage, setActiveImage] = useState<HTMLImageElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; text: string; range: Range | null } | null>(null);

  useEffect(() => {
    const el = editorRef.current;
    if (!el || seeded.current) return;
    el.innerHTML = initialHTML || "<p><br></p>";
    seeded.current = true;
  }, [editorRef, initialHTML]);

  // Selection-chat keybindings are handled at EditorPage level so they can also
  // work in DOCX/PDF preview surfaces and can be user-configurable.

  // right click → document context menu for selections and clipboard actions
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const onContext = (e: MouseEvent) => {
      const sel = window.getSelection();
      const hasSelection = !!sel && !sel.isCollapsed && sel.rangeCount > 0 && !!sel.anchorNode && el.contains(sel.anchorNode);
      if (!hasSelection && !(e.target instanceof HTMLImageElement)) return;
      e.preventDefault();
      const text = sel?.toString() ?? "";
      const w = 230;
      const h = 180;
      const x = Math.min(Math.max(8, e.clientX), window.innerWidth - w - 8);
      const y = Math.min(Math.max(8, e.clientY), window.innerHeight - h - 8);
      setMenu({ x, y, text, range: hasSelection ? sel!.getRangeAt(0).cloneRange() : null });
    };
    const close = () => setMenu(null);
    el.addEventListener("contextmenu", onContext);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      el.removeEventListener("contextmenu", onContext);
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [editorRef]);

  // click image → open the per-image property popover
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLImageElement) {
        setActiveImage(target);
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [editorRef]);

  return (
    <div
      className={cn(
        "mx-auto transition-[max-width] duration-300",
        visualDocx ? "w-full" : pageWidth === "narrow" && "max-w-[680px]",
        !visualDocx && pageWidth === "normal" && "max-w-[820px]",
        !visualDocx && pageWidth === "wide" && "max-w-[1080px]"
      )}
    >
      <div
        ref={editorRef}
        className={cn(
          "wore-editor min-h-[60vh] text-pretty",
          visualDocx ? "wore-editor-docx-visual p-0" : "px-12 py-14"
        )}
        style={visualDocx ? undefined : { fontSize: fontSize ? `${fontSize}px` : undefined, lineHeight: 1.7 }}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        data-placeholder={placeholder}
        onInput={() => {
          setActiveImage(null);
          onChange(editorRef.current?.innerHTML ?? "");
        }}
        onBlur={() => onChange(editorRef.current?.innerHTML ?? "")}
      />

      {activeImage && (
        <ImageToolbar
          imageEl={activeImage}
          onClose={() => setActiveImage(null)}
          onChange={() => onChange(editorRef.current?.innerHTML ?? "")}
        />
      )}

      {menu && (
        <EditorContextMenu
          {...menu}
          onClose={() => setMenu(null)}
          onCopy={async () => {
            if (!menu.text) return;
            await navigator.clipboard.writeText(menu.text);
            toast.success("Copied selection");
          }}
          onCut={async () => {
            if (!menu.range || !menu.text) return;
            await navigator.clipboard.writeText(menu.text);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(menu.range);
            replaceSelectionWithHTML("");
            onChange(editorRef.current?.innerHTML ?? "");
            toast.success("Cut selection");
          }}
          onPaste={async () => {
            const text = await navigator.clipboard.readText();
            if (!text) return;
            ctx.focus();
            insertHTML(text.replace(/</g, "&lt;").replace(/\n/g, "<br>"));
            onChange(editorRef.current?.innerHTML ?? "");
          }}
          onReference={() => {
            if (!menu.text) return;
            ctx.addChatReference(menu.text);
            toast.success("Selection attached to chat");
          }}
        />
      )}
    </div>
  );
}

function EditorContextMenu({
  x,
  y,
  text,
  onCopy,
  onCut,
  onPaste,
  onReference,
  onClose,
}: {
  x: number;
  y: number;
  text: string;
  range: Range | null;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onReference: () => void;
  onClose: () => void;
}) {
  const item = "block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-40";
  return createPortal(
    <div
      className="fixed z-[120] w-[230px] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      <button className={item} disabled={!text} onClick={() => { onCopy(); onClose(); }}>
        Copy
      </button>
      <button className={item} disabled={!text} onClick={() => { onCut(); onClose(); }}>
        Cut
      </button>
      <button className={item} onClick={() => { onPaste(); onClose(); }}>
        Paste
      </button>
      <div className="my-1 h-px bg-border" />
      <button className={item} disabled={!text} onClick={() => { onReference(); onClose(); }}>
        Add to chat as referenced context
      </button>
    </div>,
    document.body
  );
}
