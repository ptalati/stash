import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { quickKeys, type Snippet } from "./snippet";
import { prepare } from "./template";

type Filter = { kind: "all" } | { kind: "pinned" } | { kind: "sensitive" } | { kind: "group"; name: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  status: $("status"),
  groups: $<HTMLUListElement>("groups"),
  search: $<HTMLInputElement>("search"),
  list: $<HTMLUListElement>("list"),
  listEmpty: $("list-empty"),
  editor: $("editor"),
  editorEmpty: $("editor-empty"),
  groupOptions: $<HTMLDataListElement>("group-options"),
  name: $<HTMLInputElement>("f-name"),
  group: $<HTMLInputElement>("f-group"),
  keywords: $<HTMLInputElement>("f-keywords"),
  body: $<HTMLTextAreaElement>("f-body"),
  bodyInfo: $("body-info"),
  reveal: $<HTMLButtonElement>("reveal"),
  pinned: $<HTMLInputElement>("f-pinned"),
  sensitive: $<HTMLInputElement>("f-sensitive"),
  quick: $("quick"),
  up: $<HTMLButtonElement>("up"),
  down: $<HTMLButtonElement>("down"),
  del: $<HTMLButtonElement>("delete"),
};

let snippets: Snippet[] = [];
let selectedId: string | null = null;
let filter: Filter = { kind: "all" };
let revealed = false;
let saveTimer: number | undefined;
let saving: Promise<void> | null = null;
let deleteArmed = false;

const selected = () => snippets.find((s) => s.id === selectedId) ?? null;
const groupLabel = (g: string) => g.trim() || "Ungrouped";
const sameFilter = (a: Filter, b: Filter) =>
  a.kind === b.kind && (a.kind !== "group" || (b.kind === "group" && a.name === b.name));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setStatus(text: string, isError = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("error", isError);
}

// ---------- saving ----------

function scheduleSave() {
  setStatus("Unsaved changes…");
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flush, 400);
}

async function flush() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const p = invoke<void>("save_snippets", { snippets })
    .then(() => setStatus("Saved"))
    .catch((e) => setStatus(`Not saved: ${e}`, true));
  saving = p;
  await p;
  if (saving === p) saving = null;
}

// ---------- filtering ----------

function matches(s: Snippet): boolean {
  if (filter.kind === "pinned" && !s.pinned) return false;
  if (filter.kind === "sensitive" && !s.sensitive) return false;
  if (filter.kind === "group" && groupLabel(s.group) !== filter.name) return false;
  const term = ui.search.value.trim().toLowerCase();
  if (!term) return true;
  return (
    s.name.toLowerCase().includes(term) ||
    s.group.toLowerCase().includes(term) ||
    s.keywords.some((k) => k.toLowerCase().includes(term)) ||
    (!s.sensitive && s.body.toLowerCase().includes(term))
  );
}

// ---------- rendering ----------

function renderGroups() {
  const counts = new Map<string, number>();
  snippets.forEach((s) => counts.set(groupLabel(s.group), (counts.get(groupLabel(s.group)) ?? 0) + 1));
  ui.groupOptions.replaceChildren(
    ...[...counts.keys()].filter((g) => g !== "Ungrouped").sort().map((g) => {
      const o = document.createElement("option");
      o.value = g;
      return o;
    }),
  );

  const item = (label: string, n: number, f: Filter) => {
    const li = el("li");
    const b = el("button");
    b.type = "button";
    b.append(el("span", undefined, label), el("span", "n", String(n)));
    b.setAttribute("aria-current", String(sameFilter(filter, f)));
    b.addEventListener("click", () => { filter = f; render(); });
    li.append(b);
    return li;
  };

  const rows: HTMLElement[] = [
    item("All", snippets.length, { kind: "all" }),
    item("Pinned", snippets.filter((s) => s.pinned).length, { kind: "pinned" }),
    item("Sensitive", snippets.filter((s) => s.sensitive).length, { kind: "sensitive" }),
  ];
  if (counts.size) rows.push(el("li", "sep"));
  [...counts.entries()]
    .sort(([a], [b]) => (a === "Ungrouped" ? 1 : b === "Ungrouped" ? -1 : a.localeCompare(b)))
    .forEach(([g, n]) => rows.push(item(g, n, { kind: "group", name: g })));
  ui.groups.replaceChildren(...rows);
}

