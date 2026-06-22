import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  CheckSquare,
  ChevronDown,
  Copy,
  History,
  ListTree,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { chatStream, modelReasoningCapable } from "@/lib/ai";
import type { AIProfile, ChatMessage } from "@/lib/ai";
import { docChatMessages } from "@/lib/ai-actions";
import { idbGet, idbSet } from "@/lib/idb";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Msg[];
  createdAt: number;
  updatedAt: number;
}

const PPTX_ACTIONS = [
  { id: "summary", label: "Summarize", icon: Sparkles, q: "Summarize this presentation in 5 concise bullet points." },
  { id: "outline", label: "Outline", icon: ListTree, q: "Create a structured outline of this presentation, slide by slide." },
  { id: "talking", label: "Talking points", icon: MessageSquareText, q: "Give me talking points for the current slide. Be concise and delivery-focused." },
  { id: "notes", label: "Draft notes", icon: CheckSquare, q: "Write concise, natural speaker notes for the current slide — what to say and how to transition to the next slide." },
] as const;

export function PresentationAIPanel({
  docId,
  profile,
  getPresentationText,
  getCurrentSlideContext,
  currentSlideNumber,
}: {
  docId: string;
  profile: AIProfile | undefined;
  getPresentationText: () => string;
  getCurrentSlideContext: () => string;
  currentSlideNumber: number;
}) {
  const showThinking = true;
  const chatStorageKey = useMemo(() => `wore.aiChats.${docId}`, [docId]);
  const [sessions, setSessions] = useState<ChatSession[]>(() => [newChatSession()]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef(currentSlideNumber);
  slideRef.current = currentSlideNumber;

  useEffect(() => () => abortRef.current?.abort(), []);
  const skipNextPersistRef = useRef(false);
  const loadedRef = useRef(false);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const messages = activeSession?.messages ?? [];

  const updateMessages = (updater: (current: Msg[]) => Msg[]) => {
    setSessions((current) => {
      if (!current.length) return current;
      const activeId = activeSessionId || current[0].id;
      return current.map((session) => {
        if (session.id !== activeId) return session;
        const nextMessages = updater(session.messages);
        return {
          ...session,
          messages: nextMessages,
          title: sessionTitle(nextMessages, session.title),
          updatedAt: Date.now(),
        };
      });
    });
  };

  useEffect(() => {
    let cancelled = false;
    skipNextPersistRef.current = true;
    loadedRef.current = false;
    (async () => {
      try {
        const parsed = await idbGet<ChatSession[]>(chatStorageKey);
        const valid = (parsed ?? []).filter((s) => s && s.id && Array.isArray(s.messages));
        const next = valid.length ? valid : [newChatSession()];
        if (cancelled) return;
        setSessions(next);
        setActiveSessionId(next[0].id);
      } catch {
        if (cancelled) return;
        const next = [newChatSession()];
        setSessions(next);
        setActiveSessionId(next[0].id);
      } finally {
        loadedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatStorageKey]);

  useEffect(() => {
    if (!sessions.length || !loadedRef.current) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    const t = setTimeout(() => {
      idbSet(chatStorageKey, sessions.slice(0, 50)).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [chatStorageKey, sessions]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const startNewChat = () => {
    const session = newChatSession();
    setSessions((current) => [session, ...current]);
    setActiveSessionId(session.id);
    setHistoryOpen(false);
    setInput("");
  };

  const deleteSession = (id: string) => {
    setSessions((current) => {
      const next = current.filter((s) => s.id !== id);
      if (!next.length) {
        const fresh = newChatSession();
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      if (activeSessionId === id) setActiveSessionId(next[0].id);
      return next;
    });
  };

  const buildPrompt = (text: string) => {
    const full = getPresentationText();
    const current = getCurrentSlideContext();
    const slideNote = current ? `\n\nCURRENT SLIDE (Slide ${slideRef.current}):\n"""\n${current.slice(0, 6000)}\n"""` : "";
    return `${text}\n\nPRESENTATION CONTENT:\n"""\n${full.slice(0, 20000)}\n"""${slideNote}`;
  };

  const streamReply = async (apiPrompt: string, baseHistory: Msg[], userDisplay: string) => {
    if (!profile) {
      toast.error("No AI profile", { description: "Configure one in Settings." });
      return;
    }
    if (!profile.apiKey && !profile.baseUrl.includes("localhost")) {
      toast.error("Missing API key", { description: `Add a key for “${profile.name}”.` });
      return;
    }
    const docContext = getPresentationText();
    const apiHistory: ChatMessage[] = baseHistory.map((m) => ({ role: m.role, content: m.content }) as ChatMessage);
    updateMessages(() => [
      ...baseHistory,
      { role: "user", content: userDisplay },
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;

    const reply = docChatMessages({ question: apiPrompt, docContext, history: apiHistory });
    let acc = "";
    let reasoningAcc = "";
    try {
      for await (const ev of chatStream(profile, reply, {
        model: profile.defaultChatModel,
        reasoning: modelReasoningCapable(profile, profile.defaultChatModel),
        signal: ac.signal,
      })) {
        if (ev.reasoning) reasoningAcc += ev.reasoning;
        if (ev.delta || ev.reasoning) {
          if (ev.delta) acc += ev.delta;
          updateMessages((m) => {
            const next = [...m];
            next[next.length - 1] = { role: "assistant", content: acc, reasoning: reasoningAcc || undefined };
            return next;
          });
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        updateMessages((m) => {
          const next = [...m];
          next[next.length - 1] = { role: "assistant", content: `⚠️ ${(e as Error).message}` };
          return next;
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const send = async (text: string) => {
    if (!profile) {
      toast.error("No AI profile", { description: "Configure one in Settings." });
      return;
    }
    if (!profile.apiKey && !profile.baseUrl.includes("localhost")) {
      toast.error("Missing API key", { description: `Add a key for “${profile.name}”.` });
      return;
    }
    const finalText = buildPrompt(text);
    const display = /Talking points|speaker notes for the current slide/i.test(text)
      ? `${text} (slide ${slideRef.current})`
      : text;
    await streamReply(finalText, messages, display);
  };

  const regenerate = async () => {
    if (busy || !profile) return;
    let lastUserIdx = -1;
    for (let k = messages.length - 1; k >= 0; k--) {
      if (messages[k].role === "user") {
        lastUserIdx = k;
        break;
      }
    }
    if (lastUserIdx === -1) return;
    const prompt = messages[lastUserIdx].content;
    const baseHistory = messages.slice(0, lastUserIdx);
    await streamReply(prompt, baseHistory, prompt);
  };

  const panel = (
    <div className="no-print flex h-full flex-col bg-card">
      <div className="relative flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Bot className="size-4 text-accent-strong" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Assistant</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {activeSession?.title ?? "New chat"}
          </div>
        </div>
        <Badge variant="secondary" className="hidden px-1.5 sm:inline-flex">
          {profile?.name ?? "no profile"}
        </Badge>
        <Button variant="ghost" size="icon-sm" onClick={() => setFullscreen((v) => !v)} title={fullscreen ? "Exit full screen" : "Open in full screen"}>
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={startNewChat} title="New chat">
          <Plus className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setHistoryOpen((v) => !v)} title="Chat history">
          <History className="size-3.5" />
        </Button>
        {historyOpen && (
          <div className="absolute right-2 top-11 z-30 w-72 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-xl">
            <div className="flex items-center justify-between px-2 py-1.5 text-xs font-medium text-muted-foreground">
              <span>Chat history</span>
              <button onClick={startNewChat} className="text-accent-strong hover:underline">New</button>
            </div>
            <div className="max-h-72 overflow-auto">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={cn(
                    "group flex items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted",
                    session.id === activeSessionId && "bg-muted"
                  )}
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setActiveSessionId(session.id);
                      setHistoryOpen(false);
                    }}
                  >
                    <div className="truncate text-xs font-medium">{session.title}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {session.messages.length} messages · {timeLabel(session.updatedAt)}
                    </div>
                  </button>
                  <button
                    className="mt-0.5 hidden text-muted-foreground hover:text-destructive group-hover:block"
                    onClick={() => deleteSession(session.id)}
                    title="Delete chat"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2.5">
        {PPTX_ACTIONS.map((a) => (
          <button
            key={a.id}
            disabled={busy}
            onClick={() => send(a.q)}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] transition-colors hover:border-accent/40 hover:bg-accent-soft disabled:opacity-50"
          >
            <a.icon className="size-3" /> {a.label}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="mt-6 text-center text-sm text-muted-foreground">
            <Sparkles className="mx-auto mb-2 size-6 text-accent-strong" />
            Ask about this presentation, summarize it, or draft speaker notes for the current slide.
          </div>
        )}
        {messages.map((m, i) => {
          const isLastAssistant = m.role === "assistant" && i === messages.length - 1 && busy && m.content === "";
          const canRegenerate = !busy && m.role === "user" && i === messages.length - 1;
          return (
            <MessageBubble
              key={i}
              msg={m}
              thinking={isLastAssistant}
              showThinking={showThinking}
              canRegenerate={canRegenerate}
              onRegenerate={regenerate}
              onCopy={async (content) => {
                try {
                  await navigator.clipboard.writeText(content);
                  toast.success("Copied");
                } catch {
                  toast.error("Could not copy");
                }
              }}
              onDelete={() => updateMessages((current) => current.filter((_, idx) => idx !== i))}
            />
          );
        })}
      </div>

      <div className="border-t border-border p-2.5">
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!busy && input.trim()) send(input.trim());
              }
            }}
            placeholder="Ask about this presentation…"
            className="min-h-[44px] max-h-40 pr-9 text-sm"
            disabled={busy}
          />
          <button
            onClick={() => (busy ? abortRef.current?.abort() : input.trim() && send(input.trim()))}
            className={cn(
              "absolute bottom-2 right-2 grid size-6 place-items-center rounded-md text-white shadow-sm",
              busy ? "bg-destructive" : "bg-accent hover:bg-accent-strong"
            )}
          >
            {busy ? <Square className="size-2.5" /> : <ArrowUp className="size-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );

  if (fullscreen) {
    return createPortal(
      <div
        className="fixed inset-0 z-[130] flex flex-col bg-black/45 backdrop-blur-md data-[state=open]:animate-in"
        role="dialog"
        aria-modal="true"
        aria-label="Assistant (full screen)"
        onClick={(e) => {
          if (e.target === e.currentTarget) setFullscreen(false);
        }}
      >
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
          <div className="my-3 flex-1 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl sm:my-6">
            {panel}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return panel;
}

function MessageBubble({
  msg,
  thinking,
  showThinking,
  canRegenerate,
  onRegenerate,
  onCopy,
  onDelete,
}: {
  msg: Msg;
  thinking?: boolean;
  showThinking?: boolean;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  onCopy: (content: string) => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const isUser = msg.role === "user";

  const copy = async () => {
    await onCopy(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex gap-2", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-md",
          isUser ? "bg-primary text-primary-foreground" : "bg-accent-soft text-accent-strong"
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </div>
      <div
        className={cn(
          "group relative min-w-0 max-w-[85%] break-words rounded-lg px-3 py-2 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        ) : thinking && !msg.content ? (
          <div className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-accent-strong" />
            <span className="ai-text font-medium">Thinking…</span>
          </div>
        ) : (
          <>
            {showThinking && msg.reasoning && (
              <div className="mb-1.5 overflow-hidden rounded-md border border-border/60 bg-background/50">
                <button
                  className="flex w-full items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  onClick={() => setReasoningOpen((s) => !s)}
                >
                  <Brain className="size-3" /> Thinking
                  <ChevronDown className={cn("ml-auto size-3 transition-transform", reasoningOpen && "rotate-180")} />
                </button>
                {reasoningOpen && (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-border/60 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {msg.reasoning}
                  </pre>
                )}
              </div>
            )}
            <div className="prose-chat break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || "…"}</ReactMarkdown>
            </div>
          </>
        )}
        <div className="absolute -bottom-2 right-2 hidden items-center gap-1 group-hover:flex">
          <button
            onClick={copy}
            className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] shadow-sm"
            title="Copy message"
          >
            {copied ? <Check className="size-2.5 text-success" /> : <Copy className="size-2.5" />} Copy
          </button>
          {canRegenerate && (
            <button
              onClick={onRegenerate}
              className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-accent-strong shadow-sm hover:bg-accent-soft"
              title="Regenerate the assistant reply"
            >
              <RefreshCw className="size-2.5" /> Regenerate
            </button>
          )}
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm hover:text-destructive"
          >
            <Trash2 className="size-2.5" /> Delete
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function newChatSession(): ChatSession {
  const now = Date.now();
  return { id: crypto.randomUUID?.() ?? `chat-${now}-${Math.random()}`, title: "New chat", messages: [], createdAt: now, updatedAt: now };
}

function sessionTitle(messages: Msg[], fallback: string) {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  if (!firstUser) return fallback || "New chat";
  return firstUser.content.replace(/\s+/g, " ").slice(0, 42) || "New chat";
}

function timeLabel(ts: number) {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
