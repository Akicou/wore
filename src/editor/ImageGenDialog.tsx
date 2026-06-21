import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Image as ImageIcon, Loader2, RefreshCw, Wand2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea, Label } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStore } from "@/lib/store";
import { generateImage } from "@/lib/ai";
import { insertImage } from "@/lib/editor";
import { fittedImageStyle } from "@/lib/images";
import { useEditor } from "./context";
import { downloadBlob } from "@/lib/utils";

const SIZES = [
  ["1024x1024", "Square · 1:1"],
  ["1536x1024", "Landscape · 3:2"],
  ["1024x1536", "Portrait · 2:3"],
];

const STYLE_SUFFIX =
  ", high detail, balanced composition, professional";

export function ImageGenDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const profile = useStore((s) => s.profiles.find((p) => p.id === s.activeProfileId));
  const ctx = useEditor();
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [model, setModel] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Don't carry a previous generation's preview/busy state into the next open.
  useEffect(() => {
    if (!open) {
      setResult(null);
      setBusy(false);
    }
  }, [open]);

  const imageModels = profile?.models.filter((m) => m.imageGen) ?? [];
  const chosenModel = model ?? profile?.defaultImageModel ?? imageModels[0]?.id ?? "";

  const generate = async () => {
    if (!profile) {
      toast.error("No AI profile", { description: "Configure one in Settings." });
      return;
    }
    if (!profile.apiKey && !profile.baseUrl.includes("localhost")) {
      toast.error("Missing API key", { description: `Add a key for “${profile.name}”.` });
      return;
    }
    if (!prompt.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await generateImage(profile, prompt.trim() + STYLE_SUFFIX, {
        model: chosenModel,
        size,
      });
      setResult(r.url);
      if (r.revisedPrompt) toast.message("Image ready", { description: r.revisedPrompt });
    } catch (e) {
      toast.error("Image generation failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const insert = async () => {
    if (!result) return;
    ctx.focus();
    const style = await fittedImageStyle(result, ctx.editorEl?.current ?? null);
    insertImage(result, { alt: prompt.slice(0, 80), caption: "", style });
    ctx.sync();
    onOpenChange(false);
    toast.success("Image inserted");
  };

  const download = async () => {
    if (!result) return;
    try {
      const res = await fetch(result);
      const blob = await res.blob();
      downloadBlob(blob, `wore-image-${Date.now()}.png`);
    } catch {
      toast.error("Could not download image");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-5 text-accent-strong" /> Generate image
          </DialogTitle>
          <DialogDescription>
            Describe the image — WoRe uses{" "}
            <strong className="text-foreground">{profile?.name ?? "your profile"}</strong>
            {chosenModel ? ` · ${chosenModel}` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Prompt</Label>
            <Textarea
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && generate()}
              placeholder="A serene editorial illustration of a paper boat on calm ink water…"
              className="min-h-[88px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Size</Label>
              <Select value={size} onValueChange={setSize}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZES.map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              {imageModels.length ? (
                <Select value={chosenModel} onValueChange={setModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {imageModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label ?? m.id}
                      </SelectItem>
                    ))}
                    {profile && !imageModels.some((m) => m.id === profile.defaultImageModel) && (
                      <SelectItem value={profile.defaultImageModel}>{profile.defaultImageModel}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-xs text-muted-foreground">
                  {profile?.defaultImageModel ?? "—"}
                </div>
              )}
            </div>
          </div>

          {/* preview */}
          <div className="grid min-h-[200px] place-items-center overflow-hidden rounded-lg border border-border bg-muted/40">
            {busy ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="size-6 animate-spin text-accent-strong" />
                <span className="ai-text text-sm font-medium">Painting…</span>
              </div>
            ) : result ? (
              <img src={result} alt="" className="max-h-[320px] w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <ImageIcon className="size-8 opacity-40" />
                <span className="text-xs">Your generated image appears here</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          {result && (
            <Button variant="outline" onClick={download} className="mr-auto">
              <Download /> Download
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {result ? (
            <>
              <Button onClick={generate} disabled={busy || !prompt.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Regenerate
              </Button>
              <Button variant="accent" onClick={insert}>
                <ImageIcon /> Insert
              </Button>
            </>
          ) : (
            <Button onClick={generate} disabled={busy || !prompt.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Wand2 />} Generate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
