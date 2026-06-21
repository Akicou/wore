import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  Check,
  CloudOff,
  Columns2,
  Copy,
  FileDown,
  FilePlus2,
  FileText,
  FileType2,
  Eye,
  FolderOpen,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Redo2,
  Save,
  Search,
  Settings2,
  Sparkles,
  Undo2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsDialog } from "@/components/SettingsDialog";
import { AIPicker } from "@/components/AIPicker";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStore, countWords } from "@/lib/store";
import type { RecentDoc } from "@/lib/store";
import {
  loadDoc,
  saveDoc,
  getSourceBytes,
  exportDoc,
  exportPdfToDocx,
  importFile,
  newDoc,
} from "@/lib/documents/manager";
import type { StoredDoc } from "@/lib/documents/manager";
import { renderPdfPages, type RenderedPage } from "@/lib/documents/pdf";
import { undo, redo } from "@/lib/editor";
import { htmlToPlainText, nodeToPlainText, wordCount, readingTimeMin, charCount } from "@/lib/documents/html";
import { docxToHtml, docxToText, repairDocxImportImages } from "@/lib/documents/docx";
import { markdownToHtml, starterMarkdown } from "@/lib/documents/markdown";
import { downloadBlob, cn } from "@/lib/utils";

import { EditorContext, type DocumentImage, type SelectionTarget } from "./context";
import { WoreEditor, useFormats } from "./WoreEditor";
import { Toolbar } from "./Toolbar";
import { SelectionChat } from "./SelectionChat";
import { AIPanel } from "./AIPanel";
import { ImageGenDialog } from "./ImageGenDialog";
import { ReferencePanel } from "./ReferencePanel";
import { FindBar } from "./FindBar";

const ACCEPT = ".md,.markdown,.txt,.html,.htm,.docx,.pdf";
const PDF_EDIT_NOTICE_SNOOZE_KEY = "wore.pdfEditNotice.snoozeUntil";
const PDF_NOTICE_SNOOZE_MS = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
} as const;
type PdfNoticeSnooze = keyof typeof PDF_NOTICE_SNOOZE_MS;
const PDF_NOTICE_SNOOZE_LABELS: Record<PdfNoticeSnooze, string> = {
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
};

