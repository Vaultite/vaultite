export type Kind = "layout" | "pack" | "look"
export const KINDS: readonly string[] = ["layout", "pack", "look"]
const lookOnly = (f: string) => ["bundle.json", "appearance.json"].includes(f) || /^(themes|snippets)\//.test(f)

/** A bundle's kind from its bundle.json (`m`: its `kind`) and its files' paths: unsaid, a look when it holds only
 *  appearance.json, themes and snippets, else a layout. */
export function kindFrom(m: unknown, paths: string[]): Kind {
  const k = m && typeof m === "object" ? (m as { kind?: unknown }).kind : undefined
  return typeof k === "string" && KINDS.includes(k) ? k as Kind : paths.every(lookOnly) ? "look" : "layout"
}
