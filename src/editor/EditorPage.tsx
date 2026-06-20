import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CloudOff,
  Columns2,
  Copy,
  Download,
  FileDown,
  FileText,
  FileType2,
  Eye,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Redo2,
  Settings2,
  Sparkles,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsDialog } from "@/components/SettingsDialog";
import { AIPicker } from "@/components/AIPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStore, countWords } from "@/lib/store";
import type { RecentDoc } from "@/lib/store";
import {
  loadDoc,
  saveDoc,
  getSourceBytes,
  exportDoc,
  exportPdfToDocx,
} from "@/lib/documents/manager";
import type { StoredDoc } from "@/lib/documents/manager";
import { renderPdfPages, type RenderedPage } from "@/lib/documents/pdf";
import { undo, redo } from "@/lib/editor";
import { htmlToPlainText, nodeToPlainText, wordCount, readingTimeMin, charCount } from "@/lib/documents/html";
import { docxToHtml, docxToText } from "@/lib/documents/docx";
import { downloadBlob, cn } from "@/lib/utils";
import { renderAsync as renderDocxPreview } from "docx-preview";

import { EditorContext, type DocumentImage, type SelectionTarget } from "./context";
import { WoreEditor, useFormats } from "./WoreEditor";
import { Toolbar } from "./Toolbar";
import { SelectionChat } from "./SelectionChat";
import { AIPanel } from "./AIPanel";
import { ImageGenDialog } from "./ImageGenDialog";

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
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const formats = useFormats(editorRef);
  const [selection, setSelection] = useState<SelectionTarget | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelQuestion, setPanelQuestion] = useState<{ q: string; n: number } | null>(null);
  const [panelReference, setPanelReference] = useState<{ text: string; n: number } | null>(null);
  const [previewMenu, setPreviewMenu] = useState<{ x: number; y: number; text: string; range: Range } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [pdfPages, setPdfPages] = useState<RenderedPage[] | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [docxPreviewLoading, setDocxPreviewLoading] = useState(false);
  const [docxPreviewError, setDocxPreviewError] = useState<string | null>(null);
  const [sourceTextContext, setSourceTextContext] = useState("");
  const [stats, setStats] = useState({ words: 0, chars: 0, mins: 1 });
  const docxPreviewRef = useRef<HTMLDivElement>(null);

  /* ----------------------------- load document ---------------------------- */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const d = id ? await loadDoc(id) : undefined;
      if (cancelled) return;
      if (!d) {
        setLoading(false);
        return;
      }
      let loaded = d;
      let docxHasSource = false;
      if (d.format === "docx") {
        const bytes = await getSourceBytes(d.id);
        docxHasSource = !!bytes;
        if (bytes && !d.contentHtml.includes("wore-docx-import") && !cancelled) {
          const visualHtml = await docxToHtml(bytes.slice(0)).catch(() => "");
          if (visualHtml) {
            loaded = { ...d, contentHtml: visualHtml, updatedAt: Date.now() };
            await saveDoc(loaded);
          }
        }
      }
      if (cancelled) return;
      setDoc(loaded);
      setContent(loaded.contentHtml);
      setTitle(loaded.title);
      setSourceTextContext("");
      // Word preview needs the original bytes; a freshly created DOCX has none,
      // so default it to edit mode instead of an empty "preview unavailable".
      setView(loaded.format === "docx" && docxHasSource ? "preview" : "edit");
      addTab(d.id);
      touchRecent(d.id);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, touchRecent, addTab]);

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
      const pages = await renderPdfPages(bytes, 1.3);
      if (!cancelled) {
        setPdfPages(pages);
        setPdfLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, doc]);

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
  useEffect(() => {
    const shouldRenderDocxPreview = doc?.format === "docx" && (view === "preview" || splitView);
    if (!shouldRenderDocxPreview) {
      setDocxPreviewLoading(false);
      setDocxPreviewError(null);
      return;
    }
    let cancelled = false;
    const container = docxPreviewRef.current;
    if (!container) return;
    container.innerHTML = "";
    setDocxPreviewLoading(true);
    setDocxPreviewError(null);
    (async () => {
      const bytes = await getSourceBytes(doc.id);
      if (!bytes) throw new Error("Original DOCX bytes are missing. Re-import this file to enable exact Word preview.");
      if (cancelled) return;
      container.innerHTML = "";
      const styleHost = document.createElement("div");
      styleHost.className = "wore-docx-style-host";
      styleHost.setAttribute("aria-hidden", "true");
      const bodyHost = document.createElement("div");
      bodyHost.className = "wore-docx-body-host";
      container.append(styleHost, bodyHost);
      await renderDocxPreview(bytes.slice(0), bodyHost, styleHost, {
        className: "wore-docx",
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        experimental: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        renderComments: true,
        renderAltChunks: true,
        renderChanges: true,
        ignoreLastRenderedPageBreak: false,
        useBase64URL: true,
      });
      if (!cancelled) {
        const text = nodeToPlainText(bodyHost);
        setStats({ words: wordCount(text), chars: text.length, mins: Math.max(1, Math.round(wordCount(text) / 200)) });
      }
    })()
      .catch((e) => {
        if (!cancelled) setDocxPreviewError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setDocxPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, doc, splitView]);

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
  const askAssistant = useCallback(
    (q: string) => {
      setPanelOpen(true);
      setPanelQuestion({ q, n: Date.now() });
    },
    []
  );

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
    if (doc?.format === "docx") {
      if (sourceTextContext.trim()) return sourceTextContext.trim();
      const previewText = docxPreviewRef.current ? nodeToPlainText(docxPreviewRef.current) : "";
      if (previewText) return previewText;
    }
    return htmlToPlainText(editorRef.current?.innerHTML ?? content);
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
      askAssistant,
      addChatReference,
      doc,
      content,
      setContent,
      profile,
      busy: false,
    }),
    [getHTML, getDocumentText, getDocumentImages, setHTML, focus, sync, formats, selection, openSelectionChat, closeSelectionChat, askAssistant, addChatReference, doc, content, profile]
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
  if (loading) {
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

  return (
    <EditorContext.Provider value={ctxValue}>
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* top bar */}
        <header className="no-print flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 backdrop-blur">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")} title="Back">
            <ArrowLeft />
          </Button>
          <Brand size={26} withText={false} />

          <FormatChip format={doc.format} />

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="ml-1 h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 font-display text-base font-semibold outline-none hover:bg-muted focus:bg-muted"
            placeholder="Untitled"
          />

          <div className="hidden items-center gap-0.5 sm:flex">
            <Button variant="ghost" size="icon-sm" onClick={() => runEditorHistory(undo)} disabled={view !== "edit"} title="Undo">
              <Undo2 className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => runEditorHistory(redo)} disabled={view !== "edit"} title="Redo">
              <Redo2 className="size-3.5" />
            </Button>
          </div>

          {/* save status */}
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            {saving ? (
              <>
                <Loader2 className="size-3 animate-spin" /> Saving…
              </>
            ) : savedAt ? (
              <>
                <Check className="size-3 text-success" /> Saved
              </>
            ) : (
              <>
                <CloudOff className="size-3" /> Not saved
              </>
            )}
          </span>

          {(doc.format === "pdf" || doc.format === "docx") && (
            <div className="flex items-center rounded-md border border-border p-0.5">
              <ViewToggle active={view === "edit"} onClick={() => setView("edit")} icon={Pencil} label="Edit" />
              <ViewToggle active={view === "preview"} onClick={() => setView("preview")} icon={Eye} label={doc.format === "docx" ? "Word" : "PDF"} />
            </div>
          )}

          {/* export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download /> Export <ChevronDown className="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Download as</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => exportAs("pdf-print")}>
                <FileText className="text-destructive" /> PDF <span className="ml-auto text-[10px] text-muted-foreground">print</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAs("docx")}>
                <FileType2 className="text-accent-strong" /> Word (.docx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAs("md")}>
                <FileDown /> Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAs("html")}>HTML (.html)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAs("txt")}>Plain text (.txt)</DropdownMenuItem>
              {doc.format === "pdf" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={convertPdfToDocx} className="text-accent-strong">
                    <Wand2 /> Convert PDF → DOCX
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant={splitView ? "subtle" : "ghost"}
            size="icon"
            onClick={() => setSplitView(!splitView)}
            title={`Split view (${keybindings.splitView})`}
          >
            <Columns2 />
          </Button>

          <AIPicker onOpenSettings={() => setSettingsOpen(true)} />

          <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} title="Settings">
            <Settings2 />
          </Button>
          <ThemeToggle />
        </header>

        <DocumentTabs
          tabs={tabDocs}
          activeId={doc.id}
          onOpen={(tabId) => navigate(`/editor/${tabId}`)}
          onClose={(tabId) => {
            removeTab(tabId);
            if (tabId === doc.id) {
              const next = tabDocs.find((t) => t.id !== tabId);
              navigate(next ? `/editor/${next.id}` : "/");
            }
          }}
        />

        {/* toolbar (edit view only) */}
        {view === "edit" && <Toolbar onGenerateImage={() => setImageOpen(true)} />}

        {/* body */}
        <div className="flex min-h-0 flex-1">
          <main className="print-area relative min-w-0 flex-1 overflow-auto bg-canvas">
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
              <PdfPreview loading={pdfLoading} pages={pdfPages} zoom={zoom} />
            )}

            {/* floating "convert" hint on pdf preview */}
            {view === "preview" && doc.format === "pdf" && (
              <Button
                variant="accent"
                className="no-print fixed bottom-6 right-6 shadow-xl"
                onClick={convertPdfToDocx}
              >
                <Wand2 /> Convert to Word
              </Button>
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
              <AIPanel question={panelQuestion?.q ?? null} reference={panelReference} />
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

      <ImageGenDialog open={imageOpen} onOpenChange={setImageOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </EditorContext.Provider>
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
      {!loading && !error && (
        <p className="no-print mx-auto mb-3 max-w-[820px] text-center text-[11px] text-muted-foreground">
          High-fidelity render of the original import. Edits made in Edit mode appear in exports, not here.
        </p>
      )}
      <div ref={previewRef} className="wore-docx-preview mx-auto" />
    </div>
  );
}

function PdfPreview({
  loading,
  pages,
  zoom,
}: {
  loading: boolean;
  pages: RenderedPage[] | null;
  zoom: number;
}) {
  return (
    <div className="grid min-h-full place-items-start justify-center gap-6 px-4 py-10" style={{ zoom }}>
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
