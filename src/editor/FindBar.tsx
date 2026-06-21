import { useEffect, useRef, useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  Replace,
  ReplaceAll,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";

interface FindBarProps {
  editorRef: React.RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  onClose: () => void;
  onSync: () => void;
}

export function FindBar({ editorRef, isOpen, onClose, onSync }: FindBarProps) {
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const matchRefs = useRef<HTMLSpanElement[]>([]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [isOpen]);

  // Clear highlights when closed
  useEffect(() => {
    if (!isOpen) {
      clearHighlights();
      setQuery("");
      setReplace("");
      setTotal(0);
      setMatchIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const clearHighlights = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const highlights = editor.querySelectorAll("span.find-highlight");
    highlights.forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(el.textContent || ""), el);
      parent.normalize();
    });
    matchRefs.current = [];
  }, [editorRef]);

  const performSearch = useCallback(() => {
    clearHighlights();
    const editor = editorRef.current;
    if (!editor || !query) {
      setTotal(0);
      setMatchIndex(0);
      return;
    }

    // Collect all text nodes and their match positions
    type MatchPos = { node: Text; start: number; end: number };
    const positions: MatchPos[] = [];

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest("span.find-highlight")) return NodeFilter.FILTER_REJECT;
        if (!parent.closest(".wore-editor")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const textNode = node as Text;
      const text = textNode.textContent || "";
      const searchText = caseSensitive ? text : text.toLowerCase();
      const q = caseSensitive ? query : query.toLowerCase();
      let pos = 0;
      while (pos < searchText.length) {
        const idx = searchText.indexOf(q, pos);
        if (idx === -1) break;
        positions.push({ node: textNode, start: idx, end: idx + query.length });
        pos = idx + 1;
      }
    }

    // Apply highlights from end to start so offsets don't shift
    const matches: HTMLSpanElement[] = [];
    for (let i = positions.length - 1; i >= 0; i--) {
      const { node, start, end } = positions[i];
      const parent = node.parentNode;
      if (!parent) continue;
      const text = node.textContent || "";
      const before = text.slice(0, start);
      const match = text.slice(start, end);
      const after = text.slice(end);

      const span = document.createElement("span");
      span.className = "find-highlight";
      span.textContent = match;
      span.style.backgroundColor = "rgba(234, 179, 8, 0.35)";
      span.style.borderRadius = "2px";
      span.style.color = "inherit";

      if (after) {
        parent.insertBefore(document.createTextNode(after), node.nextSibling ?? null);
      }
      parent.insertBefore(span, node.nextSibling ?? null);
      if (before) {
        parent.insertBefore(document.createTextNode(before), span);
      }
      parent.removeChild(node);

      matches.unshift(span);
    }

    matchRefs.current = matches;
    setTotal(matches.length);
    setMatchIndex(matches.length > 0 ? 1 : 0);

    if (matches.length > 0) {
      scrollToMatch(matches[0]);
    }
  }, [clearHighlights, editorRef, query, caseSensitive]);

  const scrollToMatch = (el: HTMLElement) => {
    el.style.backgroundColor = "rgba(234, 179, 8, 0.65)";
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const unhighlightCurrent = () => {
    matchRefs.current.forEach((el) => {
      el.style.backgroundColor = "rgba(234, 179, 8, 0.35)";
    });
  };

  const goNext = () => {
    if (!matchRefs.current.length) return;
    unhighlightCurrent();
    const next = matchIndex >= matchRefs.current.length ? 1 : matchIndex + 1;
    setMatchIndex(next);
    scrollToMatch(matchRefs.current[next - 1]);
  };

  const goPrev = () => {
    if (!matchRefs.current.length) return;
    unhighlightCurrent();
    const prev = matchIndex <= 1 ? matchRefs.current.length : matchIndex - 1;
    setMatchIndex(prev);
    scrollToMatch(matchRefs.current[prev - 1]);
  };

  const replaceCurrent = () => {
    if (!matchRefs.current.length || !replace) return;
    const el = matchRefs.current[matchIndex - 1];
    if (!el) return;
    const parent = el.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(replace), el);
    parent.normalize();
    onSync();
    performSearch();
  };

  const replaceAllMatches = () => {
    if (!matchRefs.current.length || !replace) return;
    const editor = editorRef.current;
    if (!editor) return;

    const highlights = Array.from(editor.querySelectorAll("span.find-highlight"));
    highlights.forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(replace), el);
    });
    editor.normalize();
    onSync();
    performSearch();
  };

  useEffect(() => {
    if (isOpen && query) {
      performSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="no-print flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
      <Search className="size-3.5 text-muted-foreground" />
      <div className="flex items-center gap-1.5">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              goNext();
            }
            if (e.key === "Escape") {
              onClose();
            }
          }}
          placeholder="Find in document…"
          className="h-7 w-56 text-sm"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={goPrev}
          disabled={!total}
          title="Previous match"
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={goNext}
          disabled={!total}
          title="Next match"
        >
          <ChevronDown className="size-3.5" />
        </Button>
        <span className="min-w-[3rem] text-center text-[11px] tabular-nums text-muted-foreground">
          {total > 0 ? `${matchIndex} / ${total}` : "No results"}
        </span>
        <button
          onClick={() => setCaseSensitive((v) => !v)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
            caseSensitive
              ? "bg-accent text-white"
              : "text-muted-foreground hover:bg-muted"
          )}
          title="Match case"
        >
          Aa
        </button>
      </div>

      <div className="mx-1 h-4 w-px bg-border" />

      <button
        onClick={() => setShowReplace((v) => !v)}
        className={cn(
          "text-[11px] font-medium transition-colors",
          showReplace ? "text-accent-strong" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {showReplace ? "Hide replace" : "Replace"}
      </button>

      {showReplace && (
        <>
          <Input
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                replaceCurrent();
              }
            }}
            placeholder="Replace with…"
            className="h-7 w-48 text-sm"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={replaceCurrent}
            disabled={!total || !replace}
            className="h-7 gap-1 text-xs"
          >
            <Replace className="size-3" /> Replace
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={replaceAllMatches}
            disabled={!total || !replace}
            className="h-7 gap-1 text-xs"
          >
            <ReplaceAll className="size-3" /> All
          </Button>
        </>
      )}

      <div className="ml-auto">
        <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close search">
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
