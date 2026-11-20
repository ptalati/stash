import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { quickKeys, type Snippet } from "./snippet";
import { fill, prepare, type Prepared } from "./template";

type Mode = "paste" | "copy";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const q = $<HTMLInputElement>("q");
const list = $<HTMLUListElement>("list");
const section = $("section");
const empty = $("empty");
const count = $("count");
const errorEl = $("error");
const viewList = $("view-list");
const viewFill = $("view-fill");
const fillName = $("fill-name");
const fillProgress = $("fill-progress");
const fillFields = $<HTMLFormElement>("fill-fields");
const fillPreview = $("fill-preview");
const fillAction = $("fill-action");
const fillError = $("fill-error");

let all: Snippet[] = [];
let shown: Snippet[] = [];
let sel = 0;
let revealed = new Set<string>();
let pendingAlt: Snippet | null = null;
let keys = new Map<string, number>();
let fillIn = new Set<string>(); // ids of snippets that ask questions

interface FillState {
  snippet: Snippet;
  p: Prepared;
  mode: Mode;
  values: Map<string, string>;
  inputs: HTMLInputElement[];
  current: string | null;
  warnedEmpty: boolean;
}
let form: FillState | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function tagFor(s: Snippet) {
  const words = s.name.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  if (!words.length) return "·";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

// ---------------- list view ----------------

/** Lower score is better; null means no match. Sensitive bodies are never searched. */
function score(s: Snippet, term: string): number | null {
  const name = s.name.toLowerCase();
  if (name.startsWith(term)) return 0;
  if (s.keywords.some((k) => k.toLowerCase().startsWith(term))) return 1;
  if (name.includes(term)) return 2;
  if (s.keywords.some((k) => k.toLowerCase().includes(term))) return 3;
  if (!s.sensitive && s.body.toLowerCase().includes(term)) return 4;
  return null;
}

function filter() {
  const term = q.value.trim().toLowerCase();
  if (!term) {
    shown = [...all].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    section.textContent = keys.size ? "Pinned first" : "All snippets";
  } else {
    shown = all
      .map((s) => ({ s, sc: score(s, term) }))
      .filter((x) => x.sc !== null)
      .sort((a, b) => a.sc! - b.sc! || a.s.name.localeCompare(b.s.name))
      .map((x) => x.s);
    section.textContent = "Results";
  }
  count.textContent = term ? `${shown.length} match${shown.length === 1 ? "" : "es"}` : "";
  sel = Math.min(sel, Math.max(shown.length - 1, 0));
  render();
}

function render() {
  list.replaceChildren();
  empty.hidden = shown.length > 0;
  shown.forEach((s, i) => {
    const li = el("li", "row");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === sel));
    li.append(el("div", "tag", tagFor(s)));

    const body = el("div", "body");
    const name = el("div", "name", s.name);
    if (fillIn.has(s.id)) name.append(el("span", "badge fill", "FILL-IN"));
    if (s.sensitive) name.append(el("span", "badge", "SENSITIVE"));
    body.append(name);

    const masked = s.sensitive && !revealed.has(s.id);
    const expand = i === sel && !masked && s.body.includes("\n");
    body.append(el("div", expand ? "preview full" : "preview", masked ? "•••• hidden — Tab to show" : s.body));
    li.append(body);

    const k = keys.get(s.id);
    if (k) {
      const kb = el("span", "muted");
      kb.append(el("kbd", undefined, "Alt"), " ", el("kbd", undefined, String(k)));
      li.append(kb);
    }
    li.addEventListener("mousemove", () => { if (sel !== i) { sel = i; render(); } });
    li.addEventListener("click", () => act(s, "paste"));
    list.append(li);
  });
  list.children[sel]?.scrollIntoView({ block: "nearest" });
}

// ---------------- paste / copy ----------------

async function send(mode: Mode, text: string, sensitive: boolean, errTarget: HTMLElement) {
  try {
    await invoke(mode === "paste" ? "paste_snippet" : "copy_snippet", { text, sensitive });
  } catch (e) {
    errTarget.textContent = String(e);
  }
}

/** Paste or copy a snippet: straight away if it has no fields, else ask first. */
function act(s: Snippet, mode: Mode) {
  errorEl.textContent = "";
  let p: Prepared;
  try {
    p = prepare(s, all);
  } catch (e) {
    errorEl.textContent = (e as Error).message;
    return;
  }
  if (p.fields.length === 0) send(mode, fill(p, new Map()), p.sensitive, errorEl);
  else openForm(s, p, mode);
}

// ---------------- fill-in view ----------------

