// A folder's page from the keyboard, Finder's way: arrows move in every view (a grid's both ways, columns' ← → out of
// folders and into them), ↵ or ⌘↓ opens, ⌘↑ goes up, Space previews, ⌥⌘1–4 show it another way, a name typed goes to it.
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, ArrowUpToLine, Columns3, CornerDownLeft, Copy, Eye, FolderUp, GalleryHorizontalEnd, LayoutGrid, List, Pencil, SquareArrowOutUpRight, SquareMousePointer, Trash2 } from "lucide-react"
import { registerCommands, runsCommand, typingIn } from "@/core/commands"
import { isDesktop, isMac } from "@/core/platform"
import type { FolderView } from "@/core/prefs"
import { clearSelection, selectedIn, selectTo } from "@/core/select"
import { activePane } from "@/core/workspace"
import { duplicate, removeMany } from "@/components/FileActions"
import { fixed, type FolderItem } from "@/components/FileTree"
import { naming, pick, pickedIn, SELECT, type Moves } from "@/pages/FolderParts"

/** What the keys need of a folder's page, which says it by its element while it's drawn (FolderPage). */
export type KeyedPage = {
  path: string; items: FolderItem[]; moves: Moves | null; view: FolderView
  open: (n: FolderItem, newTab?: boolean) => void; show: (n: FolderItem) => void; up: () => void; showAs: (v: FolderView) => void
}
export const keyedPages = new WeakMap<HTMLElement, () => KeyedPage>()

/** The folder whose page gives the keyboard back to its things once drawn (after the keys moved it there). */
let arriving: string | null = null
export const arrive = (folder: string) => { arriving = folder }
/** Called by a page once drawn: true when it's the one arrived at (its picked thing, else its first, gets the keyboard). */
export const arrived = (folder: string) => { if (arriving !== folder) return false; arriving = null; return true }

/** The page the keys are for: the one with the keyboard (not in a field, its view buttons or a playing video, unless
 *  `choices`), or, with nothing focused, the focused pane's. */
function pageEl(choices = false): HTMLElement | null {
  const a = document.activeElement
  if (a instanceof HTMLElement && a !== document.body) {
    if (typingIn(a) || a.closest(`[role=menu], [role=dialog], dialog${choices ? "" : ", [role=radiogroup], video, audio"}`)) return null
    return a.closest<HTMLElement>("[data-folder-page]")
  }
  return document.querySelector<HTMLElement>(`[data-pane="${CSS.escape(activePane().id)}"] [data-folder-page]`)
}
type At = { el: HTMLElement; p: KeyedPage; lines: string[][]; flat: string[]; cur: string | null }
function at(choices = false): At | null {
  const el = pageEl(choices), p = el && keyedPages.get(el)?.()
  if (!el || !p?.moves) return null
  const lines = p.moves.lines, flat = lines.flat()
  const a = document.activeElement
  const on = a instanceof HTMLElement && el.contains(a) ? a.closest<HTMLElement>("[data-folder-item]")?.dataset.folderItem : undefined
  const was = pickedIn(p.path)
  return { el, p, lines, flat, cur: on && flat.includes(on) ? on : was && flat.includes(was) ? was : null }
}
/** Keys that act on the thing the keyboard is on: not while it's on a button of the page (its own ↵ and Space). */
const onThing = () => {
  const a = document.activeElement
  if (a instanceof HTMLElement && a !== document.body && !a.closest("[data-folder-item]")) return null
  const t = at()
  return t?.cur ? t : null
}

/** Give the keyboard to `key`'s thing, drawn by then or in a frame or two (a long list draws it once it's picked). */
export function focusThing(page: HTMLElement, key: string, tries = 4) {
  const it = page.querySelector<HTMLElement>(`[data-folder-item="${CSS.escape(key)}"]`)
  const f = it && (it.matches("a[href], [tabindex]") ? it : it.querySelector<HTMLElement>("[data-keyrow], a[href]"))
  if (f) { f.focus({ preventScroll: true }); f.scrollIntoView({ block: "nearest", inline: "nearest" }); return }
  if (tries) requestAnimationFrame(() => focusThing(page, key, tries - 1))
}

function go(t: At, key: string, extend: boolean) {
  if (extend && t.cur) selectTo(SELECT, t.flat, t.cur, key)
  else if (selectedIn(SELECT).length) clearSelection()
  pick(t.p.path, key)
  focusThing(t.el, key)
}

type Dir = "up" | "down" | "left" | "right" | "first" | "last"
function move(dir: Dir, extend = false) {
  const t = at()
  if (!t || !t.flat.length) return
  // (nothing yet: any way starts at the first)
  if (!t.cur) return go(t, dir === "last" ? t.flat[t.flat.length - 1] : t.flat[0], false)
  if (dir === "first" || dir === "last") return go(t, dir === "first" ? t.flat[0] : t.flat[t.flat.length - 1], extend)
  const r = t.lines.findIndex((l) => l.includes(t.cur!)), c = t.lines[r].indexOf(t.cur)
  if (dir === "up" || dir === "down") {
    const line = t.lines[r + (dir === "up" ? -1 : 1)]
    if (line) go(t, line[Math.min(c, line.length - 1)], extend)
    return
  }
  const by = dir === "left" ? -1 : 1
  if (t.p.moves!.side) return t.p.moves!.side(by)
  const next = t.p.moves!.along ? t.flat[t.flat.indexOf(t.cur) + by] : undefined
  if (next) go(t, next, extend)
}

