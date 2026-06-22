import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Monitor,
  NotebookPen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Presentation as PresentationIcon,
  Settings2,
  Sparkles,
} from "lucide-react";
import { PptxViewer, RECOMMENDED_ZIP_LIMITS, type SlideHandle } from "@aiden0z/pptx-renderer";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStore } from "@/lib/store";
import { getSourceBytes, loadDoc } from "@/lib/documents/manager";
import { loadPptxSlides, savePptxSlides } from "@/lib/documents/pptx";
import type { ParsedPptx, PptxSlide } from "@/lib/documents/pptx";
import { htmlToPlainText } from "@/lib/documents/html";
import { Brand } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsDialog } from "@/components/SettingsDialog";
import { AIPicker } from "@/components/AIPicker";
import { PresentationAIPanel } from "./PresentationAIPanel";
import { cn } from "@/lib/utils";

interface MonitorInfo {
  name: string;
  index: number;
}

export function PresentationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const profiles = useStore((s) => s.profiles);
  const activeProfileId = useStore((s) => s.activeProfileId);
  const touchRecent = useStore((s) => s.touchRecent);
  const profile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  const [parsed, setParsed] = useState<ParsedPptx | null>(null);
  const [sourceBytes, setSourceBytes] = useState<ArrayBuffer | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [title, setTitle] = useState("Presentation");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [rightTab, setRightTab] = useState<"notes" | "assistant">("notes");
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [viewerVersion, setViewerVersion] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const thumbnailsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PptxViewer | null>(null);

  const getPresentationText = useCallback(() => {
    if (!parsed) return "";
    return parsed.slides
      .map((s, i) => {
        const text = htmlToPlainText(s.html);
        const notes = s.notes?.trim();
        return `Slide ${i + 1} — ${s.title}\n${text}${notes ? `\nSpeaker notes: ${notes}` : ""}`;
      })
      .join("\n\n");
  }, [parsed]);

  const getCurrentSlideContext = useCallback(() => {
    const slide = parsed?.slides[currentIndex];
    if (!slide) return "";
    const text = htmlToPlainText(slide.html);
    const notes = slide.notes?.trim();
    return `${slide.title}\n${text}${notes ? `\nExisting speaker notes: ${notes}` : ""}`;
  }, [parsed, currentIndex]);

  // Load document + parsed notes/title + source bytes.
  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setNotFound(false);
      setLoadError(null);
      try {
        const doc = await loadDoc(id);
        if (cancelled) return;
        if (!doc || doc.format !== "pptx") {
          setNotFound(true);
          return;
        }

        const bytes = await getSourceBytes(id);
        let parsedData = await loadPptxSlides(id);
        if (!parsedData && bytes) {
          const { parsePptx } = await import("@/lib/documents/pptx");
          parsedData = await parsePptx(bytes.slice(0));
          await savePptxSlides(id, parsedData);
        }

        if (cancelled) return;
        if (parsedData && bytes) {
          setParsed(parsedData);
          setSourceBytes(bytes.slice(0));
          setDocId(id);
          setTitle(parsedData.title || doc.title || "Presentation");
          touchRecent(id);
        } else {
          setLoadError("Presentation source bytes or slide metadata are missing. Re-import the file.");
        }
      } catch (error) {
        console.error("Could not open presentation", error);
        if (!cancelled) setLoadError((error as Error).message || "Could not open presentation.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, touchRecent]);

  // Real PPTX renderer on the main stage.
  useEffect(() => {
    const container = stageRef.current;
    if (!sourceBytes || !container) return;

    let cancelled = false;
    container.innerHTML = "";
    viewerRef.current?.destroy();
    viewerRef.current = null;
    setRendering(true);

    const viewer = new PptxViewer(container, {
      fitMode: "contain",
      lazySlides: true,
      lazyMedia: true,
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      onRenderStart: () => setRendering(true),
      onRenderComplete: () => setRendering(false),
      onSlideError: (_index, error) => console.error("PPTX slide render failed", error),
      onNodeError: (_nodeId, error) => console.warn("PPTX node render failed", error),
    });
    viewerRef.current = viewer;

    viewer
      .open(sourceBytes.slice(0), { renderMode: "slide", lazySlides: true, lazyMedia: true })
      .then(async () => {
        if (cancelled) return;
        await viewer.goToSlide(currentIndex, { behavior: "auto", block: "nearest" });
        setViewerVersion((v) => v + 1);
      })
      .catch((error) => {
        console.error("Could not render PPTX", error);
        if (!cancelled) setRendering(false);
      });

    return () => {
      cancelled = true;
      viewer.destroy();
      if (viewerRef.current === viewer) viewerRef.current = null;
    };
  }, [sourceBytes]);

  // Keep renderer slide in sync with controls + push to fullscreen window.
  useEffect(() => {
    viewerRef.current?.goToSlide(currentIndex, { behavior: "auto", block: "nearest" }).catch((error) => {
      console.warn("Could not switch PPTX slide", error);
    });
    if (!id) return;
    import("@tauri-apps/api/event")
      .then(({ emitTo }) => emitTo(`present-${id}`, "wore:pptx-slide", { index: currentIndex }))
      .catch(() => {});
  }, [id, currentIndex, viewerVersion]);

  // Let the fullscreen window drive the notes/control view.
  useEffect(() => {
    if (!id) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ id: string; index: number }>("wore:pptx-slide-change", (event) => {
          if (event.payload.id !== id) return;
          setCurrentIndex(event.payload.index);
        })
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [id]);

  // Load monitors once.
  useEffect(() => {
    (async () => {
      try {
        const win = await import("@tauri-apps/api/window");
        const all = await win.availableMonitors();
        setMonitors(all.map((m, i) => ({ name: m.name || `Monitor ${i + 1}`, index: i })));
      } catch {
        setMonitors([{ name: "Primary", index: 0 }]);
      }
    })();
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        setCurrentIndex((i) => Math.min(i + 1, (parsed?.slides.length || 1) - 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCurrentIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Home") {
        setCurrentIndex(0);
      } else if (e.key === "End") {
        setCurrentIndex(Math.max(0, (parsed?.slides.length || 1) - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [parsed?.slides.length]);

  // Scroll thumbnail into view.
  useEffect(() => {
    if (!thumbnailsRef.current) return;
    const btn = thumbnailsRef.current.querySelector<HTMLButtonElement>(`[data-slide-index="${currentIndex}"]`);
    if (btn) btn.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentIndex]);

  const currentSlide = parsed?.slides[currentIndex];

  const startPresentation = useCallback(async () => {
    if (!id || !parsed) return;
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const { availableMonitors } = await import("@tauri-apps/api/window");

      const label = `present-${id}`;
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) await existing.close();

      const all = await availableMonitors();
      const monitor = all[selectedMonitor] ?? all[0];
      if (!monitor) return;

      const position = monitor.position.toLogical(monitor.scaleFactor);
      const size = monitor.size.toLogical(monitor.scaleFactor);

      new WebviewWindow(label, {
        url: `/#/present/${id}?slide=${currentIndex}`,
        title: parsed.title || "Presentation",
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        fullscreen: true,
      });
    } catch (e) {
      console.error("Failed to open presentation window:", e);
      toastError(e);
    }
  }, [id, parsed, selectedMonitor, currentIndex]);

  const profileReady = !!profile && (!!profile.apiKey || /localhost|127\.0\.0\.1/.test(profile.baseUrl));

  if (loading) {
    return (
      <div className="grid h-screen place-items-center bg-background text-muted-foreground">
        <div className="flex items-center gap-3">
          <PresentationIcon className="size-5 animate-pulse text-accent-strong" />
          <span className="font-display">Opening presentation…</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="grid h-screen place-items-center bg-background text-center">
        <div className="max-w-md">
          <h1 className="font-display text-3xl">Could not open presentation</h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <Button className="mt-4" onClick={() => navigate("/")}>
            <ArrowLeft /> Back to start
          </Button>
        </div>
      </div>
    );
  }

  if (notFound || !parsed) {
    return (
      <div className="grid h-screen place-items-center bg-background text-center">
        <div>
          <h1 className="font-display text-3xl">Presentation not found</h1>
          <p className="mt-2 text-muted-foreground">It may have been removed or is not a supported format.</p>
          <Button className="mt-4" onClick={() => navigate("/")}>
            <ArrowLeft /> Back to start
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* menu bar — matches editor */}
      <header className="no-print relative flex h-9 select-none items-center border-b border-border bg-background px-2">
        <button
          onClick={() => navigate("/")}
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Home"
        >
          <Brand size={18} withText={false} />
        </button>

        <div className="ml-1 flex min-w-0 items-center gap-1.5">
          <PresentationIcon className="size-3.5 text-accent-strong" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-7 min-w-0 max-w-[280px] rounded-md bg-transparent px-2 text-sm font-semibold outline-none transition-colors hover:bg-muted/50 focus:bg-muted/50"
            placeholder="Untitled"
          />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <div className="flex items-center gap-1.5">
            <Monitor className="size-3.5 text-muted-foreground" />
            <Select value={String(selectedMonitor)} onValueChange={(v) => setSelectedMonitor(Number(v))}>
              <SelectTrigger className="h-7 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monitors.map((m) => (
                  <SelectItem key={m.index} value={String(m.index)} className="text-xs">
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button size="sm" variant="ghost" onClick={() => setRightTab("notes")} title="Notes" className={cn("h-7 px-2 text-xs", rightTab === "notes" && panelOpen && "bg-muted text-foreground")}>
            <NotebookPen className="size-3.5" />
          </Button>

          <AIPicker onOpenSettings={() => setSettingsOpen(true)} />

          <Button size="sm" onClick={startPresentation} className="h-7 gap-1.5">
            <Play className="size-3.5" /> Present
          </Button>

          <button
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <Settings2 className="size-4" />
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        {/* thumbnails */}
        <aside className="no-print hidden w-52 shrink-0 flex-col border-r border-border bg-card/40 sm:flex">
          <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Slides · {parsed.slides.length}
          </div>
          <div ref={thumbnailsRef} className="flex-1 overflow-y-auto px-2 py-2">
            <div className="space-y-2">
              {parsed.slides.map((slide, i) => (
                <SlideThumbnail
                  key={slide.index}
                  slide={slide}
                  index={i}
                  active={i === currentIndex}
                  viewer={viewerRef.current}
                  viewerVersion={viewerVersion}
                  onClick={() => setCurrentIndex(i)}
                />
              ))}
            </div>
          </div>
        </aside>

        {/* stage */}
        <main className="relative min-w-0 flex-1 overflow-hidden bg-canvas">
          <div className="flex h-full items-center justify-center overflow-auto p-8">
            <div className="relative aspect-video w-full max-w-5xl overflow-hidden rounded-md bg-white shadow-2xl">
              <div ref={stageRef} className="h-full w-full overflow-hidden bg-white" />
              {rendering && (
                <div className="absolute inset-0 grid place-items-center bg-white/75 text-muted-foreground backdrop-blur-sm">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="size-4 animate-spin text-accent-strong" /> Rendering slide…
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* floating slide nav — bottom center, over the canvas */}
          <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/90 px-2 py-1 shadow-lg backdrop-blur">
            <button
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
              className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-[64px] text-center text-xs font-medium tabular-nums">
              {currentIndex + 1} / {parsed.slides.length}
            </span>
            <button
              onClick={() => setCurrentIndex((i) => Math.min(parsed.slides.length - 1, i + 1))}
              disabled={currentIndex >= parsed.slides.length - 1}
              className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </main>

        {/* right panel: Notes + Assistant */}
        {panelOpen && (
          <aside className="no-print hidden w-[380px] shrink-0 flex-col border-l border-border bg-card md:flex">
            <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as "notes" | "assistant")} className="flex h-full flex-col">
              <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
                <TabsList className="h-8">
                  <TabsTrigger value="notes" className="text-xs">
                    <NotebookPen className="size-3.5" /> Notes
                  </TabsTrigger>
                  <TabsTrigger value="assistant" className="text-xs">
                    <Sparkles className="size-3.5" /> Assistant
                  </TabsTrigger>
                </TabsList>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  onClick={() => setPanelOpen(false)}
                  title="Hide panel"
                >
                  <PanelRightClose className="size-3.5" />
                </Button>
              </div>

              <TabsContent value="notes" className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    <span>Speaker notes</span>
                    <span>Slide {currentIndex + 1}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 py-3">
                    {currentSlide?.notes ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{currentSlide.notes}</p>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        <p className="italic">No notes for this slide.</p>
                        <p className="mt-3 text-xs">Tip: switch to the Assistant tab and use “Draft notes” to generate speaker notes with AI.</p>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="assistant" className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
                {docId && (
                  <PresentationAIPanel
                    docId={docId}
                    profile={profile}
                    getPresentationText={getPresentationText}
                    getCurrentSlideContext={getCurrentSlideContext}
                    currentSlideNumber={currentIndex + 1}
                  />
                )}
              </TabsContent>
            </Tabs>
          </aside>
        )}
      </div>

      {/* status bar — matches editor */}
      <footer className="no-print flex h-8 shrink-0 items-center gap-3 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
        <span>{parsed.slides.length} slides</span>
        <span>·</span>
        <span className="tabular-nums">{currentIndex + 1} / {parsed.slides.length}</span>
        <span>·</span>
        <span className="hidden sm:inline">← → to navigate</span>

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
          <Button variant="ghost" size="icon-sm" onClick={() => setPanelOpen((o) => !o)} title={panelOpen ? "Hide panel" : "Show panel"}>
            {panelOpen ? <PanelRightClose className="size-3" /> : <PanelRightOpen className="size-3" />}
          </Button>
        </div>
      </footer>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function SlideThumbnail({
  slide,
  index,
  active,
  viewer,
  viewerVersion,
  onClick,
}: {
  slide: PptxSlide;
  index: number;
  active: boolean;
  viewer: PptxViewer | null;
  viewerVersion: number;
  onClick: () => void;
}) {
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el || !viewer) return;
    el.innerHTML = "";
    let handle: SlideHandle | null = null;
    try {
      handle = viewer.renderThumbnailToContainer(index, el, { width: 176 });
    } catch (error) {
      console.warn("Could not render PPTX thumbnail", error);
    }
    return () => {
      handle?.dispose();
      if (el) el.innerHTML = "";
    };
  }, [viewer, viewerVersion, index]);

  return (
    <button
      data-slide-index={index}
      onClick={onClick}
      className={cn(
        "relative w-full overflow-hidden rounded-md border p-1.5 text-left transition-all",
        active
          ? "border-accent-strong bg-accent/5 ring-1 ring-accent-strong"
          : "border-border bg-background hover:border-foreground/20"
      )}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className={cn("grid size-4 shrink-0 place-items-center rounded text-[9px] font-semibold", active ? "bg-accent-strong text-white" : "bg-muted text-muted-foreground")}>
          {index + 1}
        </span>
        <span className="truncate text-[10px] text-muted-foreground">{slide.title}</span>
      </div>
      <div ref={thumbRef} className="pointer-events-none aspect-video w-full overflow-hidden rounded-sm bg-white ring-1 ring-border/50" />
    </button>
  );
}

function toastError(e: unknown) {
  import("sonner").then(({ toast }) =>
    toast.error("Could not start presentation", { description: (e as Error).message })
  );
}
