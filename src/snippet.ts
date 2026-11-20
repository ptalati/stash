export interface Snippet {
  id: string;
  name: string;
  body: string;
  keywords: string[];
  group: string;
  pinned: boolean;
  sensitive: boolean;
}

/** Pinned snippets in list order; the first nine get Alt+1…9 in the palette. */
export function quickKeys(all: Snippet[]): Map<string, number> {
  const m = new Map<string, number>();
  all.filter((s) => s.pinned).slice(0, 9).forEach((s, i) => m.set(s.id, i + 1));
  return m;
}
