import { useState, useRef, type ReactNode } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronsUpDown,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Indent,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Outdent,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Table as TableIcon,
  TextCursorInput,
  Type,
  Underline,
  Undo2,
  Wand2,
  Eraser,
  Square,
  Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useEditor } from "./context";
import * as E from "@/lib/editor";
import { insertTable } from "@/lib/editor";

const FONTS = [
  ["Geist", "Geist, sans-serif"],
  ["Fraunces", "Fraunces, serif"],
  ["Georgia", "Georgia, serif"],
  ["Times", "'Times New Roman', serif"],
  ["Arial", "Arial, sans-serif"],
  ["Courier", "'Courier New', monospace"],
  ["Helvetica", "Helvetica, sans-serif"],
  ["Verdana", "Verdana, sans-serif"],
];

const PALETTE = [
  "#1b1812", "#5c554a", "#8a8170", "#b06a12", "#c2841c", "#e0a458",
  "#b4261c", "#e0635a", "#2f7d52", "#1f6feb", "#7c3aed", "#0d9488",
];

const SIZES = [12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 40, 48];

export function Toolbar({ onGenerateImage }: { onGenerateImage?: () => void }) {
  const ctx = useEditor();
  const f = ctx.formats;

  const run = <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      ctx.focus();
      fn(...args);
      ctx.sync();
    };

  return (
    <div className="no-print flex flex-wrap items-center gap-1 border-b border-border bg-card/80 px-2 py-1.5 backdrop-blur">
      {/* history */}
      <Group>
        <Tool icon={Undo2} label="Undo (Ctrl+Z)" onClick={run(E.undo)} />
        <Tool icon={Redo2} label="Redo (Ctrl+Y)" onClick={run(E.redo)} />
      </Group>

      <Divider />

      {/* block styles */}
      <Group>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 px-2 capitalize">
              {blockLabel(f.block)} <ChevronsUpDown className="size-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Text style</DropdownMenuLabel>
            <DropdownMenuItem onClick={run(E.paragraph)}><Pilcrow className="size-4" /> Paragraph</DropdownMenuItem>
            <DropdownMenuItem onClick={run(() => E.heading(1))}><Heading1 className="size-4" /> Heading 1</DropdownMenuItem>
            <DropdownMenuItem onClick={run(() => E.heading(2))}><Heading2 className="size-4" /> Heading 2</DropdownMenuItem>
            <DropdownMenuItem onClick={run(() => E.heading(3))}><Heading3 className="size-4" /> Heading 3</DropdownMenuItem>
            <DropdownMenuItem onClick={run(() => E.heading(4))}>Heading 4</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={run(E.blockquote)}><Quote className="size-4" /> Quote</DropdownMenuItem>
            <DropdownMenuItem onClick={run(E.preformatted)}><Code2 className="size-4" /> Code block</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Group>

      <Divider />

      {/* inline */}
      <Group>
        <Tool icon={Bold} label="Bold" active={f.bold} onClick={run(E.bold)} />
        <Tool icon={Italic} label="Italic" active={f.italic} onClick={run(E.italic)} />
        <Tool icon={Underline} label="Underline" active={f.underline} onClick={run(E.underline)} />
        <Tool icon={Strikethrough} label="Strikethrough" active={f.strike} onClick={run(E.strikeThrough)} />
        <Tool icon={Code} label="Inline code" onClick={run(() => E.wrapSelectionWithStyle({ fontFamily: "'Geist Mono', monospace", background: "var(--color-muted)" }))} />
        <Tool icon={Superscript} label="Superscript" onClick={run(E.superscript)} />
        <Tool icon={Subscript} label="Subscript" onClick={run(E.subscript)} />
      </Group>

      <Divider />

      {/* font + size + color */}
      <Group>
        <FontPicker onPick={run((font) => E.setFontName(font))} />
        <SizePicker onPick={run((size) => E.setFontSize(size))} />
        <ColorPicker
          icon={Baseline}
          label="Text color"
          onPick={run((c) => E.setForeColor(c))}
        />
        <ColorPicker
          icon={Highlighter}
          label="Highlight"
          onPick={run((c) => E.setBackColor(c))}
        />
      </Group>

      <Divider />

      {/* lists + align */}
      <Group>
        <Tool icon={List} label="Bulleted list" active={f.ul} onClick={run(E.unorderedList)} />
        <Tool icon={ListOrdered} label="Numbered list" active={f.ol} onClick={run(E.orderedList)} />
        <Tool icon={Outdent} label="Decrease indent" onClick={run(E.outdent)} />
        <Tool icon={Indent} label="Increase indent" onClick={run(E.indent)} />
      </Group>

      <Group>
        <Tool icon={AlignLeft} label="Align left" active={f.align === "left"} onClick={run(() => E.align("left"))} />
        <Tool icon={AlignCenter} label="Align center" active={f.align === "center"} onClick={run(() => E.align("center"))} />
        <Tool icon={AlignRight} label="Align right" active={f.align === "right"} onClick={run(() => E.align("right"))} />
        <Tool icon={AlignJustify} label="Justify" active={f.align === "justify"} onClick={run(() => E.align("justify"))} />
      </Group>

      <Divider />

      {/* insert */}
      <Group>
        <LinkTool onConfirm={run((url) => E.createLink(url))} />
        <ImageMenu onGenerate={onGenerateImage} onUpload={runInsertImage} onUrl={runInsertImageUrl} />
        <TableMenu onPick={run((r, c) => insertTable(r, c))} />
        <Tool icon={Square} label="Text box" onClick={run(() => E.insertTextBox())} />
        <Tool icon={Quote} label="Callout" onClick={run(() => E.insertCallout())} />
        <Tool icon={Minus} label="Divider" onClick={run(E.insertHorizontalRule)} />
        <EmojiTool onPick={run((e) => E.insertHTML(e))} />
      </Group>

      <Divider />

      <Group>
        <Tool icon={Eraser} label="Clear formatting" onClick={run(E.clearSelectionFormatting)} />
      </Group>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="accent" size="sm" onClick={onGenerateImage} className="gap-1.5">
          <Wand2 /> Generate
        </Button>
      </div>
    </div>
  );

  function runInsertImage(src: string) {
    ctx.focus();
    E.insertImage(src);
    ctx.sync();
  }
  function runInsertImageUrl() {
    const url = window.prompt("Image URL");
    if (url) runInsertImage(url);
  }
}