function renderList() {
  const keys = quickKeys(snippets);
  const shown = snippets.filter(matches);
  ui.list.replaceChildren(
    ...shown.map((s) => {
      const li = el("li");
      const b = el("button");
      b.type = "button";
      b.setAttribute("aria-current", String(s.id === selectedId));
      const name = el("span", "name", s.name || "Untitled");
      if (s.sensitive) name.append(el("span", "badge", "SENSITIVE"));
      const meta = [groupLabel(s.group)];
      if (s.pinned) meta.push(keys.has(s.id) ? `Pinned · Alt ${keys.get(s.id)}` : "Pinned");
      b.append(name, el("span", "meta", meta.join(" · ")));
      b.addEventListener("click", () => select(s.id));
      li.append(b);
      return li;
    }),
  );
  ui.listEmpty.hidden = shown.length > 0;
  ui.listEmpty.textContent = snippets.length ? "Nothing matches this filter." : "No snippets yet.";
  ui.list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
}

/** Fill the form from the selected snippet. Only called when the selection changes,
 *  so typing never re-renders the field being edited. */
function renderEditor() {
  const s = selected();
  ui.editor.hidden = !s;
  ui.editorEmpty.hidden = !!s;
  disarmDelete();
  if (!s) return;
  ui.name.value = s.name;
  ui.group.value = s.group;
  ui.keywords.value = s.keywords.join(", ");
  ui.body.value = s.body;
  ui.pinned.checked = s.pinned;
  ui.sensitive.checked = s.sensitive;
  revealed = false;
  renderEditorState();
}

/** The parts of the editor that depend on flags or position, safe to refresh any time. */
function renderEditorState() {
  const s = selected();
  if (!s) return;
  const masked = s.sensitive && !revealed;
  ui.body.classList.toggle("masked", masked);
  ui.reveal.hidden = !s.sensitive;
  ui.reveal.textContent = revealed ? "Hide" : "Show";
  const k = quickKeys(snippets).get(s.id);
  ui.quick.textContent = s.pinned ? (k ? `(Alt+${k})` : "(no Alt key: only the first 9 pinned get one)") : "";
  const i = snippets.indexOf(s);
  ui.up.disabled = i <= 0;
  ui.down.disabled = i === snippets.length - 1;
  renderBodyInfo(s);
}

/** Under the body: what this snippet will ask for and embed, or why it's broken. */
function renderBodyInfo(s: Snippet) {
  const code = (t: string) => el("code", undefined, t);
  ui.bodyInfo.classList.remove("error");
  try {
    const p = prepare(s, snippets);
    const parts: (string | Node)[] = [];
    if (p.fields.length) {
      parts.push("Asks for: ", p.fields.map((f) => f.label).join(", "));
    }
    if (p.embeds.length) {
      if (parts.length) parts.push(" · ");
      parts.push("Embeds: ", p.embeds.join(", "));
      if (p.sensitive && !s.sensitive) parts.push(" (sensitive, so this pastes as sensitive)");
    }
    if (!parts.length) {
      parts.push("Write ", code("{client}"), " to be asked before pasting, ", code("{today}"),
        " for the date, ", code("{{Snippet name}}"), " to include another snippet.");
    }
    ui.bodyInfo.replaceChildren(...parts);
  } catch (e) {
    ui.bodyInfo.classList.add("error");
    ui.bodyInfo.textContent = (e as Error).message;
  }
}

function render() {
  renderGroups();
  renderList();
  renderEditorState();
}

