import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Plus,
  Scissors,
  Sparkles,
  Square,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useEditor } from "./context";
import { SELECTION_PRESETS } from "@/lib/ai-presets";
import { streamSelectionEdit, resultToInsertHtml } from "@/lib/ai-actions";
import { insertHTMLAtRange, replaceRangeWithHTML } from "@/lib/editor";
import { writeLog } from "@/lib/log";
import { useStore } from "@/lib/store";
import { cn, clamp } from "@/lib/utils";

const QUICK = ["shorten", "grammar", "rewrite-clear", "formal", "summarize"];

export function SelectionChat() {
  const ctx = useEditor();
  const showThinking = useStore((s) => s.showThinking);
  const target = ctx.selection;
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [busy, setBusy] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelH, setPanelH] = useState(320);
  const [, repaint] = useState(0);

  useEffect(() => {
    if (target) {
      setInput("");
      setOutput("");
      setReasoning("");
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [target]);

  // Follow the document as it scrolls/resizes so the popup stays glued to the
  // selection instead of drifting off-frame.
  useEffect(() => {
    const tick = () => repaint((n) => n + 1);
    window.addEventListener("scroll", tick, true);
    window.addEventListener("resize", tick);
    return () => {
      window.removeEventListener("scroll", tick, true);
      window.removeEventListener("resize", tick);
    };
  }, []);

  // Measure the real popup height so placement can never clip it off-screen,
  // even with long output or the reasoning/presets expanded.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const update = () => setPanelH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [target]);

  // reposition safely if no target
  if (!target) return null;

  const profile = ctx.profile;
  const docContext = ctx.getDocumentText();

  // Prefer the live range rect (follows scroll); fall back to the captured one.
  let anchorRect = target.rect;
  try {
    const live = target.range.getBoundingClientRect();
    if (live && (live.width || live.height)) anchorRect = live;
  } catch {
    /* detached range — keep the captured rect */
  }
  const pos = computePos(anchorRect, panelH);

  const run = async (instructionOverride?: string) => {
    if (!profile) {
      toast.error("No AI profile", {
        description: "Add an API key in Settings → AI Profiles.",
      });
      return;
    }
    if (!profile.apiKey && !profile.baseUrl.includes("localhost")) {
      toast.error("Missing API key", {
        description: `Add a key for “${profile.name}” in Settings.`,
      });
      return;
    }
    const instruction = (instructionOverride ?? input).trim();
    if (!instruction) {
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setOutput("");
    setReasoning("");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      for await (const partial of streamSelectionEdit(
        profile,
        { instruction, selection: target.text, docContext, signal: ac.signal },
        { onReasoning: (t) => showThinking && setReasoning((r) => r + t) }
      )) {
        setOutput(partial);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        toast.error("AI request failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const stop = () => abortRef.current?.abort();

  const applyReplace = () => {
    if (!output) return;
    const html = resultToInsertHtml(output);
    const ok = replaceRangeWithHTML(target.range, html);
    writeLog(ok ? "info" : "error", "selection", ok ? "Selection replaced" : "Selection replace failed", {
      selectedText: target.text.slice(0, 200),
      outputPreview: output.slice(0, 200),
    });
    if (!ok) {
      toast.error("Could not replace selection", { description: "The selection range was no longer valid." });
      return;
    }
    ctx.sync();
    ctx.closeSelectionChat();
    toast.success("Replaced selection");
  };

  const applyInsert = () => {
    if (!output) return;
    const html = resultToInsertHtml(output);
    const ok = insertHTMLAtRange(target.range, html, true);
    writeLog(ok ? "info" : "error", "selection", ok ? "Inserted after selection" : "Insert after selection failed", {
      selectedText: target.text.slice(0, 200),
      outputPreview: output.slice(0, 200),
    });
    if (!ok) {
      toast.error("Could not insert after selection", { description: "The selection range was no longer valid." });
      return;
    }
    ctx.sync();
    ctx.closeSelectionChat();
    toast.success("Inserted below");
  };

  return createPortal(
    <>
      <SelectionHighlight range={target.range} />
      <AnimatePresence>
      <motion.div
        key="selchat"
        ref={panelRef}
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        style={{ left: pos.left, top: pos.top, transform: pos.transform }}
        className={cn(
          "no-print fixed z-50 w-[min(440px,92vw)] max-h-[calc(100vh-24px)] origin-bottom overflow-auto",
          pos.flip ? "origin-bottom" : "origin-bottom"
        )}
      >
        <div className="overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
          {/* header */}
          <div className="flex items-center gap-2 border-b border-border bg-card/60 px-3 py-1.5">
            <Sparkles className="size-3.5 text-accent-strong" />
            <span className="text-xs font-semibold">{target.readOnly ? "Ask about selection" : "Edit selection"}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              “{target.text.slice(0, 40)}{target.text.length > 40 ? "…" : ""}”
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              onClick={ctx.closeSelectionChat}
            >
              <X />
            </Button>
          </div>

          {/* quick actions */}
          <div className="flex flex-wrap gap-1 border-b border-border px-2.5 py-2">
            {QUICK.map((id) => {
              const p = SELECTION_PRESETS.find((x) => x.id === id)!;
              const Icon = p.icon;
              return (
                <button
                  key={id}
                  disabled={busy}
                  onClick={() => runPreset(p)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] transition-colors hover:border-accent/40 hover:bg-accent-soft disabled:opacity-50"
                >
                  <Icon className="size-3" /> {p.label}
                </button>
              );
            })}
            <button
              disabled={busy}
              onClick={() => setShowAll((s) => !s)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] transition-colors hover:border-accent/40 hover:bg-accent-soft disabled:opacity-50"
            >
              {showAll ? "Less" : "More…"}
            </button>
          </div>

          {showAll && (
            <div className="flex max-h-44 flex-wrap gap-1 overflow-auto border-b border-border px-2.5 py-2">
              {SELECTION_PRESETS.map((p) => {
                const Icon = p.icon;
                return (
                  <button
                    key={p.id}
                    disabled={busy}
                    title={p.description}
                    onClick={() => runPreset(p)}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] transition-colors hover:border-accent/40 hover:bg-accent-soft disabled:opacity-50"
                  >
                    <Icon className="size-3" /> {p.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* input */}
          <div className="p-2.5">
            <div className="relative">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    run();
                  }
                  if (e.key === "Escape") ctx.closeSelectionChat();
                }}
                placeholder="Ask the agent… e.g. “Shorten this paragraph to 1–3 sentences”"
                className="min-h-[52px] max-h-40 pr-10 text-sm"
                disabled={busy}
              />
              <button
                onClick={() => (busy ? stop() : run())}
                className={cn(
                  "absolute bottom-2 right-2 grid size-7 place-items-center rounded-md text-white shadow-sm transition-colors",
                  busy ? "bg-destructive" : "bg-accent hover:bg-accent-strong"
                )}
                title={busy ? "Stop" : "Run (Enter)"}
              >
                {busy ? <Square className="size-3" /> : <ArrowUp className="size-4" />}
              </button>
            </div>
          </div>

          {/* reasoning */}
          {showThinking && reasoning && (
            <div className="border-t border-border">
              <button
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
                onClick={() => setShowReasoning((s) => !s)}
              >
                <Brain className="size-3" /> Thinking
                <ChevronDown className={cn("ml-auto size-3 transition-transform", showReasoning && "rotate-180")} />
              </button>
              {showReasoning && (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap border-t border-border bg-muted/40 px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {reasoning}
                </pre>
              )}
            </div>
          )}

          {/* output */}
          {output && (
            <div className="border-t border-border">
              <div className="max-h-60 overflow-auto px-3 py-2.5 text-sm leading-relaxed">
                <MarkdownLite text={output} />
              </div>
              <div className="flex items-center gap-1.5 border-t border-border bg-card/60 px-2.5 py-2">
                {!target.readOnly && (
                  <>
                    <Button size="xs" variant="accent" onClick={applyReplace} disabled={busy}>
                      <Check /> Replace
                    </Button>
                    <Button size="xs" variant="outline" onClick={applyInsert} disabled={busy}>
                      <Plus /> Insert below
                    </Button>
                  </>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => {
                    navigator.clipboard.writeText(output);
                    toast.success("Copied");
                  }}
                >
                  <Copy /> Copy
                </Button>
              </div>
            </div>
          )}

          {busy && !output && (
            <div className="flex items-center gap-2 border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-accent-strong" />
              <span className="ai-text font-medium">Thinking…</span>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border bg-card/40 px-3 py-1.5 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="kbd">↵</kbd> run · <kbd className="kbd">⇧↵</kbd> newline
            </span>
            {profile ? (
              <Badge variant="secondary" className="px-1.5">{profile.name}</Badge>
            ) : (
              <span className="text-destructive">no profile</span>
            )}
          </div>
        </div>
      </motion.div>
      </AnimatePresence>
    </>,
    document.body
  );

  function runPreset(p: (typeof SELECTION_PRESETS)[number]) {
    let prompt = p.prompt;
    if (prompt.includes("{lang}")) {
      const lang = window.prompt("Translate into which language?", "Spanish");
      if (!lang) return;
      prompt = prompt.split("{lang}").join(lang);
    }
    if (prompt.includes("{selection}")) prompt = prompt.replace("{selection}", target!.text);
    setShowAll(false);
    run(prompt);
  }
}

function computePos(rect: DOMRect, panelH: number) {
  const gap = 12;
  const pad = 12;
  const width = Math.min(440, window.innerWidth * 0.92);
  // Cap to viewport; the popup itself caps at max-h-[calc(100vh-24px)].
  const h = Math.min(panelH || 320, window.innerHeight - pad * 2);
  const spaceAbove = rect.top - pad;
  const spaceBelow = window.innerHeight - rect.bottom - pad;
  const placeTop = spaceAbove >= h + gap || spaceAbove > spaceBelow;
  const left = clamp(rect.left + rect.width / 2, width / 2 + pad, window.innerWidth - width / 2 - pad);
  let top: number;
  let transform: string;
  if (placeTop) {
    // Anchored by its bottom edge (translateY -100%): keep top >= h + pad so
    // the visible top edge never goes above the viewport.
    top = clamp(rect.top - gap, h + pad, window.innerHeight - pad);
    transform = "translate(-50%, -100%)";
  } else {
    top = clamp(rect.bottom + gap, pad, Math.max(pad, window.innerHeight - h - pad));
    transform = "translate(-50%, 0)";
  }
  return { left, top, transform, flip: !placeTop };
}

function SelectionHighlight({ range }: { range: Range }) {
  const [rects, setRects] = useState<DOMRect[]>([]);
  useEffect(() => {
    const update = () => {
      try {
        setRects([...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0));
      } catch {
        setRects([]);
      }
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [range]);
  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {rects.map((r, i) => (
        <div
          key={i}
          className="absolute rounded-[3px] bg-accent/20 ring-1 ring-accent/40"
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
    </div>
  );
}

/** Tiny inline markdown renderer for streamed preview (bold, code, lists). */
function MarkdownLite({ text }: { text: string }) {
  return (
    <div className="prose-mini">
      {text.split("\n").map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2" />;
        const li = line.match(/^\s*([-*]|\d+\.)\s+(.*)/);
        if (li) return (
          <div key={i} className="flex gap-2">
            <span className="text-muted-foreground">{li[1]}</span>
            <span dangerouslySetInnerHTML={{ __html: inline(li[2]) }} />
          </div>
        );
        const h = line.match(/^#{1,4}\s+(.*)/);
        if (h)
          return (
            <p key={i} className="font-display text-base font-semibold">
              {h[1]}
            </p>
          );
        return <p key={i} dangerouslySetInnerHTML={{ __html: inline(line) }} />;
      })}
    </div>
  );
}

function inline(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code style="font-family:var(--font-mono);background:var(--color-muted);padding:0 4px;border-radius:4px">$1</code>');
}
