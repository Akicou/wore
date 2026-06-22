# WoRe

WoRe is a local-first document editor for Windows, built with Tauri, React, and TypeScript. It supports DOCX, PDF, PowerPoint (PPTX), Markdown, HTML, and plain text, with an assistant panel for document-aware AI workflows.

The application is designed for users who want to work with documents locally while connecting to their own AI provider or local model server.

## Current status

WoRe is under active development. Core editing, import/export, AI chat, local model support, and Windows installer builds are functional, but some DOCX fidelity work remains.

## Download

Get the latest installer for your platform from the public downloads page — it always points at the newest release, so you only need to bookmark this one link:

**[build.nayhein.com/r/Akicou/wore](https://build.nayhein.com/r/Akicou/wore)**

Windows (`.exe` setup) and Linux (`.AppImage`, `.deb`) builds are published automatically on every release. Source and per-release assets are also on [GitHub Releases](https://github.com/Akicou/wore/releases).

### Known issue to fix

DOCX edit mode and DOCX preview mode can still diverge for complex Word layouts.

Preview mode uses a high-fidelity DOCX renderer. Edit mode is HTML/contenteditable-based, so some Word-specific layout features can differ, especially:

- image positioning and wrapping
- text boxes and shapes
- complex table/layout behavior
- Word-specific paragraph and page layout rules

This is the main known document-fidelity issue that needs future work.

## Features

- Local-first document storage using IndexedDB
- Windows desktop app via Tauri 2
- Import DOCX, PDF, PowerPoint (PPTX/PPT), Markdown, HTML, and text files
- Export to DOCX, PDF print, Markdown, HTML, and text
- PowerPoint viewer with slide thumbnails, speaker notes, a fullscreen presenter mode on a chosen monitor, and an AI assistant that can summarize, outline, and draft notes
- Word-style editing toolbar with formatting, tables, links, images, callouts, and text boxes
- DOCX preview mode using a visual Word renderer
- PDF preview and PDF-to-DOCX conversion path
- Sidebar assistant with live document context
- Selection assistant for rewriting selected text
- AI-generated image insertion
- Multimodal/vision support for compatible models
- Model detection for OpenAI-compatible providers, OpenRouter, Ollama, and LM Studio
- Vision capability probing using a small image test
- Per-document assistant chat history
- Proposed document edits with a diff preview and Accept/Deny controls
- Configurable keybindings
- Native Windows installers: MSI and NSIS `.exe`

## AI providers

WoRe supports OpenAI-compatible and Anthropic-compatible APIs. Presets include:

- OpenAI
- Anthropic
- OpenRouter
- Ollama
- LM Studio
- Custom OpenAI-compatible endpoints

API keys are stored locally. For local endpoints such as LM Studio and Ollama, an API key is not required.

## Development

### Requirements

- Bun
- Rust stable
- Tauri prerequisites for Windows
- Microsoft Visual C++ build tools
- WebView2 runtime

### Install

```bash
bun install
```

### Run web dev server

```bash
bun run dev
```

### Run Tauri dev app

```bash
bun run tauri dev
```

### Typecheck

```bash
bun run typecheck
```

### Build Windows app and installers

```bash
bun run tauri build
```

Build outputs are written to:

```text
src-tauri/target/release/wore.exe
src-tauri/target/release/bundle/msi/
src-tauri/target/release/bundle/nsis/
```

## Project structure

```text
src/
  components/         Shared UI components
  editor/             Editor page, toolbar, AI panel, selection assistant
  presentation/       PowerPoint viewer, presenter window, presentation AI panel
  lib/                AI client, document conversion, storage, utilities
  pages/              Start page
  types/              Local type declarations

src-tauri/
  src/                Tauri commands and native host code
  capabilities/       Tauri permissions
  tauri.conf.json     Native app configuration
```

## Privacy

WoRe is local-first. Documents are stored locally in browser IndexedDB inside the Tauri WebView. AI requests are sent directly from the app to the provider or local endpoint configured by the user. There is no proxy service or telemetry layer in this project.

## License

MIT
