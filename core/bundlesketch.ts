// What a bundle's picture is drawn from (components/LayoutDrawings.tsx), for the server's bundles and the directory's.
// No Node, no packages: the directory's index is built from a checkout of core/ and tools/ alone.
import { blockName, scan } from "./sections.ts"
import { readSidebars } from "./sidebars.ts"

export type HomeBlock = { block: string; view: string | null }
export type Sketch = {
  /** The look it sets (appearance.json's). */
  theme: string | null; scheme: string | null
  /** Its sidebars' panels (null: it leaves them as they are, or the default). */
  panels: { left: string[]; right: string[]; collapsed: string[] } | null
  /** Its window: the tab bar, rails (off: sidebars slide in from the edge), panes floating as cards (paneCards, or a
   *  snippet named so) and glass (translucent: the sidebars, or the pages too); null where it leaves one as it is. */
  shape: { tabBar: boolean | null; rails: boolean | null; floating: boolean | null; glass: "sidebars" | "pages" | null }
  /** What the first page it pins draws: its blocks in order (null: it pins nothing; [] not known). */
  home: HomeBlock[] | null
}
type Obj = Record<string, unknown>

/** A page's blocks in order, at most 6 (a ```base fence: its first view's type, a kanban drawn as a board). */
export function homeBlocks(text: string): HomeBlock[] {
  const out: HomeBlock[] = []
  const s = scan(text)
  for (const f of s.fences) {
    const name = f.close === null ? null : blockName(f.info) ?? (f.info.trim().split(/\s/)[0] === "base" ? "base" : null)
    if (!name) continue
    const body = s.lines.slice(f.open + 1, f.close!).join("\n")
    const view = (name === "base" ? /^\s*-?\s*type:\s*['"]?(\w+)/m : /^view:\s*['"]?(\w+)/m).exec(body)?.[1] ?? null
    out.push({ block: name, view: view === "kanban" ? "board" : view })
    if (out.length >= 6) break
  }
  return out
}

/** A bundle's sketch from its appearance.json and sidebars.json (as read), and its home's blocks. */
export function sketchOf(look: Obj | null, sidebars: unknown, home: HomeBlock[] | null): Sketch {
  const l = look ?? {}
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
  const bool = (v: unknown) => (typeof v === "boolean" ? v : null)
  const snippets = Array.isArray(l.snippets) ? l.snippets.filter((x): x is string => typeof x === "string") : null
  const floating = l.paneCards === true || !!snippets?.some((x) => /float/i.test(x)) ? true : l.paneCards === false || snippets ? false : null
  const s = readSidebars(sidebars)
  return {
    theme: str(l.theme), scheme: str(l.scheme), panels: s && { left: s.left, right: s.right, collapsed: s.collapsed }, home,
    shape: { tabBar: bool(l.tabBar), rails: bool(l.rails), floating, glass: l.translucent === true ? (l.translucentPages === true ? "pages" : "sidebars") : null },
  }
}
