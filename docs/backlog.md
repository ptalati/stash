# Stash backlog

## Done (scaffold, 2026-11-20)
- Tauri 2 app, tray icon, single instance, launch-at-sign-in toggle.
- Global hotkey Ctrl+Shift+Space opens the palette on the monitor under the mouse.
- Search over name and keywords (and body, except sensitive snippets); pinned first.
- Enter pastes into the previous window (focus restore + Ctrl+V), then restores your old clipboard.
- Ctrl+C copies only; sensitive copies are cleared after 30 s.
- Sensitive snippets: masked (Tab to show), excluded from Win+V history and cloud clipboard.
- Store encrypted with DPAPI; seeded with placeholder snippets on first run.
- Stopgap editing: tray › "Import import.json" (array of snippets) from the data folder.

## Done (manager window)
- Tray › "Manage snippets…" or Ctrl+E in the palette (opens on the selected snippet).
- Sidebar: All / Pinned / Sensitive / each group, with counts. Filter box over the list.
- Editor: name, group (suggests existing groups), keywords, body, Pinned, Sensitive (body masked, Show to peek).
- Move up/down sets the order, and so the Alt+1…9 numbers. Two-click Delete.
- Autosaves 400 ms after each change (Ctrl+S saves now); flushes on close. Ctrl+N new, Ctrl+F filter.

## Done (fill-in fields)
- `{field}` asks before pasting (same name twice = one question); `{today}` is pre-filled with the date.
- `{{Snippet name}}` or `{{id}}` embeds another snippet; nesting allowed, loops and missing names are errors.
- Embedding a sensitive snippet makes the result sensitive; previews mask it as "•••• <name>".
- Palette: FILL-IN badge, form with live preview, Tab cycles fields, Enter pastes (asks once more if fields are empty), Esc back.
- Manager shows "Asks for … · Embeds …" or the error under the body. Parser in src/template.ts.
- New installs get a "Payment reminder (polite)" seed template.

## v1 still to do
1. **Hotkey conflict UX**: tell the user (tray balloon) if Ctrl+Shift+Space is taken, and let them pick another.
2. Error surfacing for import (currently only stderr).
3. Unit tests for src/template.ts in the repo (checked ad hoc with node so far).
4. Release workflow (copy World Clock's .github/workflows/release.yml), README, LICENSE.

## Later
- Text expansion (`;gst`) as opt-in per non-sensitive snippet.
- macOS/Linux: keychain storage, paste via CGEvent / xdotool.
