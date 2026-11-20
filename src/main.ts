import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Snippet } from "./snippet";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const q = $<HTMLInputElement>("q");
const list = $<HTMLUListElement>("list");
const section = $("section");
const empty = $("empty");
const count = $("count");
const errorEl = $("error");

let all: Snippet[] = [];
let shown: Snippet[] = [];
let sel = 0;
let revealed = new Set<string>();
let pendingAlt: Snippet | null = null;

const pinned = () => all.filter((s) => s.pinned).slice(0, 9);
const quickKey = (s: Snippet) => {
  const i = pinned().indexOf(s);
  return i >= 0 ? String(i + 1) : "";
};

function tagFor(s: Snippet) {
  const words = s.name.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

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
    section.textContent = pinned().length ? "Pinned first" : "All snippets";
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
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
    if (s.sensitive) name.append(el("span", "badge", "SENSITIVE"));
    body.append(name);

    const masked = s.sensitive && !revealed.has(s.id);
    const expand = i === sel && !masked && s.body.includes("\n");
    body.append(el("div", expand ? "preview full" : "preview", masked ? "•••• hidden — Tab to show" : s.body));
    li.append(body);

    const k = quickKey(s);
    if (k) {
      const keys = el("span", "muted");
      keys.append(el("kbd", undefined, "Alt"), " ", el("kbd", undefined, k));
      li.append(keys);
    }
    li.addEventListener("mousemove", () => { if (sel !== i) { sel = i; render(); } });
    li.addEventListener("click", () => paste(s));
    list.append(li);
  });
  list.children[sel]?.scrollIntoView({ block: "nearest" });
}

async function paste(s: Snippet) {
  await run("paste_snippet", s);
}

async function copy(s: Snippet) {
  await run("copy_snippet", s);
}

async function run(cmd: string, s: Snippet) {
  try {
    await invoke(cmd, { text: s.body, sensitive: s.sensitive });
  } catch (e) {
    errorEl.textContent = String(e);
  }
}

async function reload() {
  errorEl.textContent = "";
  try {
    all = await invoke<Snippet[]>("list_snippets");
  } catch (e) {
    all = [];
    errorEl.textContent = String(e);
  }
  q.value = "";
  sel = 0;
  revealed = new Set();
  filter();
  q.focus();
}

q.addEventListener("input", () => { sel = 0; filter(); });

document.addEventListener("keydown", (e) => {
  const cur = shown[sel];
  if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
    e.preventDefault();
    pendingAlt = pinned()[Number(e.code.slice(5)) - 1] ?? null;
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
      if (cur) paste(cur);
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
        copy(cur);
      }
  }
});

// Alt+N pastes on Alt release, so Alt isn't still held when Ctrl+V is sent.
document.addEventListener("keyup", (e) => {
  if (e.key === "Alt" && pendingAlt) {
    e.preventDefault();
    const s = pendingAlt;
    pendingAlt = null;
    paste(s);
  }
});

listen("palette-opened", reload);
getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  if (!focused) invoke("hide_palette");
});

reload();
