import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from "@aiden0z/pptx-renderer";
import { getSourceBytes } from "@/lib/documents/manager";
import { loadPptxSlides, parsePptx, savePptxSlides } from "@/lib/documents/pptx";
import type { ParsedPptx } from "@/lib/documents/pptx";

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
  const [rendering, setRendering] = useState(true);

  const stageRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PptxViewer | null>(null);

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

  // Real PPTX slide rendering.
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
      onSlideError: (_idx, error) => console.error("PPTX slide render failed", error),
      onNodeError: (_nodeId, error) => console.warn("PPTX node render failed", error),
    });
    viewerRef.current = viewer;

    viewer
      .open(sourceBytes.slice(0), { renderMode: "slide", lazySlides: true, lazyMedia: true })
      .then(async () => {
        if (cancelled) return;
        await viewer.goToSlide(index, { behavior: "auto", block: "nearest" });
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

  useEffect(() => {
    viewerRef.current?.goToSlide(index, { behavior: "auto", block: "nearest" }).catch((error) => {
      console.warn("Could not switch PPTX slide", error);
    });
    if (!id) return;
    import("@tauri-apps/api/event")
      .then(({ emitTo }) => emitTo("main", "wore:pptx-slide-change", { id, index }))
      .catch(() => {});
  }, [id, index]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ index: number }>("wore:pptx-slide", (event) => {
          const max = Math.max(0, (parsed?.slides.length || 1) - 1);
          setIndex(Math.max(0, Math.min(event.payload.index, max)));
        })
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [parsed?.slides.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter" || e.key === "PageDown") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, (parsed?.slides.length || 1) - 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "Backspace") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Home") {
        setIndex(0);
      } else if (e.key === "End") {
        setIndex(Math.max(0, (parsed?.slides.length || 1) - 1));
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
  }, [parsed?.slides.length]);

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
    <div
      className="relative flex h-screen w-screen select-none items-center justify-center bg-black p-0"
      onClick={() => setIndex((i) => Math.min(i + 1, (parsed?.slides.length || 1) - 1))}
      onContextMenu={(e) => {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }}
    >
      <div className="relative h-screen w-screen overflow-hidden bg-black">
        <div ref={stageRef} className="h-full w-full overflow-hidden bg-black" />
        {rendering && (
          <div className="absolute inset-0 grid place-items-center bg-black text-white">
            <Loader2 className="size-8 animate-spin" />
          </div>
        )}
      </div>

      <div className="absolute bottom-4 right-4 rounded-full bg-black/60 px-3 py-1 text-xs text-white backdrop-blur">
        {index + 1} / {parsed?.slides.length ?? 1}
      </div>
    </div>
  );
}
