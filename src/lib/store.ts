import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { AIProfile } from "./ai";
import { PROFILE_PRESETS } from "./ai";

export type DocFormat = "md" | "docx" | "pdf" | "html" | "txt" | "pptx";
export type ThemeMode = "light" | "dark" | "system";

export interface EditorKeybindings {
  selectionChat: string;
  splitView: string;
}

export interface RecentDoc {
  id: string;
  title: string;
  format: DocFormat;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  size: number;
  wordCount?: number;
  pinned?: boolean;
  hasSource?: boolean; // original bytes stored in IndexedDB
}

interface AppState {
  // theme
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;

  // AI profiles
  profiles: AIProfile[];
  activeProfileId: string | null;
  setActiveProfile: (id: string) => void;
  addProfile: (p: Omit<AIProfile, "id" | "createdAt">) => string;
  updateProfile: (id: string, patch: Partial<AIProfile>) => void;
  removeProfile: (id: string) => void;
  getActiveProfile: () => AIProfile | undefined;

  // recent documents
  recent: RecentDoc[];
  upsertRecent: (doc: RecentDoc) => void;
  removeRecent: (id: string) => void;
  togglePin: (id: string) => void;
  touchRecent: (id: string) => void;

  // editor settings
  autosaveMs: number;
  defaultFontSize: number;
  pageWidth: string; // "narrow" | "normal" | "wide"
  showThinking: boolean;
  openTabs: string[];
  splitView: boolean;
  keybindings: EditorKeybindings;
  addTab: (id: string) => void;
  removeTab: (id: string) => void;
  setSplitView: (v: boolean) => void;
  setKeybinding: <K extends keyof EditorKeybindings>(k: K, v: EditorKeybindings[K]) => void;
  setSetting: <K extends EditorSettings>(k: K, v: AppState[K]) => void;
}

type EditorSettings =
  | "autosaveMs"
  | "defaultFontSize"
  | "pageWidth"
  | "showThinking";

function seedProfiles(): AIProfile[] {
  return PROFILE_PRESETS.map((p) => ({
    ...p,
    apiKey: p.apiKey ?? "",
    id: nanoid(8),
    createdAt: Date.now(),
  }));
}

/** Check if any preset profiles are missing and add them. */
function ensureProfiles(profiles: AIProfile[]): AIProfile[] {
  const existingNames = new Set(profiles.map((p) => p.name));
  const missing = PROFILE_PRESETS.filter((p) => !existingNames.has(p.name));
  if (missing.length === 0) return profiles;
  return [
    ...profiles,
    ...missing.map((p) => ({
      ...p,
      apiKey: p.apiKey ?? "",
      id: nanoid(8),
      createdAt: Date.now(),
    })),
  ];
}

/* Apply theme to <html> + keep in sync with system preference. */
function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  const sys = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && sys);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: "system",
      setTheme: (t) => {
        set({ theme: t });
        applyTheme(t);
      },

      profiles: seedProfiles(),
      activeProfileId: null,
      setActiveProfile: (id) => set({ activeProfileId: id }),
      addProfile: (p) => {
        const id = nanoid(8);
        const profile: AIProfile = { ...p, id, createdAt: Date.now() };
        set((s) => ({
          profiles: [...s.profiles, profile],
          activeProfileId: s.activeProfileId ?? id,
        }));
        return id;
      },
      updateProfile: (id, patch) =>
        set((s) => ({
          profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      removeProfile: (id) =>
        set((s) => {
          const profiles = s.profiles.filter((p) => p.id !== id);
          const activeProfileId =
            s.activeProfileId === id ? (profiles[0]?.id ?? null) : s.activeProfileId;
          return { profiles, activeProfileId };
        }),
      getActiveProfile: () => {
        const { profiles, activeProfileId } = get();
        return profiles.find((p) => p.id === activeProfileId);
      },

      recent: [],
      upsertRecent: (doc) =>
        set((s) => {
          const exists = s.recent.some((d) => d.id === doc.id);
          const recent = exists
            ? s.recent.map((d) => (d.id === doc.id ? { ...d, ...doc } : d))
            : [doc, ...s.recent];
          return { recent: recent.slice(0, 50) };
        }),
      removeRecent: (id) =>
        set((s) => ({ recent: s.recent.filter((d) => d.id !== id) })),
      togglePin: (id) =>
        set((s) => ({
          recent: s.recent.map((d) =>
            d.id === id ? { ...d, pinned: !d.pinned } : d
          ),
        })),
      touchRecent: (id) =>
        set((s) => ({
          recent: s.recent.map((d) =>
            d.id === id ? { ...d, openedAt: Date.now() } : d
          ),
        })),

      autosaveMs: 4000,
      defaultFontSize: 16,
      pageWidth: "normal",
      showThinking: true,
      openTabs: [],
      splitView: false,
      keybindings: {
        selectionChat: "Ctrl+P",
        splitView: "Ctrl+\\",
      },
      addTab: (id) =>
        set((s) =>
          s.openTabs.includes(id)
            ? s
            : { openTabs: [id, ...s.openTabs].slice(0, 12) }
        ),
      removeTab: (id) => set((s) => ({ openTabs: s.openTabs.filter((x) => x !== id) })),
      setSplitView: (v) => set({ splitView: v }),
      setKeybinding: (k, v) => set((s) => ({ keybindings: { ...s.keybindings, [k]: v } })),
      setSetting: (k, v) => set({ [k]: v } as Partial<AppState>),
    }),
    {
      name: "wore.settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        theme: s.theme,
        profiles: s.profiles,
        activeProfileId: s.activeProfileId,
        recent: s.recent,
        autosaveMs: s.autosaveMs,
        defaultFontSize: s.defaultFontSize,
        pageWidth: s.pageWidth,
        showThinking: s.showThinking,
        openTabs: s.openTabs,
        splitView: s.splitView,
        keybindings: s.keybindings,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    }
  )
);

/** Ensure all preset profiles exist (for new app versions). */
export function ensureProfilesExist() {
  const profiles = useStore.getState().profiles;
  const updatedProfiles = ensureProfiles(profiles);
  if (updatedProfiles.length !== profiles.length) {
    useStore.setState({ profiles: updatedProfiles });
  }
}

/** Wire up system theme changes when in "system" mode. */
export function initThemeWatcher() {
  applyTheme(useStore.getState().theme);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    if (useStore.getState().theme === "system") applyTheme("system");
  });
}

/** Count words in an HTML/markdown string (rough). */
export function countWords(text: string): number {
  const clean = text
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_`>~\-]/g, " ")
    .trim();
  if (!clean) return 0;
  return clean.split(/\s+/).filter(Boolean).length;
}
