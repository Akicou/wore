import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2, NotebookPen, X } from "lucide-react";
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from "@aiden0z/pptx-renderer";
import { getSourceBytes } from "@/lib/documents/manager";
import { loadPptxSlides, parsePptx, savePptxSlides } from "@/lib/documents/pptx";
import type { ParsedPptx } from "@/lib/documents/pptx";
import { cn } from "@/lib/utils";

export function PresentWindow() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [parsed, setParsed] = useState<ParsedPptx | null>(null);
  const [sourceBytes, setSourceBytes] = useState<ArrayBuffer | null>(null);
  const [index, setIndex] = useState(() => {
    const s = Number(searchParams.get("slide") || "0");
    return Number.isFinite(s) ? s : 0;
  });
  const [loaded, setLoaded] = useState(false);
  const [opening, setOpening] = useState(false);
  const [notesVisible, setNotesVisible] = useState(false);
  const [slideCount, setSlideCount] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PptxViewer | null>(null);
  // Source of truth for the last valid slide index. Derived from the renderer's
  // actual slide count (what's on screen), with the parsed list as fallback.
  const maxIndexRef = useRef(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const bytes = await getSourceBytes(id);
      let slides = await loadPptxSlides(id);
      if (!slides && bytes) {
        slides = await parsePptx(bytes.slice(0));
        await savePptxSlides(id, slides);
      }
      if (cancelled) return;
      if (slides) setParsed(slides);
      if (bytes) setSourceBytes(bytes.slice(0));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Keep maxIndexRef in sync — never let it sit at 0 once we know the count.
  useEffect(() => {
    const count = slideCount || parsed?.slides.length || 1;
    maxIndexRef.current = Math.max(0, count - 1);
  }, [slideCount, parsed?.slides.length]);

  // Try to auto-fullscreen on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const win = getCurrentWebviewWindow();
        if (!cancelled) await win.setFullscreen(true);
      } catch {
        // Dev browser or Tauri unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Eager PPTX rendering. We deliberately do NOT use lazySlides here: in a
  // presenter, every slide must already be parsed so goToSlide() is an
  // instant DOM swap. Lazy parsing makes navigation async and can drop a
  // slide change when the next slide isn't parsed yet — the screen then
  // "sticks" on the current slide even though the index advanced.
  useEffect(() => {
    const container = stageRef.current;
    if (!sourceBytes || !container) return;

    let cancelled = false;
    container.innerHTML = "";
    viewerRef.current?.destroy();
    viewerRef.current = null;
    setOpening(true);

    const viewer = new PptxViewer(container, {
      fitMode: "contain",
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      onSlideError: (_idx, error) => console.error("PPTX slide render failed", error),
      onNodeError: (_nodeId, error) => console.warn("PPTX node render failed", error),
    });
    viewerRef.current = viewer;

    viewer
      .open(sourceBytes.slice(0), { renderMode: "slide" })
      .then(async () => {
        if (cancelled) return;
        const count = viewer.slideCount;
        if (count) {
          setSlideCount(count);
          maxIndexRef.current = Math.max(0, count - 1);
        }
        await viewer.goToSlide(index, { behavior: "auto", block: "nearest" });
        if (!cancelled) setOpening(false);
      })
      .catch((error) => {
        console.error("Could not render PPTX", error);
        if (!cancelled) setOpening(false);
      });

    return () => {
      cancelled = true;
      viewer.destroy();
      if (viewerRef.current === viewer) viewerRef.current = null;
    };
  }, [sourceBytes]);

  // Robust navigation pump. Whenever the index changes, drive the renderer
  // to that slide and reconcile if it didn't land (the renderer can ignore a
  // call when busy). We only keep one pump running; it always chases the
  // latest target via targetRef so rapid clicks never get lost.
  const targetRef = useRef(index);
  targetRef.current = index;
  const pumpingRef = useRef(false);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;

    const pump = async () => {
      if (pumpingRef.current) return; // the running pump will catch the new target
      pumpingRef.current = true;
      try {
        let guard = 0;
        while (!cancelled && guard < 8) {
          const target = targetRef.current;
          if (viewer.currentSlideIndex === target) break;
          await viewer.goToSlide(target, { behavior: "auto", block: "nearest" });
          guard++;
          // give the renderer a frame to settle before re-checking
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
      } catch (e) {
        console.warn("goToSlide failed", e);
      } finally {
        pumpingRef.current = false;
      }
    };
    pump();

    // Mirror navigation to the control window so notes/stage stay in sync.
    if (id) {
      import("@tauri-apps/api/event")
        .then(({ emitTo }) => emitTo("main", "wore:pptx-slide-change", { id, index }))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [id, index]);

  // Drive this window from the control view.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ index: number }>("wore:pptx-slide", (event) => {
          setIndex(Math.max(0, Math.min(event.payload.index, maxIndexRef.current)));
        })
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setNotesVisible((v) => !v);
        return;
      }
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter" || e.key === "PageDown") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, maxIndexRef.current));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "Backspace") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Home") {
        setIndex(0);
      } else if (e.key === "End") {
        setIndex(maxIndexRef.current);
      } else if (e.key === "Escape") {
        (async () => {
          try {
            const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
            await getCurrentWebviewWindow().close();
          } catch {
            try {
              await document.exitFullscreen();
            } catch {}
          }
        })();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const currentNotes = parsed?.slides[index]?.notes?.trim();
  const displayCount = slideCount || parsed?.slides.length || 1;
  const atStart = index <= 0;
  const atEnd = index >= maxIndexRef.current;

  if (!loaded) {
    return (
      <div className="grid h-screen w-screen place-items-center bg-black text-white">
        <Loader2 className="size-8 animate-spin" />
      </div>
    );
  }

  if (!sourceBytes) {
    return (
      <div className="grid h-screen w-screen place-items-center bg-black text-white">
        <p className="text-sm text-zinc-400">Presentation source is missing.</p>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen select-none overflow-hidden bg-black">
      <div className="relative h-screen w-screen overflow-hidden bg-black">
        <div ref={stageRef} className="h-full w-full overflow-hidden bg-black" />
        {opening && (
          <div className="absolute inset-0 grid place-items-center bg-black text-white">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="size-8 animate-spin" />
              <span className="text-xs text-white/60">Loading presentation…</span>
            </div>
          </div>
        )}
      </div>

      {/* Click-to-advance overlay. Sits above the rendered slide so its
          interactive HTML/SVG can't swallow the slideshow click.
          Left-click = next, right-click = previous. */}
      <div
        className="absolute inset-0 z-20"
        onClick={() => setIndex((i) => Math.min(i + 1, maxIndexRef.current))}
        onContextMenu={(e) => {
          e.preventDefault();
          setIndex((i) => Math.max(0, i - 1));
        }}
      />

      {/* Always-visible navigation — guaranteed clickable even if the overlay
          or renderer hiccups. */}
      <div className="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/70 p-1 backdrop-blur">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIndex((i) => Math.max(0, i - 1));
          }}
          disabled={atStart}
          className="grid size-8 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
          title="Previous (←)"
        >
          <ChevronLeft className="size-5" />
        </button>
        <span className="min-w-[64px] text-center text-xs font-medium tabular-nums text-white">
          {index + 1} / {displayCount}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIndex((i) => Math.min(i + 1, maxIndexRef.current));
          }}
          disabled={atEnd}
          className="grid size-8 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
          title="Next (→)"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {/* Notes toggle */}
      <div className="absolute bottom-4 right-4 z-40">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setNotesVisible((v) => !v);
          }}
          className={cn(
            "grid size-8 place-items-center rounded-full backdrop-blur transition-colors",
            notesVisible ? "bg-accent text-white" : "bg-black/60 text-white/70 hover:text-white"
          )}
          title="Toggle notes (Ctrl+T)"
        >
          <NotebookPen className="size-4" />
        </button>
      </div>

      {notesVisible && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-30 flex justify-center px-4">
          <div
            className="pointer-events-auto relative w-full max-w-3xl rounded-xl border border-white/15 bg-black/85 px-5 py-4 text-white shadow-2xl backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-white/50">
                <NotebookPen className="size-3.5" /> Speaker notes · Slide {index + 1}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setNotesVisible(false);
                }}
                className="grid size-6 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                title="Hide notes (Ctrl+T)"
              >
                <X className="size-3.5" />
              </button>
            </div>
            {currentNotes ? (
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-white/90">
                {currentNotes}
              </p>
            ) : (
              <p className="text-sm italic text-white/50">No notes for this slide.</p>
            )}
            <div className="mt-2 text-[10px] text-white/35">Ctrl+T to hide · ← → to navigate</div>
          </div>
        </div>
      )}
    </div>
  );
}
