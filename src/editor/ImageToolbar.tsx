import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/form";
import { Slider } from "@/components/ui/slider";
import { cn, clamp } from "@/lib/utils";

interface ImageToolbarProps {
  imageEl: HTMLImageElement;
  onClose: () => void;
  onChange: () => void;
}

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Aspect ratio from the image's natural dimensions (fallback to current box). */
function naturalRatio(img: HTMLImageElement): number {
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  return w / h;
}

export function ImageToolbar({ imageEl, onClose, onChange }: ImageToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  // read current CSS values (empty -> defaults)
  const style = imageEl.style;
  const parseNum = (v: string, def: number) => {
    const n = parseFloat(v);
    return isNaN(n) ? def : n;
  };
  const parsePct = (v: string, def: number) => {
    const n = parseFloat(v);
    return isNaN(n) ? def : n;
  };

  const [opacity, setOpacity] = useState(() => parseNum(style.opacity, 1));
  const [outlineWidth, setOutlineWidth] = useState(() => parseNum(style.outlineWidth, 0));
  const [outlineColor, setOutlineColor] = useState(() => {
    const c = style.outlineColor || parseDefaultOutlineColor(imageEl, style.borderColor);
    return c || "#b06a12";
  });
  const [radius, setRadius] = useState(() => parseNum(style.borderRadius, 8));
  const [widthPct, setWidthPct] = useState(() => parsePct(style.width, 100));

  const apply = useCallback(
    (next: {
      opacity?: number;
      outlineWidth?: number;
      outlineColor?: string;
      radius?: number;
      widthPct?: number;
    }) => {
      const s = imageEl.style;
      if (next.opacity !== undefined) s.opacity = String(next.opacity);
      if (next.outlineWidth !== undefined) {
        s.outlineWidth = `${next.outlineWidth}px`;
        s.outlineStyle = next.outlineWidth > 0 ? "solid" : "none";
        s.outlineOffset = next.outlineWidth > 0 ? "2px" : "0px";
      }
      if (next.outlineColor !== undefined) s.outlineColor = next.outlineColor;
      if (next.radius !== undefined) s.borderRadius = `${next.radius}px`;
      if (next.widthPct !== undefined) {
        // percent width relative to the containing block
        s.width = `${next.widthPct}%`;
        s.height = "auto";
        s.maxWidth = "none";
      }
      onChange();
    },
    [imageEl, onChange]
  );

  // close on click outside (ignores the resize handles, which live in a sibling)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (toolbarRef.current?.contains(t)) return;
      if (t === imageEl) return;
      if (t instanceof Element && t.closest("[data-img-handle]")) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [imageEl, onClose]);

  // Keep the toolbar glued to the image as the editor scrolls/resizes.
  const [, repaint] = useState(0);
  useEffect(() => {
    const tick = () => repaint((n) => n + 1);
    window.addEventListener("scroll", tick, true);
    window.addEventListener("resize", tick);
    const ro = new ResizeObserver(tick);
    ro.observe(imageEl);
    return () => {
      window.removeEventListener("scroll", tick, true);
      window.removeEventListener("resize", tick);
      ro.disconnect();
    };
  }, [imageEl]);

  // The toolbar is `position: fixed`, so coordinates are viewport-relative
  // (never add scrollTop). Clamp into the viewport and flip below the image
  // when there isn't room above, so it can't end up off-frame.
  const rect = imageEl.getBoundingClientRect();
  const TB_W = 224; // w-56
  const TB_H = 230; // approx height
  const GAP = 6;
  const PAD = 8;
  const placeAbove = rect.top - GAP - TB_H >= PAD;
  const left = clamp(rect.left + rect.width / 2, PAD + TB_W / 2, window.innerWidth - PAD - TB_W / 2);
  const top = placeAbove
    ? rect.top - GAP
    : clamp(rect.bottom + GAP, PAD, window.innerHeight - PAD - TB_H);
  const toolbarTransform = placeAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)";

  const deleteImage = () => {
    const parent = imageEl.closest("figure") as HTMLElement | null;
    if (parent && imageEl.closest("figcaption") !== imageEl) {
      parent.remove();
    } else {
      imageEl.remove();
    }
    onChange();
    onClose();
  };

  // --- resize handles -------------------------------------------------------
  // Drag any edge/corner to set the image width (px), keeping aspect ratio.
  // The right/east handle is the natural one; left/west mirrors it.
  const onHandleDragStart = (e: React.PointerEvent, _handle: Handle) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = imageEl.getBoundingClientRect().width || imageEl.width || 100;
    const ratio = naturalRatio(imageEl);
    const host = imageEl.ownerDocument;
    imageEl.style.maxWidth = "none";

    const move = (ev: PointerEvent) => {
      // east-side handles grow with rightward drag, west-side grow with leftward
      const isWest = _handle.includes("w");
      const dx = ev.clientX - startX;
      let next = startWidth + (isWest ? -dx : dx);
      // clamp to sane bounds
      next = Math.max(40, Math.min(next, 4000));
      imageEl.style.width = `${Math.round(next)}px`;
      imageEl.style.height = "auto";
      // keep the slider roughly in sync (width as % of parent)
      const parent = imageEl.parentElement;
      const parentW = parent ? parent.getBoundingClientRect().width || next : next;
      const pct = Math.round((next / parentW) * 100);
      setWidthPct(Math.max(20, Math.min(100, pct)));
      onChange();
    };
    const up = () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
    };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
  };

  const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  return (
    <>
      {/* resize handles overlay (position: fixed, tracks the image on scroll/resize) */}
      <HandleOverlay imageEl={imageEl}>
        {handles.map((h) => (
          <button
            key={h}
            data-img-handle
            aria-label={`Resize image (${h})`}
            onPointerDown={(e) => onHandleDragStart(e, h)}
            className={cn(
              "absolute z-[101] grid size-3 place-items-center rounded-full border-2 border-accent-strong bg-card shadow",
              "cursor-nwse-resize"
            )}
            style={handlePosition(h)}
          >
            <span className="block size-1 rounded-full bg-accent-strong" />
          </button>
        ))}
      </HandleOverlay>

      <div
        ref={toolbarRef}
        className="fixed z-[100] w-56 rounded-xl border border-border bg-popover p-3 shadow-xl"
        style={{ top: `${top}px`, left: `${left}px`, transform: toolbarTransform }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Image</span>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" onClick={deleteImage} className="text-destructive hover:text-destructive" aria-label="Delete image">
              <Trash2 className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} className="text-muted-foreground" aria-label="Close">
              <X className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <Row label="Opacity">
            <Slider
              value={[opacity]}
              min={0.1}
              max={1}
              step={0.05}
              onValueChange={([v]) => {
                setOpacity(v);
                apply({ opacity: v });
              }}
            />
            <span className="w-8 text-right text-[10px] tabular-nums">{Math.round(opacity * 100)}%</span>
          </Row>

          <Row label="Width">
            <Slider
              value={[widthPct]}
              min={20}
              max={100}
              step={5}
              onValueChange={([v]) => {
                setWidthPct(v);
                apply({ widthPct: v });
              }}
            />
            <span className="w-8 text-right text-[10px] tabular-nums">{Math.round(widthPct)}%</span>
          </Row>

          <Row label="Radius">
            <Slider
              value={[radius]}
              min={0}
              max={32}
              step={1}
              onValueChange={([v]) => {
                setRadius(v);
                apply({ radius: v });
              }}
            />
            <span className="w-8 text-right text-[10px] tabular-nums">{radius}px</span>
          </Row>

          <Row label="Outline">
            <Slider
              value={[outlineWidth]}
              min={0}
              max={8}
              step={0.5}
              onValueChange={([v]) => {
                setOutlineWidth(v);
                apply({ outlineWidth: v });
              }}
            />
            <div className="flex items-center gap-1">
              <input
                type="color"
                value={outlineColor}
                onChange={(e) => {
                  setOutlineColor(e.target.value);
                  apply({ outlineColor: e.target.value });
                }}
                className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label="Outline color"
              />
              <span className="w-5 text-right text-[10px] tabular-nums">{outlineWidth}</span>
            </div>
          </Row>
        </div>
      </div>
    </>
  );
}