function isPdfEditNoticeSnoozed() {
  try {
    const until = Number(localStorage.getItem(PDF_EDIT_NOTICE_SNOOZE_KEY) ?? 0);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function snoozePdfEditNotice(snooze: PdfNoticeSnooze) {
  try {
    localStorage.setItem(PDF_EDIT_NOTICE_SNOOZE_KEY, String(Date.now() + PDF_NOTICE_SNOOZE_MS[snooze]));
  } catch {}
}

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const recent = useStore((s) => s.recent);
  const upsertRecent = useStore((s) => s.upsertRecent);
  const touchRecent = useStore((s) => s.touchRecent);
  const activeProfileId = useStore((s) => s.activeProfileId);
  const profiles = useStore((s) => s.profiles);
  const autosaveMs = useStore((s) => s.autosaveMs);
  const defaultFontSize = useStore((s) => s.defaultFontSize);
  const openTabs = useStore((s) => s.openTabs);
  const addTab = useStore((s) => s.addTab);
  const removeTab = useStore((s) => s.removeTab);
  const splitView = useStore((s) => s.splitView);
  const setSplitView = useStore((s) => s.setSplitView);
  const keybindings = useStore((s) => s.keybindings);
  const profile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  const [doc, setDoc] = useState<StoredDoc | null>(null);
  const [loading, setLoading] = useState(true);
  // `loading` is only the very first load (full-screen splash). Tab switches
  // keep the shell mounted and transition the content area inline, so switching
  // documents never feels like the whole UI is reloading.
  const [switching, setSwitching] = useState(false);
  const [showSwitchLoader, setShowSwitchLoader] = useState(false);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isFirstLoadRef = useRef(true);
  const switchLoaderTimer = useRef<number | null>(null);
  const formats = useFormats(editorRef);
  const [selection, setSelection] = useState<SelectionTarget | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelReference, setPanelReference] = useState<{ text: string; n: number } | null>(null);
  const [previewMenu, setPreviewMenu] = useState<{ x: number; y: number; text: string; range: Range } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [pdfNoticeOpen, setPdfNoticeOpen] = useState(false);
  const [pdfNoticeDontShow, setPdfNoticeDontShow] = useState(false);
  const [pdfNoticeSnooze, setPdfNoticeSnooze] = useState<PdfNoticeSnooze>("24h");
  const [zoom, setZoom] = useState(1);

  // Ctrl + scroll wheel zoom
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaY;
      setZoom((z) => {
        const next = delta > 0 ? z - 0.1 : z + 0.1;
        return Math.max(0.5, Math.min(3, +next.toFixed(2)));
      });
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [pdfRenderScale, setPdfRenderScale] = useState(1.5);

  // Re-render PDFs at native resolution when zoom changes so image quality
  // doesn't degrade. Debounced so Ctrl+wheel and rapid button clicks don't
  // thrash the canvas renderer.
  useEffect(() => {
    if (doc?.format !== "pdf" || view !== "preview") return;
    const target = Math.max(zoom, 1.5);
    if (Math.abs(pdfRenderScale - target) < 0.05) return;
    const timer = window.setTimeout(() => setPdfRenderScale(target), 300);
    return () => clearTimeout(timer);
  }, [zoom, doc?.format, view, pdfRenderScale]);

  const [pdfPages, setPdfPages] = useState<RenderedPage[] | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [docxPreviewLoading, setDocxPreviewLoading] = useState(false);
  const [docxPreviewError, setDocxPreviewError] = useState<string | null>(null);
  const [sourceTextContext, setSourceTextContext] = useState("");
  const [stats, setStats] = useState({ words: 0, chars: 0, mins: 1 });
  const docxPreviewRef = useRef<HTMLDivElement>(null);

  const showPdfEditNotice = useCallback(() => {
    if (isPdfEditNoticeSnoozed()) return;
    setPdfNoticeOpen(true);
  }, []);

  const acknowledgePdfEditNotice = useCallback(() => {
    if (pdfNoticeDontShow) snoozePdfEditNotice(pdfNoticeSnooze);
    setPdfNoticeOpen(false);
  }, [pdfNoticeDontShow, pdfNoticeSnooze]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      try {
        let lastId: string | null = null;
        for (const file of list) {
          const { doc: importedDoc, recent: importedRecent } = await importFile(file);
          await saveDoc(importedDoc);
          upsertRecent(importedRecent);
          addTab(importedDoc.id);
          lastId = importedDoc.id;
        }
        if (lastId) navigate(`/editor/${lastId}`);
      } catch (e) {
        toast.error("Could not open file", { description: (e as Error).message });
      }
    },
    [addTab, navigate, upsertRecent]
  );

  const createNewDocument = useCallback(
    async (newTitle: string, format: "md" | "docx") => {
      const safeTitle = newTitle || "Untitled";
      const html = format === "md" ? markdownToHtml(starterMarkdown(safeTitle)) : `<h1>${safeTitle}</h1><p><br></p>`;
      const created = newDoc(format, safeTitle, html);
      await saveDoc(created);
      upsertRecent({
        id: created.id,
        title: created.title,
        format: created.format,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
        openedAt: Date.now(),
        size: new Blob([html]).size,
      });
      addTab(created.id);
      setNewOpen(false);
      navigate(`/editor/${created.id}`);
    },
    [addTab, navigate, upsertRecent]
  );

  /* ----------------------------- load document ---------------------------- */
  // The full-screen "Opening document…" splash only shows on the very first
  // load. Switching between open tabs keeps the editor shell mounted (header,
  // tabs, toolbar, panels) and transitions only the content area inline. A
  // loader is revealed for the content area only if a switch takes longer than
  // ~160ms, so fast IDB reads don't flicker a spinner for a frame or two.
  useEffect(() => {
    let cancelled = false;
    const firstLoad = isFirstLoadRef.current;
    if (firstLoad) {
      setLoading(true);
    } else {
      setSwitching(true);
      setShowSwitchLoader(false);
      switchLoaderTimer.current = window.setTimeout(() => setShowSwitchLoader(true), 160);
    }
    const finish = () => {
      if (switchLoaderTimer.current) {
        clearTimeout(switchLoaderTimer.current);
        switchLoaderTimer.current = null;
      }
      isFirstLoadRef.current = false;
      setLoading(false);
      setSwitching(false);
      setShowSwitchLoader(false);
    };
    (async () => {
      const d = id ? await loadDoc(id) : undefined;
      if (cancelled) return;
      if (!d) {
        finish();
        return;
      }
      let loaded = d;
      const sourceBytes = d.format === "docx" || d.format === "pdf" ? await getSourceBytes(d.id) : undefined;
      const hasSourceBytes = !!sourceBytes;
      if (d.format === "docx") {
        const bytes = sourceBytes;
        if (bytes && !cancelled) {
          if (!d.contentHtml.includes("wore-docx-import")) {
            const visualHtml = await docxToHtml(bytes.slice(0)).catch(() => "");
            if (visualHtml) {
              loaded = { ...d, contentHtml: visualHtml, updatedAt: Date.now() };
              await saveDoc(loaded);
            }
          } else {
            const repairedHtml = await repairDocxImportImages(bytes.slice(0), d.contentHtml).catch(() => d.contentHtml);
            if (repairedHtml !== d.contentHtml) {
              loaded = { ...d, contentHtml: repairedHtml, updatedAt: Date.now() };
              await saveDoc(loaded);
            }
          }
        }
      }
      if (cancelled) return;
      setDoc(loaded);
      setContent(loaded.contentHtml);
      setTitle(loaded.title);
      setSourceTextContext("");
      // PDFs are read-only in WoRe: they can only be previewed, never edited.
      // DOCX visual preview still needs original bytes, so freshly created docs
      // (which have none) open in editable text mode.
      setView(loaded.format === "pdf" ? "preview" : loaded.format === "docx" && hasSourceBytes ? "preview" : "edit");
      if (loaded.format === "pdf") showPdfEditNotice();
      addTab(d.id);
      touchRecent(d.id);
      finish();
    })();
    return () => {
      cancelled = true;
      if (switchLoaderTimer.current) {
        clearTimeout(switchLoaderTimer.current);
        switchLoaderTimer.current = null;
      }
    };
  }, [id, touchRecent, addTab, showPdfEditNotice]);

  /* ------------------------------- autosave -------------------------------- */
  // Keep latest doc/recent in refs so the debounce effect only re-arms on
  // actual content/title edits (no idle write loops).
  const docRef = useRef(doc);
  docRef.current = doc;
  const recentRef = useRef(recent);
  recentRef.current = recent;
  const titleRef = useRef(title);
  titleRef.current = title;
  const skipFirst = useRef(true);

  const persistNow = useCallback(async () => {
    const current = docRef.current;
    if (!current) {
      setSaving(false);
      return;
    }
    setSaving(true);
    const updated: StoredDoc = {
      ...current,
      title: titleRef.current,
      contentHtml: editorRef.current?.innerHTML ?? current.contentHtml,
      updatedAt: Date.now(),
    };
    await saveDoc(updated);
    setDoc(updated);
    const rec = recentRef.current.find((r) => r.id === updated.id);
    const meta: RecentDoc = {
      id: updated.id,
      title: updated.title,
      format: updated.format,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      openedAt: rec?.openedAt ?? Date.now(),
      size: rec?.size ?? new Blob([updated.contentHtml]).size,
      wordCount: countWords(updated.contentHtml),
      pinned: rec?.pinned,
      hasSource: rec?.hasSource,
    };
    upsertRecent(meta);
    setSaving(false);
    setSavedAt(Date.now());
  }, [upsertRecent]);

  useEffect(() => {
    if (autosaveMs === 0) return;
    if (skipFirst.current) {
      // ignore the very first run triggered by the initial load
      skipFirst.current = false;
      return;
    }
    setSaving(true);
    const t = setTimeout(() => {
      persistNow();
    }, Math.max(800, autosaveMs));
    return () => clearTimeout(t);
  }, [content, title, autosaveMs, persistNow]);

  // Manual save (Ctrl/Cmd+S) — the only way to persist when autosave is Off.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        persistNow().then(() => toast.success("Saved"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [persistNow]);

  /* ------------------------------- live stats ------------------------------ */
  useEffect(() => {
    const update = () => {
      const html = editorRef.current?.innerHTML ?? content;
      setStats({ words: wordCount(html), chars: charCount(html), mins: readingTimeMin(html) });
    };
    update();
    const el = editorRef.current;
    if (!el) {
      const t = window.setTimeout(update, 0);
      return () => window.clearTimeout(t);
    }
    const observer = new MutationObserver(update);
    observer.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
    return () => observer.disconnect();
  }, [content, doc?.id, view]);

  /* ------------------------------ pdf preview ------------------------------ */
  useEffect(() => {
    if (view !== "preview" || doc?.format !== "pdf") {
      setPdfPages(null);
      return;
    }
    let cancelled = false;
    setPdfLoading(true);
    (async () => {
      const bytes = await getSourceBytes(doc!.id);
      if (!bytes || cancelled) {
        setPdfLoading(false);
        return;
      }
      const pages = await renderPdfPages(bytes, pdfRenderScale);
      if (!cancelled) {
        setPdfPages(pages);
        setPdfLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, doc, pdfRenderScale]);

  /* -------------------------- source text context -------------------------- */
  useEffect(() => {
    if (doc?.format !== "docx") {
      setSourceTextContext("");
      return;
    }
    let cancelled = false;
    (async () => {
      const bytes = await getSourceBytes(doc.id);
      if (!bytes || cancelled) return;
      const text = await docxToText(bytes.slice(0)).catch(() => "");
      if (!cancelled) setSourceTextContext(text);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc?.id, doc?.format]);

  /* ----------------------------- docx preview ------------------------------ */
  // The Word preview renders the *current* document HTML — the same docx-preview
  // markup (plus its embedded <style> host) captured at import and then edited in
  // place — so the preview always reflects edits instead of the original bytes.
  useEffect(() => {
    const shouldRenderDocxPreview = doc?.format === "docx" && (view === "preview" || splitView);
    if (!shouldRenderDocxPreview) {
      setDocxPreviewLoading(false);
      setDocxPreviewError(null);
      return;
    }
    const container = docxPreviewRef.current;
    if (!container) return;
    setDocxPreviewLoading(false);
    setDocxPreviewError(null);
    // In split view the editor is mounted, so prefer its live DOM; otherwise the
    // synced `content` state is the source of truth.
    const html = view === "edit" && editorRef.current ? editorRef.current.innerHTML : content;
    container.innerHTML = html || "<p><br></p>";
    const text = nodeToPlainText(container);
    setStats({ words: wordCount(text), chars: text.length, mins: Math.max(1, Math.round(wordCount(text) / 200)) });
  }, [view, doc, splitView, content]);

  /* ----------------------------- context value ----------------------------- */
  const getHTML = useCallback(() => editorRef.current?.innerHTML ?? content, [content]);
  const setHTML = useCallback((html: string) => {
    if (editorRef.current) editorRef.current.innerHTML = html;
    setContent(html);
  }, []);
  const focus = useCallback(() => editorRef.current?.focus(), []);
  const sync = useCallback(() => setContent(editorRef.current?.innerHTML ?? content), [content]);
  const runEditorHistory = useCallback((fn: () => void) => {
    if (view !== "edit") return;
    editorRef.current?.focus();
    fn();
    sync();
  }, [sync, view]);

  const openSelectionChat = useCallback((t: SelectionTarget) => setSelection(t), []);
  const closeSelectionChat = useCallback(() => setSelection(null), []);

  const addChatReference = useCallback((text: string) => {
    setPanelOpen(true);
    setPanelReference({ text, n: Date.now() });
  }, []);

  const onSelectionRect = useCallback((rect: DOMRect) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    setSelection({
      range: sel.getRangeAt(0).cloneRange(),
      rect,
      text: sel.toString(),
    });
  }, []);

  const openCurrentSelection = useCallback((root: HTMLElement | null, readOnly = false) => {
    const sel = window.getSelection();
    if (!root || !sel || sel.isCollapsed || !sel.rangeCount || !sel.anchorNode || !root.contains(sel.anchorNode)) return false;
    const range = sel.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    setSelection({ range, rect, text: sel.toString(), readOnly });
    return true;
  }, []);

  const getDocumentText = useCallback(() => {
    // Prefer the live, edited document. htmlToPlainText/nodeToPlainText strip the
    // embedded docx style host, so the AI never sees raw CSS. Fall back to the
    // preview node, then the original source text, then synced content.
    const liveHtml = editorRef.current?.innerHTML;
    if (liveHtml) {
      const t = htmlToPlainText(liveHtml);
      if (t.trim()) return t;
    }
    if (doc?.format === "docx" && docxPreviewRef.current) {
      const previewText = nodeToPlainText(docxPreviewRef.current);
      if (previewText.trim()) return previewText;
    }
    if (doc?.format === "docx" && sourceTextContext.trim()) return sourceTextContext.trim();
    return htmlToPlainText(content);
  }, [content, doc?.format, sourceTextContext]);

  const getDocumentImages = useCallback(async (): Promise<DocumentImage[]> => {
    const roots = [
      view === "preview" || splitView ? docxPreviewRef.current : null,
      editorRef.current,
    ].filter(Boolean) as HTMLElement[];
    return collectDocumentImages(roots);
  }, [splitView, view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextInput(e.target) && !(e.target as HTMLElement).isContentEditable) return;
      if (matchesKeybinding(e, keybindings.splitView)) {
        e.preventDefault();
        setSplitView(!splitView);
        return;
      }
      if (matchesKeybinding(e, keybindings.selectionChat)) {
        const opened = openCurrentSelection(editorRef.current, false) || openCurrentSelection(docxPreviewRef.current, true);
        if (opened) e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [keybindings, openCurrentSelection, setSplitView, splitView]);

  useEffect(() => {
    const el = docxPreviewRef.current;
    if (doc?.format !== "docx" || !(view === "preview" || splitView) || !el) return;
    const onContext = (e: MouseEvent) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.anchorNode || !el.contains(sel.anchorNode)) return;
      e.preventDefault();
      const range = sel.getRangeAt(0).cloneRange();
      const w = 230;
      const h = 150;
      setPreviewMenu({
        x: Math.min(Math.max(8, e.clientX), window.innerWidth - w - 8),
        y: Math.min(Math.max(8, e.clientY), window.innerHeight - h - 8),
        text: sel.toString(),
        range,
      });
    };
    const close = () => setPreviewMenu(null);
    el.addEventListener("contextmenu", onContext);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      el.removeEventListener("contextmenu", onContext);
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [doc?.format, view, splitView]);

  const ctxValue = useMemo(
    () => ({
      editorEl: editorRef,
      getHTML,
      getDocumentText,
      getDocumentImages,
      setHTML,
      focus,
      sync,
      formats,
      selection,
      openSelectionChat,
      closeSelectionChat,
      addChatReference,
      doc,
      content,
      setContent,
      profile,
    }),
    [getHTML, getDocumentText, getDocumentImages, setHTML, focus, sync, formats, selection, openSelectionChat, closeSelectionChat, addChatReference, doc, content, profile]
  );

  /* -------------------------------- export --------------------------------- */
  const exportAs = async (target: Parameters<typeof exportDoc>[1]) => {
    if (!doc) return;
    try {
      const current: StoredDoc = { ...doc, contentHtml: getHTML(), title };
      const res = await exportDoc(current, target);
      if ("print" in res) {
        window.print();
      } else {
        downloadBlob(res.blob, res.filename);
        toast.success(`Exported ${res.filename}`);
      }
    } catch (e) {
      toast.error("Export failed", { description: (e as Error).message });
    }
  };

  const convertPdfToDocx = async () => {
    if (!doc) return;
    const tid = toast.loading("Converting PDF → DOCX…");
    try {
      const current: StoredDoc = { ...doc, title };
      const { blob, filename } = await exportPdfToDocx(current);
      downloadBlob(blob, filename);
      toast.success("Converted to DOCX", { id: tid, description: filename });
    } catch (e) {
      toast.error("Conversion failed", { id: tid, description: (e as Error).message });
    }
  };

  /* -------------------------------- render --------------------------------- */
  if (loading || (!doc && switching)) {
    return (
      <div className="grid h-screen place-items-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin text-accent-strong" />
          <span className="font-display">Opening document…</span>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="grid h-screen place-items-center bg-background text-center">
        <div>
          <h1 className="font-display text-3xl">Document not found</h1>
          <p className="mt-2 text-muted-foreground">It may have been removed.</p>
          <Button className="mt-4" onClick={() => navigate("/")}>
            <ArrowLeft /> Back to start
          </Button>
        </div>
      </div>
    );
  }

  const { words, chars, mins } = stats;
  const profileReady = !!profile && (!!profile.apiKey || /localhost|127\.0\.0\.1/.test(profile.baseUrl));
  const tabDocs = openTabs
    .map((tabId) => recent.find((r) => r.id === tabId) ?? (tabId === doc.id ? { id: doc.id, title, format: doc.format } : null))
    .filter(Boolean) as Array<{ id: string; title: string; format: StoredDoc["format"] }>;

  // While switching, the target doc's metadata is already in `recent`, so reflect
  // it in the chrome (format chip, title, view toggle) instantly instead of
  // flashing the document we're leaving behind.
  const switchingMeta = switching && id ? recent.find((r) => r.id === id) : undefined;
  const headerFormat = switchingMeta?.format ?? doc.format;
  const headerTitle = switchingMeta?.title ?? title;

  return (
    <EditorContext.Provider value={ctxValue}>
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* menu bar */}
        <header className="no-print relative flex h-9 select-none items-center border-b border-border bg-background px-2">
          {/* left: brand + menus */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => navigate("/")}
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Home"
            >
              <Brand size={18} withText={false} />
            </button>

            {/* File */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-7 rounded-md px-2.5 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-muted/60 data-[state=open]:bg-muted/60">
                  File
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={() => setNewOpen(true)}>
                  <FilePlus2 className="size-3.5 text-accent-strong" /> New…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => fileInput.current?.click()}>
                  <FolderOpen className="size-3.5" /> Open…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => persistNow().then(() => toast.success("Saved"))}>
                  <Save className="size-3.5 text-success" /> Save <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+S</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Export</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => exportAs("pdf-print")}>
                  <FileText className="size-3.5 text-destructive" /> PDF <span className="ml-auto text-[10px] text-muted-foreground">print</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs("docx")}>
                  <FileType2 className="size-3.5 text-accent-strong" /> Word (.docx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs("md")}>
                  <FileDown className="size-3.5" /> Markdown (.md)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs("html")}>
                  <FileText className="size-3.5" /> HTML
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs("txt")}>
                  <FileText className="size-3.5" /> Plain text
                </DropdownMenuItem>
                {doc.format === "pdf" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={convertPdfToDocx} className="text-accent-strong">
                      <Wand2 className="size-3.5" /> Convert to Word
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Edit */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-7 rounded-md px-2.5 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-muted/60 data-[state=open]:bg-muted/60">
                  Edit
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem disabled={view !== "edit"} onClick={() => runEditorHistory(undo)}>
                  <Undo2 className="size-3.5" /> Undo <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+Z</span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={view !== "edit"} onClick={() => runEditorHistory(redo)}>
                  <Redo2 className="size-3.5" /> Redo <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+Shift+Z</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    const el = editorRef.current || docxPreviewRef.current;
                    if (!el) return;
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    const sel = window.getSelection();
                    sel?.removeAllRanges();
                    sel?.addRange(range);
                  }}
                >
                  <Copy className="size-3.5" /> Select All <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+A</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* View */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-7 rounded-md px-2.5 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-muted/60 data-[state=open]:bg-muted/60">
                  View
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {(headerFormat === "pdf" || headerFormat === "docx") && (
                  <>
                    <DropdownMenuItem disabled={headerFormat === "pdf"} onClick={() => setView("edit")}>
                      <Pencil className="size-3.5" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setView("preview")}>
                      <Eye className="size-3.5" /> Preview
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}>
                  <Maximize2 className="size-3.5" /> Zoom In
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)))}>
                  <Minimize2 className="size-3.5" /> Zoom Out
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setZoom(1)}>
                  <Eye className="size-3.5" /> Reset Zoom
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSplitView(!splitView)}>
                  <Columns2 className="size-3.5" /> Split View <span className="ml-auto text-[10px] text-muted-foreground">{keybindings.splitView}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setReferenceOpen((o) => !o)}>
                  <BookOpen className="size-3.5" /> Reference Panel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPanelOpen((o) => !o)}>
                  <Sparkles className="size-3.5" /> AI Panel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* center: title */}
          <div className="pointer-events-none absolute inset-x-0 flex justify-center px-32">
            <div className="pointer-events-auto flex min-w-0 max-w-md items-center gap-1.5">
              <FormatChip format={headerFormat} />
              <input
                value={headerTitle}
                onChange={(e) => setTitle(e.target.value)}
                className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm font-semibold outline-none transition-colors hover:bg-muted/50 focus:bg-muted/50"
                placeholder="Untitled"
              />
            </div>
          </div>

          {/* right: status + zoom + controls */}
          <div className="ml-auto flex items-center gap-0.5">
            <span
              title={saving ? "Saving…" : savedAt ? "Saved" : "Not saved"}
              className="grid h-7 w-7 place-items-center"
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin text-accent" />
              ) : savedAt ? (
                <Check className="size-3 text-success" />
              ) : (
                <CloudOff className="size-3 text-muted-foreground" />
              )}
            </span>

            {/* zoom */}
            <div className="ml-1 flex h-7 items-center overflow-hidden rounded-md border border-border bg-muted/30">
              <button
                className="grid h-7 w-5 place-items-center rounded-l-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
                onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}
                disabled={zoom <= 0.5}
                title="Zoom out"
              >
                <ZoomOut className="size-3" />
              </button>
              <button
                className="flex h-7 items-center px-1 text-center text-[11px] font-medium tabular-nums text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                onClick={() => setZoom(1)}
                title="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="grid h-7 w-5 place-items-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
                onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}
                disabled={zoom >= 3}
                title="Zoom in"
              >
                <ZoomIn className="size-3" />
              </button>
            </div>

            <button
              className={cn(
                "grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
                searchOpen && "bg-muted text-foreground"
              )}
              onClick={() => setSearchOpen((v) => !v)}
              title="Find in document"
            >
              <Search className="size-3" />
            </button>

            <AIPicker onOpenSettings={() => setSettingsOpen(true)} />

            <button
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
            >
              <Settings2 className="size-4" />
            </button>
            <ThemeToggle />
          </div>
        </header>

        <DocumentTabs
          tabs={tabDocs}
          activeId={id ?? doc.id}
          onOpen={(tabId) => navigate(`/editor/${tabId}`)}
          onClose={(tabId) => {
            removeTab(tabId);
            if (tabId === doc.id) {
              const next = tabDocs.find((t) => t.id !== tabId);
              navigate(next ? `/editor/${next.id}` : "/");
            }
          }}
        />

        {/* find bar */}
        {!showSwitchLoader && view === "edit" && (
          <FindBar
            editorRef={editorRef}
            isOpen={searchOpen}
            onClose={() => {
              setSearchOpen(false);
              editorRef.current?.focus();
            }}
            onSync={() => {
              setContent(editorRef.current?.innerHTML ?? content);
            }}
          />
        )}

        {/* toolbar (edit view only) */}
        {!showSwitchLoader && view === "edit" && <Toolbar onGenerateImage={() => setImageOpen(true)} />}

        {/* body */}
        <div className="flex min-h-0 flex-1">
          {referenceOpen && (
            <aside className="no-print hidden w-[320px] shrink-0 border-r border-border md:flex md:flex-col">
              <ReferencePanel
                referenceId={referenceId}
                activeDocId={doc.id}
                onPick={(pickedId) => {
                  setReferenceId(pickedId);
                  toast.success("Reference pinned");
                }}
                onClear={() => setReferenceId(null)}
                onClose={() => setReferenceOpen(false)}
              />
            </aside>
          )}
          <main className="print-area relative min-w-0 flex-1 overflow-auto bg-canvas">
            {showSwitchLoader ? (
              <div className="grid min-h-full place-items-center">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin text-accent-strong" />
                  <span className="font-display text-sm">Opening…</span>
                </div>
              </div>
            ) : (
            <div className={cn("min-h-full", switching && "pointer-events-none")}>
            {view === "edit" ? (
              splitView ? (
                <div className="grid min-h-full grid-cols-2 divide-x divide-border" style={{ zoom }}>
                  <div className="min-w-0 overflow-auto px-4 py-8 sm:px-6 sm:py-10">
                    {doc.format === "docx" ? (
                      <WoreEditor
                        key={doc.id}
                        editorRef={editorRef}
                        initialHTML={content}
                        onChange={setContent}
                        onSelectionTarget={onSelectionRect}
                        fontSize={defaultFontSize}
                        visualDocx
                      />
                    ) : (
                      <div className="wore-page print-area mx-auto min-h-[60vh] rounded-[3px]">
                        <WoreEditor
                          key={doc.id}
                          editorRef={editorRef}
                          initialHTML={content}
                          onChange={setContent}
                          onSelectionTarget={onSelectionRect}
                          fontSize={defaultFontSize}
                        />
                      </div>
                    )}
                  </div>
                  {doc.format === "docx" ? (
                    <DocxPreview loading={docxPreviewLoading} error={docxPreviewError} previewRef={docxPreviewRef} zoom={1} />
                  ) : (
                    <ReadOnlyHtmlPreview html={content} />
                  )}
                </div>
              ) : (
                <div
                  className="min-h-full px-4 py-8 sm:px-8 sm:py-12"
                  style={{ zoom }}
                >
                  {doc.format === "docx" ? (
                    <WoreEditor
                      key={doc.id}
                      editorRef={editorRef}
                      initialHTML={content}
                      onChange={setContent}
                      onSelectionTarget={onSelectionRect}
                      fontSize={defaultFontSize}
                      visualDocx
                    />
                  ) : (
                    <div className="wore-page print-area mx-auto min-h-[60vh] rounded-[3px]">
                      <WoreEditor
                        key={doc.id}
                        editorRef={editorRef}
                        initialHTML={content}
                        onChange={setContent}
                        onSelectionTarget={onSelectionRect}
                        fontSize={defaultFontSize}
                      />
                    </div>
                  )}
                </div>
              )
            ) : doc.format === "docx" ? (
              <DocxPreview loading={docxPreviewLoading} error={docxPreviewError} previewRef={docxPreviewRef} zoom={zoom} />
            ) : (
              <PdfPreview loading={pdfLoading} pages={pdfPages} displayZoom={zoom / pdfRenderScale} />
            )}
            </div>
            )}

            {/* selection chat overlay */}
            <SelectionChat />
            {previewMenu && (
              <PreviewSelectionMenu
                {...previewMenu}
                onClose={() => setPreviewMenu(null)}
                onCopy={async () => {
                  await navigator.clipboard.writeText(previewMenu.text);
                  toast.success("Copied selection");
                }}
                onAsk={() => {
                  setSelection({ range: previewMenu.range, rect: previewMenu.range.getBoundingClientRect(), text: previewMenu.text, readOnly: true });
                }}
                onReference={() => {
                  addChatReference(previewMenu.text);
                  toast.success("Selection attached to chat");
                }}
              />
            )}
          </main>

          {/* AI side panel */}
          {panelOpen && (
            <aside className="no-print hidden w-[380px] shrink-0 border-l border-border md:flex md:flex-col">
              <AIPanel reference={panelReference} />
            </aside>
          )}
        </div>

        {/* status bar */}
        <footer className="no-print flex h-8 shrink-0 items-center gap-3 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
          <span>{words} words</span>
          <span>·</span>
          <span>{chars} chars</span>
          <span>·</span>
          <span>{mins} min read</span>
          {doc.format === "pdf" && (
            <>
              <span>·</span>
              <button
                onClick={convertPdfToDocx}
                className="flex items-center gap-1 text-accent-strong transition-colors hover:text-accent"
              >
                <Wand2 className="size-3" /> Convert to Word
              </button>
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            {profileReady ? (
              <span className="flex items-center gap-1">
                <Sparkles className="size-3 text-accent-strong" /> {profile!.name}
              </span>
            ) : (
              <button className="text-destructive" onClick={() => setSettingsOpen(true)}>
                {profile ? `${profile.name} — add API key` : "No profile — configure"}
              </button>
            )}
            <span>·</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)))}>
                <Minimize2 className="size-3" />
              </Button>
              <button
                className="w-10 text-center tabular-nums hover:text-foreground"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}>
                <Maximize2 className="size-3" />
              </Button>
            </div>
            <span>·</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setPanelOpen((o) => !o)}
              title={panelOpen ? "Hide assistant" : "Show assistant"}
            >
              {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </Button>
          </div>
        </footer>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      <NewDocumentDialog open={newOpen} onOpenChange={setNewOpen} onCreate={createNewDocument} />
      <ImageGenDialog open={imageOpen} onOpenChange={setImageOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <PdfEditNoticeDialog
        open={pdfNoticeOpen}
        dontShow={pdfNoticeDontShow}
        snooze={pdfNoticeSnooze}
        onDontShowChange={setPdfNoticeDontShow}
        onSnoozeChange={setPdfNoticeSnooze}
        onUnderstand={acknowledgePdfEditNotice}
      />
    </EditorContext.Provider>
  );
}

function NewDocumentDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (title: string, format: "md" | "docx") => void;
}) {
  const [newTitle, setNewTitle] = useState("Untitled");
  const [format, setFormat] = useState<"md" | "docx">("docx");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create a new document</DialogTitle>
          <DialogDescription>Pick a format and give it a name.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onCreate(newTitle || "Untitled", format)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as "md" | "docx")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="docx">Word (.docx)</SelectItem>
                <SelectItem value="md">Markdown (.md)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onCreate(newTitle || "Untitled", format)}>
            <FilePlus2 /> Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PdfEditNoticeDialog({
  open,
  dontShow,
  snooze,
  onDontShowChange,
  onSnoozeChange,
  onUnderstand,
}: {
  open: boolean;
  dontShow: boolean;
  snooze: PdfNoticeSnooze;
  onDontShowChange: (v: boolean) => void;
  onSnoozeChange: (v: PdfNoticeSnooze) => void;
  onUnderstand: () => void;
}) {
  return (
    <Dialog open={open}>
      <DialogContent
        showClose={false}
        className="max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="mb-1 grid size-11 place-items-center rounded-xl bg-destructive/10 text-destructive">
            <FileText className="size-5" />
          </div>
          <DialogTitle>Editing PDFs is not possible</DialogTitle>
          <DialogDescription>
            PDFs are read-only in WoRe. You can preview them, use them as a reference, or convert a PDF to Word if you need an editable copy.
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => onDontShowChange(e.target.checked)}
            className="mt-0.5 size-4 rounded border-border"
          />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Don’t show this notice again</div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span>for</span>
              <select
                value={snooze}
                disabled={!dontShow}
                onChange={(e) => onSnoozeChange(e.target.value as PdfNoticeSnooze)}
                className="h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground disabled:opacity-50"
              >
                {(Object.keys(PDF_NOTICE_SNOOZE_MS) as PdfNoticeSnooze[]).map((k) => (
                  <option key={k} value={k}>{PDF_NOTICE_SNOOZE_LABELS[k]}</option>
                ))}
              </select>
            </div>
          </div>
        </label>

        <DialogFooter>
          <Button variant="accent" onClick={onUnderstand} autoFocus>
            I understand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function collectDocumentImages(roots: HTMLElement[]): Promise<DocumentImage[]> {
  const seen = new Set<string>();
  const imgs: HTMLImageElement[] = [];
  for (const root of roots) {
    root.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      const src = img.currentSrc || img.src || img.getAttribute("src") || "";
      if (!src || seen.has(src)) return;
      seen.add(src);
      imgs.push(img);
    });
  }

  const out: DocumentImage[] = [];
  for (const img of imgs.slice(0, 8)) {
    const dataUrl = await imageElementToVisionUrl(img).catch(() => null);
    if (!dataUrl) continue;
    const figure = img.closest("figure");
    const caption = figure?.querySelector("figcaption")?.textContent?.trim() || undefined;
    const alt = img.alt || img.getAttribute("aria-label") || caption || `Document image ${out.length + 1}`;
    out.push({
      type: "image",
      index: out.length + 1,
      dataUrl,
      mimeType: mimeFromDataUrl(dataUrl),
      alt,
      caption,
    });
  }
  return out;
}

