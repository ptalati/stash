// Fill-in templates.
//
//   {client}          a field: the palette asks for it before pasting.
//                     Same name twice = one question. Names: letters, digits,
//                     spaces and - _ . / # (so JSON like {"a":1} is left alone).
//   {today}           a field pre-filled with today's date (still editable).
//   {{Bank details}}  embeds another snippet, by name or id. Embeds can nest;
//                     a loop (A embeds B embeds A) is an error, not a hang.
//   \{  \}            literal braces.
//
// If anything embedded is sensitive, the whole result is treated as sensitive.

import type { Snippet } from "./snippet";

export type Seg =
  | { t: "text"; text: string; secretFrom: string | null }
  | { t: "field"; key: string };

export interface Field {
  key: string;
  label: string;
  initial: string;
}

export interface Prepared {
  segs: Seg[];
  fields: Field[];
  embeds: string[];
  sensitive: boolean;
}

const TOKEN = /\\([{}])|\{\{\s*([^{}\n]{1,80}?)\s*\}\}|\{\s*([\p{L}\p{N} _\-./#]{1,40}?)\s*\}/gu;
const MAX_DEPTH = 8;

function todayText() {
  return new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function find(ref: string, all: Snippet[]): Snippet | undefined {
  const r = ref.trim().toLowerCase();
  return all.find((s) => s.id.toLowerCase() === r) ?? all.find((s) => s.name.trim().toLowerCase() === r);
}

/** Expand embeds and collect fields. Throws Error with a user-facing message. */
export function prepare(snippet: Snippet, all: Snippet[]): Prepared {
  const segs: Seg[] = [];
  const fields = new Map<string, Field>();
  const embeds: string[] = [];
  let sensitive = snippet.sensitive;

  const pushText = (text: string, secretFrom: string | null) => {
    if (!text) return;
    const last = segs[segs.length - 1];
    if (last && last.t === "text" && last.secretFrom === secretFrom) last.text += text;
    else segs.push({ t: "text", text, secretFrom });
  };

  const walk = (s: Snippet, stack: string[], secretFrom: string | null) => {
    if (stack.length > MAX_DEPTH) throw new Error(`Embeds nest more than ${MAX_DEPTH} deep`);
    // Text from a sensitive snippet (this one or any embedding it) is masked in previews.
    const secret = secretFrom ?? (s.sensitive ? s.name : null);
    let at = 0;
    for (const m of s.body.matchAll(TOKEN)) {
      pushText(s.body.slice(at, m.index), secret);
      at = m.index! + m[0].length;
      const [, escaped, ref, field] = m;
      if (escaped) {
        pushText(escaped, secret);
      } else if (ref !== undefined) {
        const target = find(ref, all);
        if (!target) throw new Error(`“${s.name}” embeds {{${ref}}}, but there is no snippet with that name`);
        if (stack.includes(target.id) || target.id === s.id) {
          throw new Error(`“${target.name}” ends up embedding itself`);
        }
        if (target.sensitive) sensitive = true;
        if (!embeds.includes(target.name)) embeds.push(target.name);
        walk(target, [...stack, s.id], secret);
      } else {
        const label = field.trim();
        const key = label.toLowerCase();
        if (!fields.has(key)) fields.set(key, { key, label, initial: key === "today" ? todayText() : "" });
        segs.push({ t: "field", key });
      }
    }
    pushText(s.body.slice(at), secret);
  };

  walk(snippet, [], null);
  return { segs, fields: [...fields.values()], embeds, sensitive };
}

/** The final text, with every field replaced by its value. */
export function fill(p: Prepared, values: Map<string, string>): string {
  return p.segs.map((g) => (g.t === "text" ? g.text : values.get(g.key) ?? "")).join("");
}

/** True when pasting this snippet needs no questions and no expansion. */
export function isPlain(p: Prepared) {
  return p.fields.length === 0;
}
