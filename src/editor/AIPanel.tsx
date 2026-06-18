import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Bot,
  Check,
  CheckSquare,
  Clipboard,
  Eraser,
  FileText,
  GitCompare,
  History,
  ListTree,
  Loader2,
  Plus,
  Sparkles,
  Square,
  Trash2,
  User,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useEditor } from "./context";
import { docChatMessages } from "@/lib/ai-actions";
import { chat, chatStream } from "@/lib/ai";
import type { ChatImagePart, ChatMessage } from "@/lib/ai";
import { insertHTML } from "@/lib/editor";
import { checkDocumentPath, readDocumentTextFromPath } from "@/lib/documents/manager";
import { htmlToPlainText } from "@/lib/documents/html";
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

interface PendingEdit {
  instruction: string;
  originalHtml: string;
  proposedHtml: string;
  diff: string;
}

type FileRefStatus = "checking" | "exists" | "missing";

interface FileRef {
  raw: string;
  path: string;
  status: FileRefStatus;
  name?: string;
  size?: number;
  error?: string;
}

const DOC_ACTIONS = [
  { id: "summary", label: "Summarize", icon: Sparkles, q: "Summarize this document in 5 concise bullet points." },
  { id: "outline", label: "Outline", icon: ListTree, q: "Create a structured outline of this document." },
  { id: "actions", label: "Action items", icon: CheckSquare, q: "List every action item, decision and to-do implied by this document as a checklist." },
  { id: "proofread", label: "Proofread", icon: Eraser, q: "Proofread this document. List concrete issues with suggested fixes (grammar, clarity, structure). Don't rewrite the whole doc." },
] as const;