function openForm(snippet: Snippet, p: Prepared, mode: Mode) {
  const values = new Map(p.fields.map((f) => [f.key, f.initial]));
  const inputs = p.fields.map((f) => {
    const label = el("label", undefined, f.label);
    const input = el("input");
    input.value = f.initial;
    input.dataset.key = f.key;
    input.spellcheck = false;
    input.addEventListener("input", () => {
      values.set(f.key, input.value);
      if (form) form.warnedEmpty = false;
      fillError.textContent = "";
      renderPreview();
    });
    input.addEventListener("focus", () => {
      if (!form) return;
      form.current = f.key;
      fillProgress.textContent = `Field ${form.inputs.indexOf(input) + 1} of ${form.inputs.length}`;
      renderPreview();
    });
    label.append(input);
    return { label, input };
  });
  fillFields.replaceChildren(...inputs.map((x) => x.label));
  form = { snippet, p, mode, values, inputs: inputs.map((x) => x.input), current: null, warnedEmpty: false };

  fillName.textContent = snippet.name;
  fillAction.textContent = mode === "paste" ? "Paste" : "Copy";
  fillError.textContent = "";
  viewList.hidden = true;
  viewFill.hidden = false;
  const firstEmpty = form.inputs.find((i) => !i.value) ?? form.inputs[0];
  firstEmpty.focus();
  firstEmpty.select();
}

function closeForm() {
  form = null;
  viewFill.hidden = true;
  viewList.hidden = false;
  q.focus();
}

function renderPreview() {
  if (!form) return;
  const { p, values, current } = form;
  const out: Node[] = [];
  let lastSecret: string | null = null;
  for (const g of p.segs) {
    if (g.t === "text") {
      if (g.secretFrom) {
        // One masked chip per run of sensitive text, named after its snippet.
        if (lastSecret !== g.secretFrom) out.push(el("span", "secret", `•••• ${g.secretFrom}`));
        lastSecret = g.secretFrom;
      } else {
        out.push(document.createTextNode(g.text));
        lastSecret = null;
      }
    } else {
      const v = values.get(g.key) ?? "";
      const label = p.fields.find((f) => f.key === g.key)?.label ?? g.key;
      const span = el("span", `field${v ? "" : " blank"}${g.key === current ? " current" : ""}`, v || `{${label}}`);
      out.push(span);
      lastSecret = null;
    }
  }
  fillPreview.replaceChildren(...out);
}

function submitForm() {
  if (!form) return;
  const blanks = form.inputs.filter((i) => !i.value.trim());
  if (blanks.length && !form.warnedEmpty) {
    form.warnedEmpty = true;
    fillError.textContent = `${blanks.length} empty — Enter again to ${form.mode} anyway`;
    blanks[0].focus();
    return;
  }
  const { p, values, mode } = form;
  send(mode, fill(p, values), p.sensitive, fillError);
}

function moveField(delta: number) {
  if (!form) return;
  const i = form.inputs.indexOf(document.activeElement as HTMLInputElement);
  const n = form.inputs.length;
  const next = form.inputs[((i < 0 ? 0 : i + delta) % n + n) % n];
  next.focus();
  next.select();
}

function onFormKey(e: KeyboardEvent) {
  switch (e.key) {
    case "Enter":
      e.preventDefault();
      submitForm();
      break;
    case "Tab":
      e.preventDefault();
      moveField(e.shiftKey ? -1 : 1);
      break;
    case "Escape":
      e.preventDefault();
      closeForm();
      break;
  }
}

// ---------------- loading ----------------

async function reload() {
  errorEl.textContent = "";
  try {
    all = await invoke<Snippet[]>("list_snippets");
  } catch (e) {
    all = [];
    errorEl.textContent = String(e);
  }
  keys = quickKeys(all);
  fillIn = new Set(
    all.filter((s) => { try { return prepare(s, all).fields.length > 0; } catch { return false; } }).map((s) => s.id),
  );
  if (form) closeForm();
  q.value = "";
  sel = 0;
  revealed = new Set();
  filter();
  q.focus();
}

// ---------------- keys ----------------

q.addEventListener("input", () => { sel = 0; filter(); });

document.addEventListener("keydown", (e) => {
  if (form) return onFormKey(e);
  const cur = shown[sel];
  if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
    e.preventDefault();
    const n = Number(e.code.slice(5));
    pendingAlt = all.find((s) => keys.get(s.id) === n) ?? null;
    return;
  }
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      if (shown.length) { sel = (sel + 1) % shown.length; render(); }
      break;
    case "ArrowUp":
      e.preventDefault();
      if (shown.length) { sel = (sel - 1 + shown.length) % shown.length; render(); }
      break;
    case "Enter":
      e.preventDefault();
      if (cur) act(cur, "paste");
      break;
    case "Tab":
      e.preventDefault();
      if (cur?.sensitive) {
        revealed.has(cur.id) ? revealed.delete(cur.id) : revealed.add(cur.id);
        render();
      }
      break;
    case "Escape":
      e.preventDefault();
      invoke("hide_palette");
      break;
    default:
      if (e.ctrlKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        invoke("manage_snippets", { select: cur?.id ?? null });
        break;
      }
      // Ctrl+C copies the snippet unless the user has text selected in the search box.
      if (e.ctrlKey && e.key.toLowerCase() === "c" && cur && q.selectionStart === q.selectionEnd) {
        e.preventDefault();
        act(cur, "copy");
      }
  }
});

// Alt+N acts on Alt release, so Alt isn't still held when Ctrl+V is sent.
document.addEventListener("keyup", (e) => {
  if (e.key === "Alt" && pendingAlt) {
    e.preventDefault();
    const s = pendingAlt;
    pendingAlt = null;
    act(s, "paste");
  }
});

listen("palette-opened", reload);
getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  if (!focused) invoke("hide_palette");
});

reload();
