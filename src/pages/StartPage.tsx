import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  FilePlus2,
  FolderOpen,
  FileText,
  FileType2,
  Github,
  Pin,
  PinOff,
  Plus,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DocFormat, RecentDoc } from "@/lib/store";
import { useStore } from "@/lib/store";
import { newDoc, saveDoc, importFile, deleteDoc } from "@/lib/documents/manager";
import { starterMarkdown, markdownToHtml } from "@/lib/documents/markdown";
import { formatBytes, timeAgo, cn } from "@/lib/utils";

const ACCEPT = ".md,.markdown,.txt,.html,.htm,.docx,.pdf";

export function StartPage() {
  const navigate = useNavigate();
  const recent = useStore((s) => s.recent);
  const upsertRecent = useStore((s) => s.upsertRecent);
  const removeRecent = useStore((s) => s.removeRecent);
  const togglePin = useStore((s) => s.togglePin);
  const touchRecent = useStore((s) => s.touchRecent);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const openDoc = useCallback(
    (id: string) => {
      touchRecent(id);
      navigate(`/editor/${id}`);
    },
    [navigate, touchRecent]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      try {
        for (const file of list) {
          const { doc, recent } = await importFile(file);
          await saveDoc(doc);
          upsertRecent(recent);
          openDoc(doc.id);
        }
      } catch (e) {
        toast.error("Could not open file", { description: (e as Error).message });
      }
    },
    [upsertRecent, openDoc]
  );

  const sortedRecent = [...recent].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.openedAt - a.openedAt
  );

  return (
    <div
      className="relative flex min-h-screen flex-col items-center bg-background text-foreground"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
      }}
    >
      {/* top-right nav */}
      <header className="absolute right-0 top-0 z-10 flex items-center gap-0.5 p-4">
        <Button variant="ghost" size="icon-sm" asChild className="text-muted-foreground hover:text-foreground">
          <a href="https://github.com/Akicou/wore" target="_blank" rel="noreferrer" aria-label="GitHub">
            <Github className="size-4" />
          </a>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(true)} aria-label="Settings" className="text-muted-foreground hover:text-foreground">
          <Settings2 className="size-4" />
        </Button>
        <ThemeToggle />
      </header>

      {/* main */}
      <main className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 pb-16 pt-24">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as const }}
          className="flex flex-col items-center"
        >
          <div className="flex items-center gap-3">
            <Brand size={40} withText={false} />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">WoRe</h1>
              <p className="text-xs text-muted-foreground">Agentic document editor</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.06, ease: [0.22, 1, 0.36, 1] as const }}
          className="mt-12 grid w-full gap-3 sm:grid-cols-3"
        >
          <ActionButton icon={FilePlus2} label="New" onClick={() => setNewOpen(true)} />
          <ActionButton icon={FolderOpen} label="Open" onClick={() => fileInput.current?.click()} />
          <ActionButton
            icon={Upload}
            label="Import PDF"
            onClick={() => {
              if (fileInput.current) {
                fileInput.current.accept = ".pdf";
                fileInput.current.click();
                fileInput.current.accept = ACCEPT;
              }
            }}
          />
        </motion.div>

        {sortedRecent.length > 0 && (
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.14 }}
            className="mt-16 w-full"
          >
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Recently opened</span>
              <span>
                {sortedRecent.length} document{sortedRecent.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="space-y-1">
              {sortedRecent.map((d) => (
                <RecentRow
                  key={d.id}
                  doc={d}
                  onOpen={() => openDoc(d.id)}
                  onRemove={async () => {
                    await deleteDoc(d.id);
                    removeRecent(d.id);
                  }}
                  onPin={() => togglePin(d.id)}
                />
              ))}
            </div>
          </motion.section>
        )}

        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.22 }}
          className="mt-auto pt-12 text-[11px] text-muted-foreground"
        >
          v0.5.2 · Local-first
        </motion.footer>
      </main>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      <NewDocumentDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreate={async (title, format) => {
          const html =
            format === "md"
              ? markdownToHtml(starterMarkdown(title))
              : `<h1>${title}</h1><p><br></p>`;
          const doc = newDoc(format === "md" ? "md" : "docx", title, html);
          await saveDoc(doc);
          upsertRecent({
            id: doc.id,
            title: doc.title,
            format: doc.format,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            openedAt: Date.now(),
            size: new Blob([html]).size,
          });
          setNewOpen(false);
          openDoc(doc.id);
        }}
      />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* drag overlay */}
      {dragOver && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-md">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-card px-12 py-10 text-center shadow-2xl">
            <Upload className="mx-auto size-10 text-accent" />
            <p className="mt-3 font-medium">Drop to open</p>
            <p className="text-xs text-muted-foreground">PDF · DOCX · MD · HTML · TXT</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- pieces ---------------------------------- */

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FilePlus2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col items-center justify-center gap-2.5 rounded-lg border border-border bg-card p-4",
        "transition-all hover:border-foreground/20 hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring"
      )}
    >
      <span className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors group-hover:text-foreground">
        <Icon className="size-5" />
      </span>
      <span className="text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
        {label}
      </span>
    </button>
  );
}

function RecentRow({
  doc,
  onOpen,
  onRemove,
  onPin,
}: {
  doc: RecentDoc;
  onOpen: () => void;
  onRemove: () => void;
  onPin: () => void;
}) {
  return (
    <div className="group flex items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-muted/40">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <FormatIcon format={doc.format} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{doc.title || "Untitled"}</span>
          <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-wider">{doc.format}</span>
            <span>·</span>
            <span>{formatBytes(doc.size)}</span>
            <span>·</span>
            <span>{timeAgo(doc.openedAt)}</span>
          </span>
        </span>
      </button>
      <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon-sm" onClick={onPin} aria-label="Pin" className="text-muted-foreground hover:text-foreground">
          {doc.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function FormatIcon({ format }: { format: DocFormat }) {
  const map = {
    md: FileText,
    docx: FileType2,
    pdf: FileText,
    html: FileText,
    txt: FileText,
  } as const;
  const Icon = map[format] ?? FileText;
  return (
    <div className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
      <Icon className="size-3.5" />
    </div>
  );
}

/* --------------------------- new document dialog -------------------------- */

function NewDocumentDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (title: string, format: "md" | "docx") => void;
}) {
  const [title, setTitle] = useState("Untitled");
  const [format, setFormat] = useState<"md" | "docx">("md");
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onCreate(title || "Untitled", format)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as "md" | "docx")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="md">Markdown (.md)</SelectItem>
                <SelectItem value="docx">Word (.docx)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onCreate(title || "Untitled", format)}>
            <Plus /> Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
