import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Scan,
  Server,
  Trash2,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/form";
import { Badge, Separator } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStore } from "@/lib/store";
import {
  PROFILE_PRESETS,
  type AIProfile,
  pingProfile,
  detectModels,
  scanEnvKeys,
} from "@/lib/ai";
import { deleteDoc } from "@/lib/documents/manager";
import { idbDel } from "@/lib/idb";
import { cn } from "@/lib/utils";
import { getLogPath, writeError } from "@/lib/log";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Server className="size-5 text-accent-strong" /> Settings
          </DialogTitle>
          <DialogDescription>
            Configure AI endpoints, profiles and editor preferences. Keys are
            stored only on this device.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="profiles" className="px-6 pb-6">
          <TabsList>
            <TabsTrigger value="profiles">AI Profiles</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>

          <TabsContent value="profiles" className="mt-4">
            <ProfilesTab />
          </TabsContent>
          <TabsContent value="preferences" className="mt-4">
            <PreferencesTab />
          </TabsContent>
          <TabsContent value="data" className="mt-4">
            <DataTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- Profiles -------------------------------- */

function ProfilesTab() {
  const profiles = useStore((s) => s.profiles);
  const activeId = useStore((s) => s.activeProfileId);
  const setActive = useStore((s) => s.setActiveProfile);
  const addProfile = useStore((s) => s.addProfile);
  const removeProfile = useStore((s) => s.removeProfile);
  const [editingId, setEditingId] = useState<string | null>(activeId ?? profiles[0]?.id ?? null);

  const editing = profiles.find((p) => p.id === editingId) ?? profiles[0];

  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 h-[440px]">
      {/* list */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Profiles
          </span>
          <AddProfileButton onAdd={(p) => { const id = addProfile(p); setEditingId(id); }} />
        </div>
        <div className="flex-1 overflow-auto -mx-1 px-1 space-y-1">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => setEditingId(p.id)}
              className={cn(
                "w-full text-left rounded-lg border px-3 py-2 transition-colors",
                editingId === p.id
                  ? "border-accent/40 bg-accent-soft/60"
                  : "border-transparent hover:bg-muted"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate">{p.name}</span>
                {activeId === p.id && (
                  <span className="size-1.5 rounded-full bg-success" title="Active" />
                )}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {p.flavor} · {p.defaultChatModel}
              </div>
            </button>
          ))}
        </div>
      </div>

      <Separator orientation="vertical" className="hidden" />

      {/* editor */}
      <div className="overflow-auto -mx-1 px-1">
        {editing ? (
          <ProfileEditor
            key={editing.id}
            profile={editing}
            active={activeId === editing.id}
            onSetActive={() => setActive(editing.id)}
            onDelete={() => {
              removeProfile(editing.id);
              setEditingId(null);
            }}
          />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            No profile selected.
          </div>
        )}
      </div>
    </div>
  );
}