async function imageElementToVisionUrl(img: HTMLImageElement): Promise<string | null> {
  const src = img.currentSrc || img.src || img.getAttribute("src") || "";
  if (!src) return null;

  // Remote URLs are valid for OpenAI-compatible vision APIs. If the canvas
  // cannot read them due to CORS, return the URL and let the provider fetch it.
  const fallback = /^https?:\/\//i.test(src) || /^data:image\//i.test(src) ? src : null;

  try {
    if (!img.complete) await img.decode();
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return fallback;
    const max = 1280;
    const scale = Math.min(1, max / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return fallback;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return fallback;
  }
}

function mimeFromDataUrl(url: string) {
  return /^data:([^;,]+)/i.exec(url)?.[1] ?? undefined;
}

function DocumentTabs({
  tabs,
  activeId,
  onOpen,
  onClose,
}: {
  tabs: Array<{ id: string; title: string; format: StoredDoc["format"] }>;
  activeId: string;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (!tabs.length) return null;
  return (
    <div className="no-print flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card/60 px-2">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "group flex max-w-[220px] items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
            tab.id === activeId ? "border-border bg-background text-foreground" : "border-transparent text-muted-foreground hover:bg-muted"
          )}
        >
          <button className="min-w-0 flex-1 truncate text-left" onClick={() => onOpen(tab.id)} title={tab.title}>
            {tab.title || "Untitled"}
          </button>
          <span className="text-[9px] uppercase opacity-60">{tab.format}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
            className="rounded p-0.5 opacity-0 hover:bg-muted-foreground/10 group-hover:opacity-100"
            title="Close tab"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ReadOnlyHtmlPreview({ html }: { html: string }) {
  return (
    <div className="min-w-0 overflow-auto px-4 py-8 sm:px-6 sm:py-10">
      <div className="wore-page mx-auto min-h-[60vh] rounded-[3px] p-12">
        <div className="wore-editor pointer-events-none" dangerouslySetInnerHTML={{ __html: html || "<p><br></p>" }} />
      </div>
    </div>
  );
}

function PreviewSelectionMenu({
  x,
  y,
  text,
  onCopy,
  onAsk,
  onReference,
  onClose,
}: {
  x: number;
  y: number;
  text: string;
  range: Range;
  onCopy: () => void;
  onAsk: () => void;
  onReference: () => void;
  onClose: () => void;
}) {
  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-40";
  return createPortal(
    <div
      className="fixed z-[120] w-[230px] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      <button className={item} disabled={!text} onClick={() => { onCopy(); onClose(); }}>
        <Copy className="size-3.5" /> Copy
      </button>
      <button className={item} disabled={!text} onClick={() => { onAsk(); onClose(); }}>
        <Sparkles className="size-3.5" /> Ask AI about selection
      </button>
      <button className={item} disabled={!text} onClick={() => { onReference(); onClose(); }}>
        <MessageSquarePlus className="size-3.5" /> Add to chat context
      </button>
    </div>,
    document.body
  );
}

function matchesKeybinding(e: KeyboardEvent, combo?: string) {
  if (!combo) return false;
  const parts = combo.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.find((p) => !["ctrl", "cmd", "meta", "shift", "alt", "option"].includes(p));
  const ctrl = parts.includes("ctrl") || parts.includes("cmd") || parts.includes("meta");
  const alt = parts.includes("alt") || parts.includes("option");
  const shift = parts.includes("shift");
  if (!!ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (!!alt !== e.altKey) return false;
  if (!!shift !== e.shiftKey) return false;
  if (!key) return false;
  const pressed = e.key === " " ? "space" : e.key.toLowerCase();
  return pressed === key || (key === "\\" && e.key === "\\");
}

function isTextInput(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function FormatChip({ format }: { format: StoredDoc["format"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    md: { label: "MD", cls: "text-info" },
    docx: { label: "DOCX", cls: "text-accent-strong" },
    pdf: { label: "PDF", cls: "text-destructive" },
    html: { label: "HTML", cls: "text-success" },
    txt: { label: "TXT", cls: "" },
  };
  const m = map[format] ?? map.txt;
  return <Badge variant="outline" className={cn("uppercase", m.cls)}>{m.label}</Badge>;
}

function ViewToggle({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Eye;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
        active ? "bg-accent text-white" : "text-muted-foreground hover:bg-muted"
      )}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  );
}

function DocxPreview({
  loading,
  error,
  previewRef,
  zoom,
}: {
  loading: boolean;
  error: string | null;
  previewRef: RefObject<HTMLDivElement | null>;
  zoom: number;
}) {
  return (
    <div className="min-h-full overflow-auto bg-canvas px-4 py-8 sm:px-8 sm:py-10" style={{ zoom }}>
      {loading && (
        <div className="mx-auto mt-20 flex max-w-md flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="size-6 animate-spin text-accent-strong" />
          <span className="text-sm">Rendering Word preview…</span>
        </div>
      )}
      {error && (
        <div className="wore-page mx-auto max-w-xl rounded-md p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Word preview unavailable</p>
          <p className="mt-1">{error}</p>
        </div>
      )}
      <div ref={previewRef} className="wore-docx-preview mx-auto" />
    </div>
  );
}

function PdfPreview({
  loading,
  pages,
  displayZoom,
}: {
  loading: boolean;
  pages: RenderedPage[] | null;
  displayZoom: number;
}) {
  return (
    <div className="grid min-h-full place-items-start justify-center gap-6 px-4 py-10" style={{ zoom: displayZoom }}>
      {loading && (
        <div className="mt-20 flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="size-6 animate-spin text-accent-strong" />
          <span className="text-sm">Rendering PDF…</span>
        </div>
      )}
      {pages?.map((p, i) => (
        <div
          key={i}
          className="wore-page overflow-hidden rounded-[2px]"
          style={{ width: p.width }}
        >
          <img src={p.dataUrl} alt={`Page ${i + 1}`} className="block w-full" />
        </div>
      ))}
      {!loading && pages && pages.length === 0 && (
        <p className="mt-20 text-sm text-muted-foreground">No pages to display.</p>
      )}
    </div>
  );
}
