# WoRe

**An agentic document studio by [Nayhein.com](https://nayhein.com).**

Read and edit **PDF**, **DOCX** and **Markdown** with an AI agent living inside the
page. Select any text, press <kbd>Ctrl</kbd>+<kbd>P</kbd>, and rewrite it in place —
using **your own** OpenAI-, Anthropic- or OpenRouter-compatible endpoint.

> WoRe = **Wo**rd + **Re**write (and a nod to *Vellum & reams*).

---

## ✨ Highlights

- **Bring-your-own AI.** Configure multiple *profiles* (OpenAI, Anthropic,
  OpenRouter, Ollama, or any compatible base URL) and switch between them and
  their models in one click.
- **In-place agent.** <kbd>Ctrl</kbd>+<kbd>P</kbd> on a selection opens a mini
  chat *above* the text. Ask “*Shorten this paragraph to 1–3 sentences*” and the
  agent streams an answer with the full document as context — then **Replace**,
  **Insert below**, or **Copy**.
- **Reasoning-aware.** Defaults to a ≥ 16 000-token output budget so thinking /
  reasoning tokens never truncate the answer.
- **Image generation.** Generate visuals via OpenRouter / image models and drop
  them straight into the page.
- **PDF ⇄ DOCX.** Import a PDF, read or render it, and export a clean Word
  document back out.
- **Word / Google-Docs–grade editor.** A rich contenteditable surface with 40+
  formatting controls.
- **Three start options** + a pinned, recently-opened document list.
- **Light / Dark / System** themes with a shadcn/Vercel-inspired, editorial
  *paper & ink* aesthetic.

---

## 🧠 Agentic features

The signature **Ctrl+P selection chat** plus a catalog of 20+ one-click actions:

`Shorten` · `Expand` · `Fix grammar` · `Rewrite clearer` · `Make formal` ·
`Make casual` · `Simplify` · `Summarize` · `To bullet list` · `To paragraph` ·
`Translate` · `Active voice` · `Stronger verbs` · `Add examples` ·
`Generate title` · `Define jargon` · `Action items` · `Outline` ·
`Continue writing` · `Pull-quote` · `Confident tone` · `Clean emojis` ·
`Ask the document` · `Brainstorm` · `Image prompt`.

…plus a document-level **Assistant** panel (summarize, outline, proofread, Q&A).

## 🖋️ Editor features (40+)

Undo/redo · Paragraph · H1–H4 · Quote · Code block · **Bold** · *Italic* ·
Underline · ~~Strikethrough~~ · Inline code · Super/subscript · 8 font families ·
12 sizes · Text colour · Highlight (custom palette) · Bulleted & numbered lists ·
Indent / outdent · Align left/center/right/justify · Links · **Images**
(upload / URL / **AI-generate**) · Tables (visual grid picker) · Text boxes ·
Callouts · Dividers · Emoji · Clear formatting · Zoom ·
Autosave · Word/character count & reading time · Export to PDF/DOCX/MD/HTML/TXT.

---

## 🚀 Getting started

```bash
bun install

# run the web app (http://localhost:1420)
bun run dev

# production web build → dist/
bun run build
bun run preview
```

### Add your AI key

Open the app → **Settings** (⚙) → **AI Profiles** → pick a preset, paste your
API key, and **Set active**. Keys are stored **only on this device**
(`localStorage`). You can also drop a `.env` (see `.env.example`) for local dev.

---

## 🪟 Build the native Windows app (Tauri 2)

WoRe ships as a tiny Tauri 2 shell around the web UI, producing a real
`.msi` / `.exe` (NSIS) installer.

**Prerequisites:** [Rust](https://rustup.rs) (stable), the
[MSVC build tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/),
and [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)
(pre-installed on Windows 10/11).

```bash
# debug native window
bun run tauri dev

# release installer (writes src-tauri/target/release/bundle/)
bun run tauri build
```

The first build downloads & compiles Rust crates (5–15 min). Afterwards you'll
find `WoRe_0.1.0_x64_en-US.msi` and the NSIS `.exe` setup in
`src-tauri/target/release/bundle/`.

> Regenerate the icon set any time with `bunx tauri icon app-icon.png`
> (the source `app-icon.png` is produced by `node scripts/make-icon.mjs`).

---

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> | Open the agent on the current selection *(prints if nothing is selected)* |
| <kbd>Enter</kbd> | Run the agent · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a newline |
| <kbd>Esc</kbd> | Close the selection chat |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Undo / redo |
| <kbd>Ctrl</kbd>+<kbd>B/I/U</kbd> | Bold / italic / underline |

---

## 🏗️ Architecture

```
src/
├── pages/StartPage.tsx        # 3 actions + recents, the landing experience
├── editor/
│   ├── EditorPage.tsx         # layout, top bar, autosave, export, PDF preview
│   ├── WoreEditor.tsx         # contenteditable surface + Ctrl+P hook
│   ├── Toolbar.tsx            # 40+ formatting controls
│   ├── SelectionChat.tsx      # the signature floating agent (Ctrl+P)
│   ├── AIPanel.tsx            # document-level assistant (side panel)
│   ├── ImageGenDialog.tsx     # image generation
│   └── context.ts             # shared editor context
├── components/                # shadcn-style UI primitives (Radix + CVA)
│   └── ui/                    # button, dialog, dropdown, select, popover…
├── lib/
│   ├── ai.ts                  # OpenAI/Anthropic-compatible client + streaming
│   ├── ai-actions.ts          # selection rewrite + doc-Q&A message builders
│   ├── ai-presets.tsx         # the action catalog
│   ├── editor.ts              # formatting commands + selection surgery
│   ├── store.ts               # Zustand: profiles, theme, recents, settings
│   ├── idb.ts                 # IndexedDB document/blob persistence
│   └── documents/             # pdf · docx · markdown · convert · manager
└── index.css                  # Tailwind v4 design tokens (paper & ink)

src-tauri/                     # Rust shell (Window host) — Windows installer
```

**Stack:** Tauri 2 · React 19 · TypeScript · Vite · Tailwind CSS v4 · Radix UI ·
Zustand · pdf.js · mammoth · docx · marked · motion.

---

## Known issue

DOCX edit and Word preview views can still diverge for complex Word layouts.
Preview uses a high-fidelity DOCX renderer, while edit mode is HTML-based; image
positioning, wraps, text boxes, and some Word-specific layout features need more
work to fully match between both views.

---

## 🔒 Privacy

WoRe is local-first. Documents and source files are stored in your browser's
IndexedDB. AI calls go **directly** from your device to the endpoint you
configure — no proxy, no middle server, no telemetry.

---

## 📄 License

MIT © Nayhein.com. See [`LICENSE`](./LICENSE).
