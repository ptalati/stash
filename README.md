# Stash

A hotkey snippet palette for Windows. Press **Ctrl+Shift+Space**, type a few letters, press **Enter**, and the snippet is pasted into the app you were using.

For the text you reuse all the time: GST number, bank details for invoices, reply templates. It is not a clipboard history (Win+V already does that).

- **Enter** paste · **Ctrl+C** copy only · **Tab** show/hide a sensitive snippet · **Alt+1…9** paste a pinned snippet · **Esc** close
- Snippets are stored encrypted with Windows DPAPI, readable only by your Windows account.
- Sensitive snippets are masked in the palette and kept out of Win+V history.

## Install

Windows only for now. Get `Stash_x.y.z_x64-setup.exe` (or the `.msi`) from the [Releases page](https://github.com/ptalati/stash/releases/latest).

The builds aren't code-signed yet, so the first launch shows SmartScreen's "Windows protected your PC". Click **More info**, then **Run anyway**.

Stash lives in the tray. Right-click its icon for **Manage snippets…** and **Launch at sign-in**.

## Fill-in templates

In a snippet's text:

| Write | Does |
|---|---|
| `{client}` | Asks for a value before pasting. Use the same name twice, get asked once. |
| `{today}` | Today's date, pre-filled (you can still change it). |
| `{{Bank details}}` | Inserts another snippet, by name. A sensitive one makes the whole paste sensitive. |
| `\{` `\}` | A literal brace. |

## Develop

```powershell
pnpm install
.\dev.ps1
```

`pnpm tauri build` makes the installers in `src-tauri/target/release/bundle`.

To release: bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` (the workflow refuses a tag that doesn't match all three), commit, then push a tag like `v0.1.0`. GitHub Actions builds the installers and publishes the release (`.github/workflows/release.yml`).

Built with Tauri 2 and vanilla TypeScript.
