// A block's menu (right-click, hold or its bar's ⋯): where its data comes from (files, kinds, settings, cache, live
// sources, as the server records them: /api/blocks/sources), then its options and its Markdown.
import type { ReactNode } from "react"
import { Blocks, Code, Database, FileText, Files, FolderOpen, Loader, Radio, Settings2, SlidersHorizontal, SquareCheck, TableProperties } from "lucide-react"
import { openMenu, replaceMenu, type MenuItem } from "@/components/ContextMenu"
import { canReveal, openHere } from "@/components/FileActions"
import { editAt } from "@/core/anchors"
import { get } from "@/core/http"
import { folderOf, openFile, stem } from "@/core/files"
import { openPluginSettings } from "@/core/pluginSettings"
import { blockFor } from "@/core/plugins"
import { showLabel } from "@/core/platform"
import { getPrefs } from "@/core/prefs"
import { revealProperties } from "@/core/viewstate"
import type { BlockEdit } from "@/editor/livePreview"
import { capitalize } from "@/lib/utils"

/** GET /api/blocks/sources for one block (core/render.ts BlockSources). */
type Source =
  | { kind: "file"; path: string }
  | { kind: "files"; collection: string; type: string; paths: string[] }
  | { kind: "settings" | "cache"; plugin: string; label: string; path: string }
  | { kind: "live"; plugin: string; label: string; folders: { path: string; label: string }[] }
type Sources = { name: string; path: string; line: number | null; sources: Source[] }

/** One block, as its menu needs it. `nth`: which of its file's blocks of that name (two alike told apart); `edit`: in
 *  an editor, its place there; `options`: its options form unfolded; `showing`: its Markdown is what shows. */
export type BlockRef = { name: string; text: string; path: string; nth?: number; edit?: BlockEdit; options?: () => void; showing?: boolean }

/** How many files show in the menu itself; the rest are under "N more ▸". */
const SHOWN = 8

const fileItem = (path: string): MenuItem => ({ label: stem(path), icon: FileText, hint: folderOf(path) || undefined, run: () => openFile(path) })

/** The menu's rows for what the server found (null: still asking; an Error: it couldn't). The file it's in is "This
 *  file's properties": what a profile shows is its own file's. */
function sourceItems(found: Sources | Error | null, here: string): MenuItem[] {
  if (found === null) return [{ label: "Finding where its data comes from…", icon: Loader, caption: true, run: () => {} }]
  if (found instanceof Error) return [{ label: `Couldn't find where its data comes from: ${found.message}`, caption: true, run: () => {} }]
  const files = found.sources.flatMap((s) => (s.kind === "file" ? [s.path] : []))
  const out: MenuItem[] = files.slice(0, SHOWN).map((f) => f === here
    ? { label: "This file's properties", icon: TableProperties, run: () => revealProperties(f) } : fileItem(f))
  if (files.length > SHOWN) out.push({ label: `${files.length - SHOWN} more`, icon: Files, run: () => {}, items: files.slice(SHOWN).map(fileItem) })
  for (const s of found.sources) {
    if (s.kind === "files") out.push({ label: capitalize(s.collection), icon: Files, hint: `${s.paths.length}`, run: () => {}, items: s.paths.map(fileItem) })
    else if (s.kind === "settings") out.push({ label: s.label, icon: Settings2, run: () => openPluginSettings(s.plugin) })
    else if (s.kind === "cache") out.push({ label: s.label, icon: Database, hint: s.path, run: () => openFile(s.path) })
  }
  // Live data is in no file; the folders it's read from open in Finder, on the machine the server runs on.
  for (const s of found.sources) {
    if (s.kind !== "live") continue
    out.push({ label: `Live: ${s.label}`, icon: Radio, caption: true, run: () => {} })
    if (canReveal()) for (const f of s.folders ?? []) out.push({ label: f.label, icon: FolderOpen, hint: showLabel, run: () => void openHere(f.path) })
  }
  return out.length ? out : [{ label: "It reads no files.", caption: true, run: () => {} }]
}

/** The block's menu at a point: what it is, then (once the server answers) where its data comes from, then its options
 *  and its Markdown. */
export function openBlockMenu(at: { x: number; y: number }, b: BlockRef) {
  const { name, text, path, edit } = b
  const { plugin, decl } = blockFor(name, getPrefs().disabled)
  const fence = name.startsWith("```")
  const what = fence ? `A ${name.slice(3)} block` : `The ${name} block`
  const head: MenuItem = { label: `${what}${plugin ? ` (${plugin.name})` : ""}${decl?.description ? `: ${decl.description}` : ""}`, icon: Blocks, caption: true, run: () => {} }
  // Where it is in the file (0-based, frontmatter counted), once the server says; an editor knows its own place.
  let line: number | null = null
  const toSource = () => (edit?.source ? edit.source() : line === null ? openFile(path) : editAt(path, line + 1))
  const tail = (): MenuItem[] => b.showing ? [{ label: "Done", icon: SquareCheck, run: () => edit?.done() }] : [
    ...(decl?.options && Object.keys(decl.options).length && path
      ? [{ label: "Options", icon: SlidersHorizontal, run: () => (b.options ? b.options() : toSource()) }] : []),
    ...(path ? [{ label: "Edit source", icon: Code, run: toSource }] : []),
  ]
  const build = (found: Sources | Error | null): MenuItem[] => {
    const rows = sourceItems(found, path), end = tail()
    return [head, { ...rows[0], sep: true }, ...rows.slice(1), ...end.map((x, i) => (i ? x : { ...x, sep: true }))]
  }
  // (a fence a plugin draws, ```base, has no text side to trace: what it is and editing it)
  if (fence || !path) { openMenu(at, [head, ...tail()]); return }
  const first = build(null)
  openMenu(at, first)
  const nth = b.nth ?? edit?.nth()
  const q = new URLSearchParams({ path, name, text, ...(nth !== undefined ? { nth: String(nth) } : {}) })
  get<Sources>(`blocks/sources?${q}`).then(
    (s) => { line = s.line; replaceMenu(first, build(s)) },
    (e) => replaceMenu(first, build(e instanceof Error ? e : new Error(String(e)))),
  )
}

/** A drawn block, with its menu on right-click (and a held finger: ContextMenu.tsx, watchHolds).
 *  `display: contents`: it adds no box, so the dashboard's grid and the editor's layout are the block's own. */
export function BlockSource({ menu, name, children }: { menu: (at: { x: number; y: number }) => void; name: string; children: ReactNode }) {
  return (
    <div className="contents" data-block={name} data-hold-menu
      onContextMenu={(e) => {
        // (something in it answered the right-click itself: a routine's day opens its sheet)
        if (e.defaultPrevented) return
        e.preventDefault(); e.stopPropagation(); menu({ x: e.clientX, y: e.clientY })
      }}>
      {children}
    </div>
  )
}