/** Positions the small handle dot for a given edge/corner. */
function handlePosition(h: Handle): React.CSSProperties {
  const base: React.CSSProperties = {};
  const off = "-6px";
  switch (h) {
    case "nw":
      return { top: off, left: off, cursor: "nwse-resize" };
    case "n":
      return { top: off, left: "50%", transform: "translateX(-50%)", cursor: "ns-resize" };
    case "ne":
      return { top: off, right: off, cursor: "nesw-resize" };
    case "e":
      return { top: "50%", right: off, transform: "translateY(-50%)", cursor: "ew-resize" };
    case "se":
      return { bottom: off, right: off, cursor: "nwse-resize" };
    case "s":
      return { bottom: off, left: "50%", transform: "translateX(-50%)", cursor: "ns-resize" };
    case "sw":
      return { bottom: off, left: off, cursor: "nesw-resize" };
    case "w":
      return { top: "50%", left: off, transform: "translateY(-50%)", cursor: "ew-resize" };
  }
  return base;
}

/**
 * Fixed-position overlay that exactly covers the image and repositions on
 * scroll/resize so the 8 handles always hug the image edges.
 */
function HandleOverlay({
  imageEl,
  children,
}: {
  imageEl: HTMLImageElement;
  children: React.ReactNode;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const tick = () => force((n) => n + 1);
    window.addEventListener("scroll", tick, true);
    window.addEventListener("resize", tick);
    const ro = new ResizeObserver(tick);
    ro.observe(imageEl);
    return () => {
      window.removeEventListener("scroll", tick, true);
      window.removeEventListener("resize", tick);
      ro.disconnect();
    };
  }, [imageEl]);

  const r = imageEl.getBoundingClientRect();
  return (
    <div
      data-img-handle
      className="pointer-events-none fixed z-[101]"
      style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
    >
      {/* selection outline */}
      <div className="absolute inset-0 rounded-[2px] border-2 border-accent-strong/70" />
      {/* handles themselves are interactive */}
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Label className="w-10 shrink-0 text-[10px] text-muted-foreground">{label}</Label>
      <div className="flex flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

function parseDefaultOutlineColor(img: HTMLImageElement, fallback?: string): string {
  try {
    const color = getComputedStyle(img).outlineColor;
    if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return rgbToHex(color);
  } catch {}
  if (fallback && fallback !== "transparent") return fallback;
  return "#b06a12";
}

function rgbToHex(color: string): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return color;
  ctx.fillStyle = color;
  const hex = ctx.fillStyle;
  return hex.startsWith("#") ? hex : color;
}