/* --------------------------------- bits ---------------------------------- */

function blockLabel(b?: string) {
  switch (b) {
    case "H1": return "Heading 1";
    case "H2": return "Heading 2";
    case "H3": return "Heading 3";
    case "H4": return "Heading 4";
    case "BLOCKQUOTE": return "Quote";
    case "PRE": return "Code";
    default: return "Paragraph";
  }
}

function Group({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}
function Divider() {
  return <Separator orientation="vertical" className="mx-1 h-6" />;
}

function Tool({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: typeof Bold;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(active && "bg-accent-soft text-accent-strong")}
    >
      <Icon />
    </Button>
  );
}

function FontPicker({ onPick }: { onPick: (font: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 px-2">
          <Type className="size-4" /> <span className="text-xs">Font</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {FONTS.map(([name, css]) => (
          <DropdownMenuItem key={name} onClick={() => onPick(css)} style={{ fontFamily: css }}>
            {name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SizePicker({ onPick }: { onPick: (size: number) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 px-2 text-xs">
          Aa <ChevronsUpDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {SIZES.map((s) => (
          <DropdownMenuItem key={s} onClick={() => onPick(s)} style={{ fontSize: s }}>
            {s}px
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColorPicker({
  icon: Icon,
  label,
  onPick,
}: {
  icon: typeof Bold;
  label: string;
  onPick: (c: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" title={label} aria-label={label}>
          <Icon />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <div className="grid grid-cols-6 gap-1.5">
          {PALETTE.map((c) => (
            <button
              key={c}
              className="size-6 rounded-md border border-border transition-transform hover:scale-110"
              style={{ background: c }}
              onClick={() => onPick(c)}
            />
          ))}
        </div>
        <Separator className="my-2" />
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Palette className="size-3.5" /> Custom
          <input type="color" onChange={(e) => onPick(e.target.value)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" />
        </label>
      </PopoverContent>
    </Popover>
  );
}

function LinkTool({ onConfirm }: { onConfirm: (url: string) => void }) {
  return (
    <Tool
      icon={Link2}
      label="Insert link"
      onClick={() => {
        const url = window.prompt("Link URL", "https://");
        if (url) onConfirm(url);
      }}
    />
  );
}

function ImageMenu({
  onGenerate,
  onUpload,
  onUrl,
}: {
  onGenerate?: () => void;
  onUpload: (src: string) => void;
  onUrl: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" title="Insert image" aria-label="Insert image">
            <ImageIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Image</DropdownMenuLabel>
          <DropdownMenuItem onClick={onGenerate}>
            <Wand2 className="size-4" /> Generate with AI…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileRef.current?.click()}>
            <ImageIcon className="size-4" /> Upload from device…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onUrl}>
            <Link2 className="size-4" /> From URL…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onUpload(reader.result as string);
          reader.readAsDataURL(file);
        }}
      />
    </>
  );
}

function TableMenu({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState<[number, number]>([1, 1]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Insert table" aria-label="Insert table">
          <TableIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <div className="grid grid-cols-6 gap-1">
          {Array.from({ length: 36 }).map((_, i) => {
            const r = Math.floor(i / 6) + 1;
            const c = (i % 6) + 1;
            const active = r <= hover[0] && c <= hover[1];
            return (
              <button
                key={i}
                className="size-5 rounded-sm border border-border"
                style={{ background: active ? "var(--color-accent)" : "transparent" }}
                onMouseEnter={() => setHover([r, c])}
                onClick={() => onPick(r, c)}
              />
            );
          })}
        </div>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          {hover[0]} × {hover[1]}
        </p>
      </PopoverContent>
    </Popover>
  );
}

const EMOJIS = ["✨", "📌", "✅", "❤️", "🔥", "💡", "🚀", "⚠️", "📊", "🎯", "🔍", "📝", "👍", "⭐", "🎉", "💬"];
function EmojiTool({ onPick }: { onPick: (e: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Emoji" aria-label="Emoji">
          <TextCursorInput />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <div className="grid grid-cols-8 gap-1">
          {EMOJIS.map((e) => (
            <button
              key={e}
              className="grid size-7 place-items-center rounded hover:bg-muted"
              onClick={() => onPick(e)}
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