const thing = (t: At) => t.p.items.find((n) => n.path === t.cur)
/** The selection when the thing with the keyboard is in it, else that thing. */
const these = (t: At) => { const s = selectedIn(SELECT); return s.includes(t.cur!) ? s : [t.cur!] }

function open(newTab: boolean) {
  const t = onThing(), n = t && thing(t)
  if (!t || !n) return
  if (n.folder && !newTab) arrive(n.path)
  t.p.open(n, newTab)
}
function preview() {
  const t = onThing(), n = t && thing(t)
  if (t && n && !t.p.moves?.preview?.()) t.p.show(n)
}

// ---------- a name typed goes to the first thing it starts ----------
let typed = "", typedAt = 0
const typing = () => !!typed && performance.now() - typedAt < 1000
if (typeof window !== "undefined") {
  // (not a shortcut, so not a command: before them, a name's first letter over a sequence it starts, "G I"; a key that
  // runs one by itself, Vim's J, is its until a name is under way)
  addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || [...e.key].length !== 1) return
    const going = typing()
    if ((e.key === " " && !going) || (!going && runsCommand(e))) return
    const t = at()
    if (!t) return
    const next = (going ? typed : "") + e.key.toLowerCase()
    const names = new Map(t.p.items.map((n) => [n.path, n.name.toLowerCase()]))
    const hit = t.flat.find((k) => names.get(k)?.startsWith(next))
    if (!hit && !going) return
    typed = next
    typedAt = performance.now()
    e.preventDefault()
    if (hit && hit !== t.cur) go(t, hit, false)
  }, true)
}

const VIEWS: { v: FolderView; label: string; icon: typeof List }[] = [
  { v: "grid", label: "grid", icon: LayoutGrid }, { v: "list", label: "list", icon: List },
  { v: "columns", label: "columns", icon: Columns3 }, { v: "gallery", label: "gallery", icon: GalleryHorizontalEnd },
]
const can = (f: (t: At) => boolean) => () => { const t = at(); return !!t && f(t) }
const any = can(() => true)
registerCommands([
  { id: "folder:down", name: "Move down in the folder", keys: ["ArrowDown"], when: any, run: () => move("down"), icon: ArrowDown },
  { id: "folder:up", name: "Move up in the folder", keys: ["ArrowUp"], when: any, run: () => move("up"), icon: ArrowUp },
  { id: "folder:left", name: "Move left in the folder", keys: ["ArrowLeft"], when: any, run: () => move("left"), icon: ArrowLeft },
  { id: "folder:right", name: "Move right in the folder", keys: ["ArrowRight"], when: any, run: () => move("right"), icon: ArrowRight },
  { id: "folder:first", name: "Move to the first in the folder", keys: ["Home"], when: any, run: () => move("first"), icon: ArrowUpToLine },
  { id: "folder:last", name: "Move to the last in the folder", keys: ["End"], when: any, run: () => move("last"), icon: ArrowDownToLine },
  { id: "folder:select-down", name: "Select the one below too", keys: ["Shift+ArrowDown"], when: any, run: () => move("down", true), icon: SquareMousePointer },
  { id: "folder:select-up", name: "Select the one above too", keys: ["Shift+ArrowUp"], when: any, run: () => move("up", true), icon: SquareMousePointer },
  { id: "folder:select-left", name: "Select the one before too", keys: ["Shift+ArrowLeft"], when: any, run: () => move("left", true), icon: SquareMousePointer },
  { id: "folder:select-right", name: "Select the one after too", keys: ["Shift+ArrowRight"], when: any, run: () => move("right", true), icon: SquareMousePointer },
  { id: "folder:open", name: "Open it", keys: ["Enter", "Mod+ArrowDown"], when: () => !!onThing(), run: () => open(false), icon: CornerDownLeft },
  { id: "folder:open-tab", name: "Open it in a new tab", keys: ["Mod+Enter"], when: () => !!onThing(), run: () => open(true), icon: SquareArrowOutUpRight },
  { id: "folder:enclosing", name: "Go to the enclosing folder", keys: ["Mod+ArrowUp"], when: can((t) => !!t.p.path), run: () => at()?.p.up(), icon: FolderUp },
  { id: "folder:preview", name: "Preview it", keys: ["Space"], when: () => !!onThing() && !typing(), run: preview, icon: Eye },
  { id: "folder:rename", name: "Rename it", keys: ["F2"], when: () => { const t = onThing(); return !!t && !fixed(t.cur!) }, run: () => { const t = onThing(); if (t) naming.set({ path: t.cur!, fresh: false }) }, icon: Pencil },
  { id: "folder:duplicate", name: "Duplicate it", keys: ["Mod+D"], when: () => { const t = onThing(); return !!t && !thing(t)?.folder && !fixed(t.cur!) }, run: () => { const t = onThing(); if (t) void duplicate(t.cur!) }, icon: Copy },
  { id: "folder:delete", name: "Delete it, or the selected ones", keys: isMac ? ["Mod+Backspace"] : ["Delete"], when: () => !!onThing(), run: () => { const t = onThing(); if (t) void removeMany(these(t)) }, icon: Trash2 },
  // (⌘1–4, Finder's, are the tabs')
  ...VIEWS.map(({ v, label, icon }, i) => ({ id: `folder:show-as-${v}`, name: `Show folder as ${label}`, keys: [`Mod+Alt+${i + 1}`],
    when: () => { const t = at(true); return !!t && t.p.view !== v && (i < 2 || isDesktop()) }, run: () => at(true)?.p.showAs(v), icon })),
])