// ---------- actions ----------

function select(id: string | null) {
  selectedId = id;
  render();
  renderEditor();
}

function update(patch: Partial<Snippet>, listToo = true) {
  const s = selected();
  if (!s) return;
  Object.assign(s, patch);
  if (listToo) render(); else renderEditorState();
  scheduleSave();
}

function newSnippet() {
  const id = `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const group = filter.kind === "group" && filter.name !== "Ungrouped" ? filter.name : "";
  snippets.push({ id, name: "New snippet", body: "", keywords: [], group, pinned: filter.kind === "pinned", sensitive: filter.kind === "sensitive" });
  ui.search.value = "";
  select(id);
  scheduleSave();
  ui.name.focus();
  ui.name.select();
}

function move(delta: number) {
  const s = selected();
  if (!s) return;
  const i = snippets.indexOf(s);
  const j = i + delta;
  if (j < 0 || j >= snippets.length) return;
  [snippets[i], snippets[j]] = [snippets[j], snippets[i]];
  render();
  scheduleSave();
}

function disarmDelete() {
  deleteArmed = false;
  ui.del.textContent = "Delete";
  ui.del.classList.remove("armed");
}

function deleteSelected() {
  const s = selected();
  if (!s) return;
  if (!deleteArmed) {
    deleteArmed = true;
    ui.del.textContent = `Delete “${s.name}”? Click again`;
    ui.del.classList.add("armed");
    return;
  }
  const i = snippets.indexOf(s);
  snippets.splice(i, 1);
  const next = snippets.filter(matches)[0] ?? null;
  select(next?.id ?? null);
  scheduleSave();
}

// ---------- wiring ----------

ui.name.addEventListener("input", () => update({ name: ui.name.value }));
ui.group.addEventListener("input", () => update({ group: ui.group.value.trim() }));
ui.keywords.addEventListener("input", () =>
  update({ keywords: ui.keywords.value.split(",").map((k) => k.trim()).filter(Boolean) }),
);
ui.body.addEventListener("input", () => update({ body: ui.body.value }));
ui.pinned.addEventListener("change", () => update({ pinned: ui.pinned.checked }));
ui.sensitive.addEventListener("change", () => update({ sensitive: ui.sensitive.checked }));
ui.reveal.addEventListener("click", () => { revealed = !revealed; renderEditorState(); });
ui.up.addEventListener("click", () => move(-1));
ui.down.addEventListener("click", () => move(1));
ui.del.addEventListener("click", deleteSelected);
ui.del.addEventListener("blur", disarmDelete);
$("new").addEventListener("click", newSnippet);
ui.search.addEventListener("input", renderList);

document.addEventListener("keydown", (e) => {
  if (!e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === "n") { e.preventDefault(); newSnippet(); }
  if (k === "f") { e.preventDefault(); ui.search.focus(); ui.search.select(); }
  if (k === "s") { e.preventDefault(); flush(); }
});

// Write any pending change before the window closes.
getCurrentWindow().onCloseRequested(async () => {
  if (saveTimer !== undefined) await flush();
  else if (saving) await saving;
});

listen<string>("manager-select", (e) => {
  filter = { kind: "all" };
  ui.search.value = "";
  select(snippets.some((s) => s.id === e.payload) ? e.payload : selectedId);
});

listen("snippets-changed", load);

// ---------- palette hotkey ----------

interface HotkeyInfo { label: string; problem: string | null }

const hk = {
  button: $<HTMLButtonElement>("hotkey"),
  banner: $("hotkey-banner"),
  problem: $("hotkey-problem"),
  fix: $<HTMLButtonElement>("hotkey-fix"),
};
let hkInfo: HotkeyInfo = { label: "", problem: null };
let recording = false;

function renderHotkey() {
  hk.button.classList.toggle("recording", recording);
  hk.button.textContent = recording ? "Press keys… (Esc cancels)" : hkInfo.problem ? "Not set" : hkInfo.label;
  // Windows delivers a combination another app has registered to that app, so the page never
  // sees it: nothing happening is the only sign. Say so while recording.
  if (recording) {
    setStatus("Press the new combination. If nothing happens, another app already uses it: try a different one.");
  }
  hk.banner.hidden = !hkInfo.problem;
  hk.problem.textContent = hkInfo.problem ?? "";
}

function startRecording() {
  recording = true;
  renderHotkey();
  hk.button.focus();
}

const MOD_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"]);

/** Turn a keydown into the plugin's accelerator ("ctrl+alt+KeyV") and a label ("Ctrl+Alt+V"). */
function comboFrom(e: KeyboardEvent): { accel: string; label: string } | null {
  if (MOD_KEYS.has(e.key)) return null; // still holding modifiers
  const mods: [boolean, string, string][] = [
    [e.ctrlKey, "ctrl", "Ctrl"],
    [e.altKey, "alt", "Alt"],
    [e.shiftKey, "shift", "Shift"],
  ];
  const on = mods.filter(([down]) => down);
  const keyLabel = e.code.replace(/^Key/, "").replace(/^Digit/, "");
  return {
    accel: [...on.map(([, a]) => a), e.code].join("+"),
    label: [...on.map(([, , l]) => l), keyLabel].join("+"),
  };
}

hk.button.addEventListener("click", startRecording);
hk.fix.addEventListener("click", startRecording);
hk.button.addEventListener("blur", () => { if (recording) { recording = false; renderHotkey(); } });

// Capture phase, so the manager's own Ctrl+N / Ctrl+F shortcuts don't fire while recording.
document.addEventListener(
  "keydown",
  async (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { recording = false; renderHotkey(); return; }
    const combo = comboFrom(e);
    if (!combo) return;
    if (!e.ctrlKey && !e.altKey) {
      setStatus("Include Ctrl or Alt, so normal typing never opens the palette.", true);
      return;
    }
    recording = false;
    try {
      hkInfo = await invoke<HotkeyInfo>("set_hotkey", combo);
      setStatus(`Palette hotkey is now ${hkInfo.label}`);
    } catch (err) {
      setStatus(String(err), true);
    }
    renderHotkey();
  },
  true,
);

invoke<HotkeyInfo>("get_hotkey").then((info) => { hkInfo = info; renderHotkey(); });

// ---------- import results ----------

interface Notice { ok: boolean; text: string; offerFolder: boolean }

const nt = {
  bar: $("notice"),
  text: $("notice-text"),
  folder: $<HTMLButtonElement>("notice-folder"),
  close: $<HTMLButtonElement>("notice-close"),
};

function showNotice(n: Notice | null) {
  nt.bar.hidden = !n;
  if (!n) return;
  nt.bar.classList.toggle("bad", !n.ok);
  nt.text.textContent = n.text;
  nt.folder.hidden = !n.offerFolder;
}

async function runImport() {
  // Write pending edits first, so the import merges into the latest list.
  if (saveTimer !== undefined) await flush();
  else if (saving) await saving;
  showNotice(await invoke<Notice>("import_snippets"));
}

$("import").addEventListener("click", runImport);
nt.folder.addEventListener("click", () => invoke("open_data_folder"));
nt.close.addEventListener("click", () => showNotice(null));
listen<Notice>("notice", (e) => showNotice(e.payload));
// The tray's Import may have run before this window existed.
invoke<Notice | null>("take_notice").then((n) => { if (n) showNotice(n); });

async function load() {
  try {
    snippets = await invoke<Snippet[]>("list_snippets");
    setStatus("");
  } catch (e) {
    snippets = [];
    setStatus(`Couldn't read snippets: ${e}`, true);
  }
  const want = new URLSearchParams(location.search).get("select");
  const id = snippets.find((s) => s.id === (selectedId ?? want))?.id ?? snippets[0]?.id ?? null;
  select(id);
}

load();
