# Stash

A hotkey snippet palette for Windows. Press **Ctrl+Shift+Space**, type a few letters, press **Enter**, and the snippet is pasted into the app you were using.

For the text you reuse all the time: GST number, bank details for invoices, reply templates. It is not a clipboard history (Win+V already does that).

- **Enter** paste · **Ctrl+C** copy only · **Tab** show/hide a sensitive snippet · **Alt+1…9** paste a pinned snippet · **Esc** close
- Snippets are stored encrypted with Windows DPAPI, readable only by your Windows account.
- Sensitive snippets are masked in the palette and kept out of Win+V history.

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

Built with Tauri 2 and vanilla TypeScript.
