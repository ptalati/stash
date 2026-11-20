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

## Done (hotkey conflicts)
- Hotkey stored in `%APPDATA%\com.ptalati.stash\settings.json` (plain JSON, not secret).
- If it can't be registered at startup, the manager opens with an amber banner and "Not set"; tray tooltip says there is no hotkey. Tray left-click still opens the palette.
- Manager top bar: click the hotkey, press a new combination (needs Ctrl or Alt). The old one stays registered if the new one fails. Tray menu shows the current hotkey.
- Limitation: a combination another app holds never reaches Stash at all (Windows routes it to that app), so pressing it while recording does nothing; the status line says to try another. Only apps that register global hotkeys are detected; in-app shortcuts can't be.

## Done (import results)
- Import button in the manager, plus the tray item. Results show in a green/amber bar in the manager (the tray path opens the manager to show it).
- Import merges instead of replacing: same id updates, new ones are added. Only `name` is required; missing ids are made from the name (`bank-details-usd`, then `-2`…).
- On any error nothing changes and import.json is kept so it can be fixed; "Open data folder" button. On success the file is deleted.
- Rust tests in store.rs (`cargo test --lib`).

## v1 still to do
1. Unit tests for src/template.ts in the repo (checked ad hoc with node so far).

## Done (release workflow)
- `.github/workflows/release.yml`: on a `v*` tag, checks the three version files match the tag, builds on windows-latest, publishes the release with the msi and setup.exe. Windows only.

## Later
- Text expansion (`;gst`) as opt-in per non-sensitive snippet.
- macOS/Linux: keychain storage, paste via CGEvent / xdotool.
