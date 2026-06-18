import { ChevronDown, Eye, RefreshCw, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { detectModels, probeModelVision } from "@/lib/ai";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { SettingsDialog } from "./SettingsDialog";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Compact profile + model switcher. */
export function AIPicker({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const profiles = useStore((s) => s.profiles);
  const activeId = useStore((s) => s.activeProfileId);
  const setActive = useStore((s) => s.setActiveProfile);
  const updateProfile = useStore((s) => s.updateProfile);
  const active = profiles.find((p) => p.id === activeId) ?? profiles[0];
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [probingVision, setProbingVision] = useState(false);

  const currentModel = active?.defaultChatModel || "—";

  const probeVisionForCurrent = async () => {
    if (!active || !active.defaultChatModel) return;
    setProbingVision(true);
    try {
      const result = await probeModelVision(active, active.defaultChatModel);
      const existing = active.models.some((m) => m.id === active.defaultChatModel);
      const models = existing
        ? active.models.map((m) =>
            m.id === active.defaultChatModel
              ? {
                  ...m,
                  vision: result.vision,
                  visionTestedAt: Date.now(),
                  visionProbeError: result.vision ? undefined : result.message,
                }
              : m
          )
        : [
            ...active.models,
            {
              id: active.defaultChatModel,
              label: active.defaultChatModel,
              vision: result.vision,
              visionTestedAt: Date.now(),
              visionProbeError: result.vision ? undefined : result.message,
            },
          ];
      updateProfile(active.id, { models });
      if (result.vision) toast.success("Vision supported", { description: active.defaultChatModel });
      else toast.warning("Vision not supported", { description: result.message });
    } finally {
      setProbingVision(false);
    }
  };

  const detectForActive = async () => {
    if (!active) return;
    setDetecting(true);
    try {
      const models = await detectModels(active);
      const deduped = models.filter((m, i, self) => m.id && self.findIndex((x) => x.id === m.id) === i);
      if (!deduped.length) throw new Error("No models found.");
      const defaultChatModel = deduped.some((m) => m.id === active.defaultChatModel)
        ? active.defaultChatModel
        : deduped.find((m) => !m.imageGen)?.id ?? deduped[0].id;
      const defaultImageModel = deduped.find((m) => m.imageGen)?.id ?? active.defaultImageModel;
      updateProfile(active.id, { models: deduped, defaultChatModel, defaultImageModel });
      toast.success(`Detected ${deduped.length} model${deduped.length === 1 ? "" : "s"}`, {
        description: `Updated ${active.name}`,
      });
    } catch (e) {
      toast.error("Model detection failed", { description: (e as Error).message });
    } finally {
      setDetecting(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2 max-w-[260px]">
            <Sparkles className="size-4 text-accent-strong" />
            <span className="truncate">{active?.name ?? "No profile"}</span>
            <span className="text-muted-foreground hidden md:inline truncate">
              · {currentModel}
            </span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Profile</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={activeId ?? ""} onValueChange={setActive}>
            {profiles.map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                <span className="flex flex-col">
                  <span>{p.name}</span>
                  <span className="text-[10px] text-muted-foreground">{p.flavor}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          {active && (
            <>
              <DropdownMenuSeparator />
              {active.models.length > 0 ? (
                <SearchableModelPicker
                  models={active.models}
                  value={currentModel}
                  onChange={(v) => {
                    if (v && active) updateProfile(active.id, { defaultChatModel: v });
                  }}
                />
              ) : (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  No models detected for this profile yet.
                  {active.baseUrl.includes("localhost") && (
                    <div className="mt-1">Start LM Studio's local server, then detect models.</div>
                  )}
                </div>
              )}
              <DropdownMenuItem disabled={detecting} onClick={detectForActive}>
                <RefreshCw className={cn("size-4", detecting && "animate-spin")} />
                {detecting ? "Detecting…" : "Detect models"}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={probingVision || !active.defaultChatModel} onClick={probeVisionForCurrent}>
                <Eye className={cn("size-4", probingVision && "animate-pulse")} />
                {probingVision ? "Testing vision…" : "Reassess vision"}
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              if (onOpenSettings) onOpenSettings();
              else setSettingsOpen(true);
            }}
          >
            Manage profiles…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {!onOpenSettings && <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />}
    </>
  );
}

/** Hook to read the currently chosen model (defaulting to profile default). */
export function useActiveModel() {
  const active = useStore((s) => s.profiles.find((p) => p.id === s.activeProfileId));
  return active?.defaultChatModel ?? "";
}

function SearchableModelPicker({
  models,
  value,
  onChange,
}: {
  models: Array<{ id: string; label?: string; reasoning?: boolean; vision?: boolean; visionTestedAt?: number; visionProbeError?: string }>;
  value: string;
  onChange: (v: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = models.filter(
    (m) =>
      m.id.toLowerCase().includes(search.toLowerCase()) ||
      (m.label ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="px-1 py-1" onKeyDown={(e) => e.stopPropagation()}>
      <DropdownMenuLabel className="flex items-center gap-2 px-2">
        <Search className="size-3.5" /> Model ({models.length})
      </DropdownMenuLabel>
      <div className="px-1 pb-1">
        <Input
          placeholder="Search models..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-8 text-sm"
        />
      </div>
      <div className="max-h-[280px] overflow-auto rounded-md border border-border/60 py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            No models found
          </div>
        ) : (
          filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => onChange(m.id === value ? null : m.id)}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                value === m.id && "bg-muted"
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{m.label ?? m.id}</span>
                {value === m.id && <span className="ml-2 text-xs text-accent-strong">✓</span>}
              </span>
              <div className="flex shrink-0 gap-1">
                {m.reasoning && <Badge variant="accent" className="px-1 py-0 text-[9px]">think</Badge>}
                {m.vision && <Badge variant="secondary" className="px-1 py-0 text-[9px]">vision</Badge>}
                {m.visionTestedAt && !m.vision && <Badge variant="outline" className="px-1 py-0 text-[9px]">no vision</Badge>}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