export function AIPanel({
  question,
  reference,
}: {
  question: string | null;
  reference?: { text: string; n: number } | null;
}) {
  const ctx = useEditor();
  const profile = ctx.profile;
  const chatStorageKey = useMemo(() => `wore.aiChats.${ctx.doc?.id ?? "global"}`, [ctx.doc?.id]);
  const [sessions, setSessions] = useState<ChatSession[]>(() => [newChatSession()]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposingEdit, setProposingEdit] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [attachedReference, setAttachedReference] = useState<string | null>(null);
  const [fileRefs, setFileRefs] = useState<FileRef[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const skipNextPersistRef = useRef(false);

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
    skipNextPersistRef.current = true;
    try {
      const raw = localStorage.getItem(chatStorageKey);
      const parsed = raw ? (JSON.parse(raw) as ChatSession[]) : [];
      const valid = parsed.filter((s) => s && s.id && Array.isArray(s.messages));
      const next = valid.length ? valid : [newChatSession()];
      setSessions(next);
      setActiveSessionId(next[0].id);
    } catch {
      const next = [newChatSession()];
      setSessions(next);
      setActiveSessionId(next[0].id);
    }
  }, [chatStorageKey]);

  useEffect(() => {
    if (!sessions.length) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    localStorage.setItem(chatStorageKey, JSON.stringify(sessions.slice(0, 50)));
  }, [chatStorageKey, sessions]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // respond to a question pushed from elsewhere (e.g. command palette)
  useEffect(() => {
    if (question) {
      send(question);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question]);

  useEffect(() => {
    if (reference?.text) {
      setAttachedReference(reference.text);
      setInput((v) => v || "Ask about the referenced selection…");
    }
  }, [reference?.n, reference?.text]);

  const startNewChat = () => {
    const session = newChatSession();
    setSessions((current) => [session, ...current]);
    setActiveSessionId(session.id);
    setHistoryOpen(false);
    setInput("");
    setAttachedReference(null);
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

  const getDocContext = () => ctx.getDocumentText();

  useEffect(() => {
    const refs = extractFileRefs(input);
    if (!refs.length) {
      setFileRefs([]);
      return;
    }

    let cancelled = false;
    setFileRefs((current) =>
      refs.map((ref) => current.find((x) => x.path === ref.path) ?? { ...ref, status: "checking" })
    );

    refs.forEach(async (ref) => {
      try {
        const res = await checkDocumentPath(ref.path);
        if (cancelled) return;
        setFileRefs((current) =>
          current.map((x) =>
            x.path === ref.path
              ? { ...x, status: res.ok ? "exists" : "missing", name: res.name, size: res.size, error: res.error }
              : x
          )
        );
      } catch (e) {
        if (cancelled) return;
        setFileRefs((current) =>
          current.map((x) =>
            x.path === ref.path ? { ...x, status: "missing", error: (e as Error).message } : x
          )
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [input]);

  const readMentionedDocuments = async (sourceText: string) => {
    const refs = extractFileRefs(sourceText);
    const docs: Array<{ name: string; path: string; text: string }> = [];
    for (const ref of refs) {
      const exists = await checkDocumentPath(ref.path);
      if (!exists.ok) continue;
      const result = await readDocumentTextFromPath(ref.path);
      docs.push({
        name: result.title || exists.name || ref.path,
        path: ref.path,
        text: result.text,
      });
    }
    return docs;
  };

  const proposeEdit = async (instructionText?: string) => {
    const instruction = (instructionText ?? input).trim();
    if (!instruction) return;
    if (!profile) {
      toast.error("No AI profile", { description: "Configure one in Settings." });
      return;
    }
    if (!profile.apiKey && !profile.baseUrl.includes("localhost")) {
      toast.error("Missing API key", { description: `Add a key for “${profile.name}”.` });
      return;
    }
    const originalHtml = ctx.getHTML();
    const docText = ctx.getDocumentText();
    setProposingEdit(true);
    setPendingEdit(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await chat(
        profile,
        [
          {
            role: "system",
            content:
              "You are WoRe's document editing engine. Return ONLY a complete updated HTML fragment for the document body. No markdown fences, no explanations. Preserve all existing images, tables, links, classes, inline styles, and structural wrappers unless the user explicitly asks to change them.",
          },
          {
            role: "user",
            content: `Instruction:\n${instruction}\n\nCurrent document plain text context:\n"""\n${docText.slice(0, 12000)}\n"""\n\nCurrent document HTML to edit:\n"""html\n${originalHtml.slice(0, 60000)}\n"""\n\nReturn the full updated HTML fragment only.`,
          },
        ],
        { model: profile.defaultChatModel, maxTokens: Math.min(profile.maxTokens ?? 16384, 32000), temperature: 0.2, signal: ac.signal }
      );
      const proposedHtml = cleanModelHtml(res.text);
      if (!proposedHtml || htmlToPlainText(proposedHtml).length < 2) {
        throw new Error("Model did not return usable edited HTML.");
      }
      setPendingEdit({
        instruction,
        originalHtml,
        proposedHtml,
        diff: makeUnifiedDiff(formatHtmlForDiff(originalHtml), formatHtmlForDiff(proposedHtml)),
      });
      setInput("");
      updateMessages((m) => [
        ...m,
        { role: "user", content: `/edit ${instruction}` },
        { role: "assistant", content: "I prepared an edit proposal. Review the diff, then accept or deny it." },
      ]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast.error("Could not prepare edit", { description: (e as Error).message });
      }
    } finally {
      setProposingEdit(false);
    }
  };

  const acceptPendingEdit = () => {
    if (!pendingEdit) return;
    ctx.setHTML(pendingEdit.proposedHtml);
    ctx.sync();
    setPendingEdit(null);
    toast.success("Edit applied");
  };

  const denyPendingEdit = () => {
    setPendingEdit(null);
    toast.message("Edit discarded");
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
    const docContext = getDocContext();
    const allImages = await ctx.getDocumentImages().catch(() => []);
    const visionReady = isVisionCapable(profile, profile.defaultChatModel);
    const visionImages: ChatImagePart[] = visionReady ? allImages.slice(0, 8) : [];
    let mentionedDocs: Array<{ name: string; path: string; text: string }> = [];
    try {
      mentionedDocs = await readMentionedDocuments(text);
    } catch (e) {
      toast.error("Could not read @file reference", { description: (e as Error).message });
      return;
    }

    const parts: string[] = [];
    if (attachedReference) {
      parts.push(`Referenced selection from the document:\n"""\n${attachedReference.slice(0, 6000)}\n"""`);
    }
    for (const doc of mentionedDocs) {
      parts.push(`Referenced file @${doc.path} (${doc.name}):\n"""\n${doc.text.slice(0, 12000)}\n"""`);
    }
    if (allImages.length && !visionReady) {
      parts.push(
        `Document images present but the selected model "${profile.defaultChatModel}" is not marked as vision-capable. Image metadata only:\n` +
          allImages
            .map((img) => `Image ${img.index}: ${img.alt ?? "image"}${img.caption ? ` — caption: ${img.caption}` : ""}`)
            .join("\n")
      );
    }
    if (text) parts.push(text);
    const finalText = parts.join("\n\n");
    const userMsg: Msg = { role: "user", content: text };
    const history: ChatMessage[] = [
      ...messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    ];
    updateMessages((m) => [...m, userMsg, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;

    const reply = docChatMessages({ question: finalText, docContext, history, images: visionImages });
    let acc = "";
    try {
      for await (const ev of chatStream(profile, reply, {
        model: profile.defaultChatModel,
        reasoning: true,
        signal: ac.signal,
      })) {
        if (ev.delta) {
          acc += ev.delta;
          updateMessages((m) => {
            const next = [...m];
            next[next.length - 1] = { role: "assistant", content: acc };
            return next;
          });
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        updateMessages((m) => {
          const next = [...m];
          next[next.length - 1] = {
            role: "assistant",
            content: `⚠️ ${(e as Error).message}`,
          };
          return next;
        });
      }
    } finally {
      setBusy(false);
      if (attachedReference) setAttachedReference(null);
    }
  };

  return (
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

      {/* doc actions */}
      <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2.5">
        {DOC_ACTIONS.map((a) => (
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

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="mt-6 text-center text-sm text-muted-foreground">
            <Sparkles className="mx-auto mb-2 size-6 text-accent-strong" />
            Ask anything about this document. The agent reads the full text for context.
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            msg={m}
            onDelete={() => updateMessages((current) => current.filter((_, idx) => idx !== i))}
          />
        ))}
        {busy && messages[messages.length - 1]?.content === "" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-accent-strong" />
            <span className="ai-text font-medium">Thinking…</span>
          </div>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-border p-2.5">
        {pendingEdit && (
          <div className="mb-2 overflow-hidden rounded-lg border border-accent/30 bg-accent-soft/20 text-xs">
            <div className="flex items-center gap-2 border-b border-border bg-card/70 px-2.5 py-2">
              <GitCompare className="size-3.5 text-accent-strong" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Proposed document edit</div>
                <div className="truncate text-[10px] text-muted-foreground">{pendingEdit.instruction}</div>
              </div>
              <Button size="xs" variant="ghost" onClick={denyPendingEdit}>
                <X /> Deny
              </Button>
              <Button size="xs" variant="accent" onClick={acceptPendingEdit}>
                <Check /> Accept
              </Button>
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap bg-background px-3 py-2 font-mono text-[10px] leading-relaxed">
              {pendingEdit.diff}
            </pre>
          </div>
        )}

        {fileRefs.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {fileRefs.map((ref) => (
              <FileRefChip key={ref.path} refInfo={ref} />
            ))}
          </div>
        )}

        {attachedReference && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-border bg-muted/60 px-2 py-1.5 text-xs">
            <Clipboard className="mt-0.5 size-3.5 text-accent-strong" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Referenced selection attached</div>
              <div className="truncate text-muted-foreground">
                {attachedReference.replace(/\s+/g, " ").slice(0, 120)}
                {attachedReference.length > 120 ? "…" : ""}
              </div>
            </div>
            <button onClick={() => setAttachedReference(null)} className="text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </div>
        )}
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
            placeholder="Ask about this document… use @C:\\path\\file.md to reference a file"
            className="min-h-[44px] max-h-40 pl-[4.5rem] pr-9 text-sm"
            disabled={busy}
          />
          <button
            onClick={() => input.trim() && proposeEdit(input.trim())}
            disabled={busy || proposingEdit || !input.trim()}
            className="absolute bottom-2 left-2 inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[10px] text-muted-foreground shadow-sm hover:text-foreground disabled:opacity-40"
            title="Prepare an editable diff for this document"
          >
            {proposingEdit ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
            Edit
          </button>
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
}

function cleanModelHtml(raw: string) {
  let html = raw.trim();
  const fenced = /^```(?:html)?\s*([\s\S]*?)\s*```$/i.exec(html);
  if (fenced) html = fenced[1].trim();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const body = parsed.body;
  if (body && body.children.length && /<html|<body/i.test(html)) html = body.innerHTML;

  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.querySelectorAll("script, iframe, object, embed").forEach((n) => n.remove());
  tpl.content.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) el.removeAttribute(attr.name);
    });
  });
  return tpl.innerHTML.trim();
}

function formatHtmlForDiff(html: string) {
  return html
    .replace(/></g, ">\n<")
    .replace(/<(p|h[1-6]|li|tr|table|section|div|figure|img|blockquote)(\s|>)/gi, "\n<$1$2")
    .replace(/<\/(p|h[1-6]|li|tr|table|section|div|figure|blockquote)>/gi, "</$1>\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 1200)
    .join("\n");
}

function makeUnifiedDiff(oldText: string, newText: string) {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const out = ["--- current document", "+++ proposed document", "@@"];
  let i = 0;
  let j = 0;
  let shown = 0;
  const max = 500;
  while ((i < a.length || j < b.length) && shown < max) {
    if (a[i] === b[j]) {
      if (a[i]?.trim()) out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (a[i + 1] === b[j]) {
      out.push(`- ${a[i] ?? ""}`);
      i++;
    } else if (a[i] === b[j + 1]) {
      out.push(`+ ${b[j] ?? ""}`);
      j++;
    } else {
      if (i < a.length) out.push(`- ${a[i++]}`);
      if (j < b.length) out.push(`+ ${b[j++]}`);
    }
    shown++;
  }
  if (i < a.length || j < b.length) out.push("… diff truncated …");
  return out.join("\n");
}

function isVisionCapable(
  profile: { models?: Array<{ id: string; vision?: boolean; visionTestedAt?: number }>; defaultChatModel?: string },
  modelId: string
) {
  const model = profile.models?.find((m) => m.id === modelId);
  if (model?.visionTestedAt) return !!model.vision;
  if (model?.vision) return true;
  return /vision|gpt-4o|claude.*sonnet|gemini|qwen.*vl|llava|moondream|minicpm.*v|pixtral|gemma.*vision/i.test(modelId);
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

function extractFileRefs(text: string): Array<Pick<FileRef, "raw" | "path">> {
  const found: Array<Pick<FileRef, "raw" | "path">> = [];
  const seen = new Set<string>();

  const add = (raw: string, path: string) => {
    const clean = path.trim().replace(/[),.;]+$/g, "");
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    found.push({ raw, path: clean });
  };

  // Supports paths with spaces via @"C:\\Users\\Me\\file name.docx" or @'/tmp/file name.md'.
  for (const match of text.matchAll(/@(?:"([^"]+)"|'([^']+)')/g)) {
    add(match[0], match[1] ?? match[2] ?? "");
  }

  // Supports common unquoted paths: @C:\\x\\y.md, @C:/x/y.pdf, @./x.md, @../x.md, @/x/y.txt.
  const unquoted = /@([A-Za-z]:[\\/][^\s"'`]+|\.{1,2}[\\/][^\s"'`]+|[\\/][^\s"'`]+|[^\s@"'`]+[\\/][^\s@"'`]+)/g;
  for (const match of text.matchAll(unquoted)) {
    add(match[0], match[1]);
  }

  return found;
}

function shortPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function FileRefChip({ refInfo }: { refInfo: FileRef }) {
  const ok = refInfo.status === "exists";
  const missing = refInfo.status === "missing";
  return (
    <span
      title={refInfo.error ? `${refInfo.path}\n${refInfo.error}` : refInfo.path}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
        ok && "border-success/30 bg-success/10 text-success-foreground",
        missing && "border-destructive/30 bg-destructive/10 text-destructive-foreground",
        refInfo.status === "checking" && "border-border bg-muted text-muted-foreground"
      )}
    >
      <FileText className="size-3 shrink-0" />
      <span className="truncate">@{refInfo.name || shortPath(refInfo.path)}</span>
      <span className="text-[10px] opacity-70">
        {ok ? "found" : missing ? "missing" : "checking"}
      </span>
    </span>
  );
}

function MessageBubble({ msg, onDelete }: { msg: Msg; onDelete: () => void }) {
  const ctx = useEditor();
  const isUser = msg.role === "user";
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
          "group relative max-w-[85%] rounded-lg px-3 py-2 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className="prose-chat">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || "…"}</ReactMarkdown>
          </div>
        )}
        <div className="absolute -bottom-2 right-2 hidden items-center gap-1 group-hover:flex">
          {!isUser && msg.content && (
            <button
              onClick={() => {
                ctx.focus();
                insertHTML(`<p>${msg.content.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p><p><br></p>`);
                ctx.sync();
                toast.success("Inserted into document");
              }}
              className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] shadow-sm"
            >
              <Clipboard className="size-2.5" /> Insert
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