function AddProfileButton({
  onAdd,
}: {
  onAdd: (p: Omit<AIProfile, "id" | "createdAt">) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm">
          <Plus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>From preset</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PROFILE_PRESETS.map((preset) => (
          <DropdownMenuItem key={preset.name} onClick={() => onAdd({ ...preset, apiKey: "" })}>
            <span className="font-medium">{preset.name}</span>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {preset.flavor}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            onAdd({
              name: "Custom endpoint",
              flavor: "openai",
              baseUrl: "https://",
              apiKey: "",
              defaultChatModel: "gpt-4o-mini",
              defaultImageModel: "dall-e-3",
              maxTokens: 16384,
              temperature: 0.6,
              models: [],
            })
          }
        >
          <Plus className="size-4" /> Blank custom
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProfileEditor({
  profile,
  active,
  onSetActive,
  onDelete,
}: {
  profile: AIProfile;
  active: boolean;
  onSetActive: () => void;
  onDelete: () => void;
}) {
  const update = useStore((s) => s.updateProfile);
  const [draft, setDraft] = useState<AIProfile>(profile);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => setDraft(profile), [profile]);

  const detect = async () => {
    setDetecting(true);
    setTestResult(null);
    try {
      let profileForDetection = draft;
      if (!draft.apiKey && !draft.baseUrl.includes("localhost") && !draft.baseUrl.includes("127.0.0.1")) {
        const found = await scanEnvKeys();
        const match = found.find((k) => k.profileName === draft.name);
        if (match) profileForDetection = { ...draft, apiKey: match.key };
      }

      const models = await detectModels(profileForDetection);
      const deduped = models.filter(
        (m, i, self) => m.id && self.findIndex((x) => x.id === m.id) === i
      );
      if (!deduped.length) throw new Error("No models found.");

      const chatDefault = deduped.find((m) => !m.imageGen)?.id ?? deduped[0].id;
      const imageDefault = deduped.find((m) => m.imageGen)?.id ?? draft.defaultImageModel;
      const nextDraft: AIProfile = {
        ...draft,
        apiKey: profileForDetection.apiKey,
        defaultChatModel: deduped.some((m) => m.id === draft.defaultChatModel) ? draft.defaultChatModel : chatDefault,
        defaultImageModel: imageDefault,
        models: deduped,
      };
      setDraft(nextDraft);
      // Persist immediately so the top model picker updates without requiring
      // a separate Save click. This matters most for LM Studio/Ollama because
      // those presets intentionally start with an empty model list.
      update(profile.id, nextDraft);
      const count = deduped.length;
      toast.success(`Discovered ${count} model${count !== 1 ? "s" : ""}`, {
        description: `Saved "${draft.name}" model list`,
      });
    } catch (e) {
      writeError("settings", "Model detection button failed", e, {
        profile: draft.name,
        baseUrl: draft.baseUrl,
      });
      toast.error("Model detection failed", { description: (e as Error).message });
    } finally {
      setDetecting(false);
    }
  };

  const scanEnv = async () => {
    const found = await scanEnvKeys();
    const match = found.find((k) => k.profileName === draft.name);
    if (match) {
      setDraft((d) => ({ ...d, apiKey: match.key }));
      toast.success("API key detected", { description: `Found ${match.source} from environment` });
    } else {
      toast.message("No API key found", { description: `${draft.name} key not found in environment` });
    }
  };


  const set = <K extends keyof AIProfile>(k: K, v: AIProfile[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    update(profile.id, draft);
    toast.success(`Saved profile "${draft.name}"`);
  };

  const test = async () => {
    update(profile.id, draft); // persist before testing
    setTesting(true);
    setTestResult(null);
    const r = await pingProfile(draft);
    setTestResult(r);
    setTesting(false);
    if (r.ok) toast.success("Connection successful");
    else toast.error("Connection failed", { description: r.message });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Profile name">
          <Input value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="API flavor">
          <Select
            value={draft.flavor}
            onValueChange={(v) => set("flavor", v as AIProfile["flavor"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI-compatible</SelectItem>
              <SelectItem value="anthropic">Anthropic-compatible</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Base URL" hint="Any OpenAI- or Anthropic-compatible endpoint.">
        <Input
          value={draft.baseUrl}
          onChange={(e) => set("baseUrl", e.target.value)}
          placeholder="https://api.openai.com/v1"
        />
      </Field>

      <Field label="API key" hint={draft.apiKey ? "Stored only on this device." : "Leave empty to detect from environment."}>
        <Input
          type="password"
          value={draft.apiKey}
          onChange={(e) => set("apiKey", e.target.value)}
          placeholder="sk-..."
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Chat model">
          <Input
            value={draft.defaultChatModel}
            onChange={(e) => set("defaultChatModel", e.target.value)}
          />
        </Field>
        <Field label="Image model">
          <Input
            value={draft.defaultImageModel}
            onChange={(e) => set("defaultImageModel", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Max output tokens"
          hint="≥ 16000 keeps reasoning/thinking budgets intact."
        >
          <Input
            type="number"
            min={1024}
            step={1024}
            value={draft.maxTokens}
            onChange={(e) => set("maxTokens", Math.max(1024, +e.target.value))}
          />
        </Field>
        <Field label="Temperature">
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={draft.temperature}
            onChange={(e) => set("temperature", +e.target.value)}
          />
        </Field>
      </div>

      <Field label="Extra headers (JSON)" hint="e.g. OpenRouter HTTP-Referer / X-Title.">
        <Textarea
          className="font-mono text-xs min-h-[64px]"
          value={JSON.stringify(draft.extraHeaders ?? {}, null, 2)}
          onChange={(e) => {
            try {
              set("extraHeaders", JSON.parse(e.target.value || "{}"));
            } catch {
              /* keep editing */
            }
          }}
        />
      </Field>


      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button onClick={save}>
          <CheckCircle2 /> Save
        </Button>
        <Button variant="outline" onClick={test} disabled={testing}>
          {testing ? <Loader2 className="animate-spin" /> : <Plug />} Test
        </Button>
        <Button variant="outline" onClick={detect} disabled={detecting}>
          {detecting ? <Loader2 className="animate-spin" /> : <RefreshCw />} Detect models
        </Button>
        <Button variant="outline" onClick={scanEnv}>
          <Scan /> Scan env
        </Button>
        {!active && (
          <Button variant="accent" onClick={onSetActive}>
            <Zap /> Set active
          </Button>
        )}
        {active && <Badge variant="success">Active</Badge>}
        <Button
          variant="ghost"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 /> Delete
        </Button>
      </div>

      {testResult && (
        <p
          className={cn(
            "text-xs",
            testResult.ok ? "text-success" : "text-destructive"
          )}
        >
          {testResult.ok ? "✓ " : "✗ "}
          {testResult.message}
        </p>
      )}
    </div>
  );
}

type AIModelLite = AIProfile["models"][number];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center justify-between">
        {label}
        {hint && <span className="text-[10px] font-normal text-muted-foreground">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}

/* ----------------------------- Preferences ------------------------------- */

function PreferencesTab() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const autosaveMs = useStore((s) => s.autosaveMs);
  const pageWidth = useStore((s) => s.pageWidth);
  const defaultFontSize = useStore((s) => s.defaultFontSize);
  const showThinking = useStore((s) => s.showThinking);
  const keybindings = useStore((s) => s.keybindings);
  const setKeybinding = useStore((s) => s.setKeybinding);
  const setSetting = useStore((s) => s.setSetting);

  return (
    <div className="space-y-5 max-w-xl">
      <Row label="Theme" hint="System follows your OS setting.">
        <Select value={theme} onValueChange={(v) => setTheme(v as typeof theme)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Page width">
        <Select value={pageWidth} onValueChange={(v) => setSetting("pageWidth", v as never)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="narrow">Narrow</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="wide">Wide</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Default font size" hint={`${defaultFontSize}px`}>
        <input
          type="range"
          min={12}
          max={22}
          value={defaultFontSize}
          onChange={(e) => setSetting("defaultFontSize", +e.target.value)}
          className="w-40 accent-[var(--color-accent)]"
        />
      </Row>

      <Row label="Autosave" hint="Every few seconds while editing.">
        <Select
          value={String(autosaveMs)}
          onValueChange={(v) => setSetting("autosaveMs", +v)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2000">2s</SelectItem>
            <SelectItem value="4000">4s</SelectItem>
            <SelectItem value="8000">8s</SelectItem>
            <SelectItem value="15000">15s</SelectItem>
            <SelectItem value="0">Off</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Show thinking tokens" hint="Display reasoning where the model emits it.">
        <Switch checked={showThinking} onCheckedChange={(v) => setSetting("showThinking", v)} />
      </Row>

      <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
        <div>
          <div className="text-sm font-medium">Keybindings</div>
          <div className="text-xs text-muted-foreground">Use formats like Ctrl+P, Ctrl+Shift+P, Alt+S, Ctrl+\\.</div>
        </div>
        <Row label="Selection AI popup">
          <Input
            value={keybindings.selectionChat}
            onChange={(e) => setKeybinding("selectionChat", e.target.value)}
            className="w-40"
          />
        </Row>
        <Row label="Split view">
          <Input
            value={keybindings.splitView}
            onChange={(e) => setKeybinding("splitView", e.target.value)}
            className="w-40"
          />
        </Row>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/* --------------------------------- Data ---------------------------------- */

function DataTab() {
  const recent = useStore((s) => s.recent);
  const removeRecent = useStore((s) => s.removeRecent);
  const [logPath, setLogPath] = useState<string | null>(null);

  useEffect(() => {
    getLogPath().then(setLogPath);
  }, []);

  const clearAll = async () => {
    for (const d of recent) {
      await deleteDoc(d.id);
      await idbDel(`wore.aiChats.${d.id}`); // drop orphaned per-document chat history
      removeRecent(d.id);
    }
    useStore.setState({ openTabs: [] });
    toast.success("Cleared all documents");
  };

  return (
    <div className="space-y-3 max-w-xl">
      <p className="text-sm text-muted-foreground">
        WoRe stores documents locally in your browser&apos;s IndexedDB. Clearing
        removes all documents and their original source files from this device.
      </p>
      <div className="flex items-center gap-3">
        <Button variant="destructive" onClick={clearAll} disabled={!recent.length}>
          <Trash2 /> Remove all documents ({recent.length})
        </Button>
      </div>
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
        <div className="font-medium">Logs</div>
        <div className="mt-1 break-all text-muted-foreground">
          {logPath ?? "Browser/dev logs are stored in localStorage under wore.logs."}
        </div>
        {logPath && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              navigator.clipboard.writeText(logPath);
              toast.success("Log path copied");
            }}
          >
            Copy log path
          </Button>
        )}
      </div>
    </div>
  );
}
