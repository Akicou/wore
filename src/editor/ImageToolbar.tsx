import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

interface ImageToolbarProps {
  imageEl: HTMLImageElement;
  onClose: () => void;
  onChange: () => void;
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
      if (next.widthPct !== undefined) s.width = `${next.widthPct}%`;
      onChange();
    },
    [imageEl, onChange]
  );

  // close on click outside
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!toolbarRef.current?.contains(t) && t !== imageEl) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [imageEl, onClose]);

  const rect = imageEl.getBoundingClientRect();
  const scroll = document.documentElement;
  const top = rect.top + (scroll.scrollTop ?? 0) - 6;
  const left = rect.left + rect.width / 2 + (scroll.scrollLeft ?? 0);

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

  return (
    <div
      ref={toolbarRef}
      className={cn(
        "fixed z-[100] w-56 rounded-xl border border-border bg-popover p-3 shadow-xl",
        "translate-y-[-100%] translate-x-[-50%]"
      )}
      style={{ top: `${top}px`, left: `${left}px` }}
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
