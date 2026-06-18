# WoRe - AI panel & editor fixes checklist

> Temporary task tracker. Check off each item only after implementing AND
> verifying `bun run typecheck` + `bun run build` pass.

- [x] 1. **Sidebar AI: word-wrap** - long words/URLs in assistant bubbles must wrap, never overflow the frame (`break-words` + `min-w-0`).
- [x] 2. **Every message copyable** - add a Copy button to both user and assistant message bubbles.
- [x] 3. **Fullscreen AI modal** - maximize button in AI header; opens as a modal over a slightly blurred background. Same panel content, just bigger.
- [x] 4. **Regenerate assistant reply** - after deleting an assistant message while its user message remains, offer a Regenerate action that re-runs that turn.
- [x] 5. **Persistent conversations** - chats survive an app update/reinstall. Migrate chat storage from `localStorage` to IndexedDB (durable, same store docs already use).
- [x] 6. **Thinking animation inside the assistant bubble** - move the "Thinking..." spinner out of the message-list gutter and into the last assistant bubble.
- [x] 7. **Paste images** — pasting an image inserts the real image (data URL), not a broken/placeholder icon. Text paste still works.
- [x] 8. **Image resize handles** — visible drag handles (points) on the selected image so it can be resized by dragging.
- [x] 9. **Pasted images auto-fit** — any pasted/inserted image is sized smaller than the document width on insert.
- [ ] 10. **Bump version, commit, push, build** — bump `src-tauri/tauri.conf.json` + `package.json`, commit, push, run `bun run build` to verify.

## Verification (run after all changes)
- [x] `bun run typecheck` passes
- [x] `bun run build` passes
- [ ] Quick manual sanity: no obvious compile breakage in changed files
