import { useEffect, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  FileText,
  FileType2,
  Loader2,
  Pin,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { loadDoc, getSourceBytes } from "@/lib/documents/manager";
import type { StoredDoc } from "@/lib/documents/manager";
import { renderPdfPages, type RenderedPage } from "@/lib/documents/pdf";
import { useStore, type RecentDoc } from "@/lib/store";
import { cn, timeAgo } from "@/lib/utils";

/**
 * Dockable, read-only reference panel. Pins any document from Recents and
 * renders it side-by-side with the active editor — primarily so a PDF (or any
 * other doc) can be kept on screen as context while editing/authoring a DOCX.
 *
 * The panel is independent of the active document: pinning survives tab
 * switches, and the currently active doc is excluded from the picker so you
 * never mirror the thing you're editing.
 */
export function ReferencePanel({
  referenceId,
  activeDocId,
  onPick,
  onClear,
  onClose,
}: {
  referenceId: string | null;
  activeDocId: string;
  onPick: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const recent = useStore((s) => s.recent);

  return (
    <div className="no-print flex h-full flex-col bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <BookOpen className="size-4 text-accent-strong" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Reference</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {referenceId ? "Read-only docked preview" : "Pin a document to view side-by-side"}
          </div>
        </div>
        {referenceId && (
          <Button variant="ghost" size="icon-sm" onClick={onClear} title="Pick a different reference">
            <ChevronLeft className="size-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onClose} title="Hide reference panel">
          <X className="size-3.5" />
        </Button>
      </div>

      {referenceId ? (
        <ReferencePreview id={referenceId} />
      ) : (
        <ReferencePicker
          recent={recent.filter((r) => r.id !== activeDocId)}
          onPick={onPick}
        />
      )}
    </div>
  );
}

function ReferencePicker({
  recent,
  onPick,
}: {
  recent: RecentDoc[];
  onPick: (id: string) => void;
}) {
  // Rank PDFs and DOCX first — they're the most useful as visual references.
  const ranked = [...recent].sort((a, b) => {
    const score = (f: string) => (f === "pdf" ? 0 : f === "docx" ? 1 : 2);
    return score(a.format) - score(b.format) || b.openedAt - a.openedAt;
  });

  if (!ranked.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <BookOpen className="size-6 text-muted-foreground/60" />
        <p>No other documents yet.</p>
        <p className="text-[11px]">Import a PDF or Word file to dock it here as a reference.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="space-y-1">
        {ranked.map((d) => (
          <button
            key={d.id}
            onClick={() => onPick(d.id)}
            className="group flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-muted"
          >
            <FormatIcon format={d.format} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{d.title || "Untitled"}</div>
              <div className="truncate text-[10px] text-muted-foreground">
                {d.format.toUpperCase()}
                {d.wordCount ? ` · ${d.wordCount} words` : ""} · {timeAgo(d.openedAt)}
              </div>
            </div>
            <Pin className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ReferencePreview({ id }: { id: string }) {
  const [doc, setDoc] = useState<StoredDoc | null>(null);
  const [pages, setPages] = useState<RenderedPage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages(null);
    setDoc(null);
    (async () => {
      const d = await loadDoc(id);
      if (cancelled) return;
      if (!d) {
        setError("Document not found.");
        setLoading(false);
        return;
      }
      setDoc(d);
      if (d.format === "pdf") {
        const bytes = await getSourceBytes(id);
        if (cancelled) return;
        if (!bytes) {
          setError("Original PDF bytes are unavailable.");
          setLoading(false);
          return;
        }
        try {
          const rendered = await renderPdfPages(bytes, 1.1);
          if (cancelled) return;
          setPages(rendered);
        } catch (e) {
          if (cancelled) return;
          setError((e as Error).message);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin text-accent-strong" />
        <span className="text-xs">Loading reference…</span>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Reference unavailable</p>
        <p>{error ?? "Unknown error"}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FormatIcon format={doc.format} />
        <div className="min-w-0 flex-1 truncate text-xs font-medium" title={doc.title}>
          {doc.title || "Untitled"}
        </div>
        <Badge variant="outline" className="uppercase text-[9px]">
          {doc.format}
        </Badge>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {doc.format === "pdf" ? (
          <PdfPages pages={pages} />
        ) : (
          <div
            className={cn(
              "wore-page pointer-events-none mx-auto min-h-[40vh] rounded-[3px] bg-background p-8 shadow-sm",
              doc.format === "docx" && "wore-docx-preview"
            )}
            dangerouslySetInnerHTML={{ __html: doc.contentHtml || "<p><br></p>" }}
          />
        )}
      </div>
    </div>
  );
}

function PdfPages({ pages }: { pages: RenderedPage[] | null }) {
  if (pages && pages.length === 0) {
    return <p className="text-xs text-muted-foreground">No pages to display.</p>;
  }
  return (
    <div className="mx-auto flex w-full flex-col items-center gap-3">
      {pages?.map((p, i) => (
        <div
          key={i}
          className="wore-page overflow-hidden rounded-[2px] shadow-sm"
          style={{ width: "100%", maxWidth: p.width }}
        >
          <img src={p.dataUrl} alt={`Page ${i + 1}`} className="block w-full" />
        </div>
      ))}
    </div>
  );
}

function FormatIcon({ format }: { format: string }) {
  const cls = cn(
    "grid size-7 shrink-0 place-items-center rounded-md",
    format === "pdf" && "bg-destructive/10 text-destructive",
    format === "docx" && "bg-accent-soft text-accent-strong",
    format === "md" && "bg-info/10 text-info",
    format === "html" && "bg-success/10 text-success",
    format === "txt" && "bg-muted text-muted-foreground"
  );
  return (
    <div className={cls}>
      {format === "docx" ? (
        <FileType2 className="size-3.5" />
      ) : (
        <FileText className="size-3.5" />
      )}
    </div>
  );
}
