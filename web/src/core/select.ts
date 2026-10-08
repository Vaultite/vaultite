// Selecting several things in a list (files in the tree, tabs, pinned pages, the inbox), one way everywhere, as in
// Finder: ⌘-click adds or takes one, ⇧-click a run from the last one clicked, ⇧↑ ⇧↓ and ⌘A from the keyboard, Esc or
// a click elsewhere lets go. A right-click or a drag on a selected row acts on all of them. Phones have no keys: Select
// in a row's menu starts it, a tap then adds or takes one, and SelectionBar has what they can do together.
import { useEffect, useRef } from "react"
import { CheckSquare, SquareDashed, SquareMousePointer } from "lucide-react"
import { registerCommands } from "@/core/commands"
import { coarse } from "@/core/haptics"
import { isMac } from "@/core/platform"
import { menuShowing, type MenuItem } from "@/components/ContextMenu"
import { signal } from "@/core/signal"

/** What a list's selected things can do together: its rows' right-click and the phone's bar. `noun`: what one and
 *  several are called ("file", "files"). */
export type Selectable = { menu: (keys: string[]) => MenuItem[]; noun?: [string, string] }

/** `touch`: a phone's select mode (taps add or take); it stays on with nothing selected until Done. */
type Sel = { list: string; keys: string[]; set: Set<string>; anchor: string | null; touch: boolean }
let sel: Sel | null = null
const subs = signal()
function put(next: Sel | null) {
  sel = next && !next.keys.length && !next.touch ? null : next
  subs.notify()
}
const make = (list: string, keys: string[], anchor: string | null, touch = false): Sel => {
  const uniq = [...new Set(keys)]
  return { list, keys: uniq, set: new Set(uniq), anchor, touch }
}

/** Each list's definitions, the last mounted first used (a list drawn twice: the sidebar's tree and a Files tab's). */
const defs = new Map<string, Selectable[]>()
const lists = { get: (list: string) => defs.get(list)?.at(-1), has: (list: string) => !!defs.get(list)?.length }
/** Make a list's rows selectable while mounted: its container says `data-select-list={list}`, each row
 *  `data-select-key`; their order on screen is the order a ⇧-click takes. */
export function useSelectable(list: string, def: Selectable) {
  const ref = useRef(def)
  useEffect(() => { ref.current = def })
  useEffect(() => {
    const proxy: Selectable = { menu: (keys) => ref.current.menu(keys), get noun() { return ref.current.noun } }
    defs.set(list, [...(defs.get(list) ?? []), proxy])
    return () => {
      defs.set(list, (defs.get(list) ?? []).filter((d) => d !== proxy))
      // The list is gone from the screen (a drawer closed, the tab list's sheet): nothing left to act on.
      if (!lists.has(list) && sel?.list === list) put(null)
    }
  }, [list])
}

/** The selection now (null: none). */
export const getSelection = () => sel
/** The keys selected in a list, in the order they were picked (none: empty). */
export const selectedIn = (list: string) => (sel?.list === list ? sel.keys : [])
/** Whether this row is selected: drawn again only when that changes. */
export const useSelected = (list: string, key: string) => subs.use(() => !!sel && sel.list === list && sel.set.has(key))
const none: ReadonlySet<string> = new Set()
/** The keys selected in a list, live (for a short list drawn in one piece; long ones ask per row: useSelected). */
export const useSelectedKeys = (list: string): ReadonlySet<string> => subs.use(() => (sel?.list === list ? sel.set : none))
/** The selection, live. */
export const useSelectionState = () => subs.use(() => sel)
/** A phone selecting (in this list): taps pick rows, and swipes rest. */
export const useSelecting = (list?: string) => subs.use(() => !!sel?.touch && (!list || sel.list === list))
export const selecting = () => !!sel?.touch
export function clearSelection() { if (sel) put(null) }

/** A click that opens in a new tab from the keyboard (⌘↵: core/keylist.ts) isn't a ⌘-click. */
let fromKeys = false
export function asKeys(fn: () => void) { fromKeys = true; try { fn() } finally { fromKeys = false } }

/** The rows of the list `el` is in, in order on screen (hidden ones left out). */
function rowsOf(el: Element | null, list: string) {
  const box = el?.closest<HTMLElement>(`[data-select-list="${CSS.escape(list)}"]`)
  if (!box) return []
  return [...box.querySelectorAll<HTMLElement>("[data-select-key]")].filter((r) => r.getClientRects().length > 0).map((r) => r.dataset.selectKey!)
}

/** For a row's click: ⌘ (Ctrl elsewhere) adds or takes it, ⇧ selects the run from the last one picked (`current`, the
 *  row lit as open, is where a first ⌘- or ⇧-click starts from: Finder's way), a phone selecting adds or takes it.
 *  True when the click was that (the row then opens nothing); a plain click lets a selection go and is the row's own. */
export function selectClick(e: React.MouseEvent | MouseEvent, list: string, key: string, current?: string | null) {
  if (fromKeys || e.button !== 0) return false
  const mine = sel?.list === list ? sel : null
  if (mine?.touch) { e.preventDefault(); toggle(list, key); return true }
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (e.shiftKey) {
    e.preventDefault()
    const order = rowsOf(e.currentTarget as Element, list)
    const from = mine?.anchor && order.includes(mine.anchor) ? mine.anchor : current && order.includes(current) ? current : key
    const [a, b] = [order.indexOf(from), order.indexOf(key)].sort((x, y) => x - y)
    const run = a < 0 || b < 0 ? [key] : order.slice(a, b + 1)
    // ⌘⇧ adds the run to what's selected; ⇧ alone makes it the selection.
    put(make(list, mod && mine ? [...mine.keys, ...run] : run, from))
    return true
  }
  if (mod) {
    e.preventDefault()
    const seed = mine ? mine.keys : current && current !== key && rowsOf(e.currentTarget as Element, list).includes(current) ? [current] : []
    put(make(list, seed.includes(key) ? seed.filter((k) => k !== key) : [...seed, key], key))
    return true
  }
  if (sel) put(null)
  return false
}

function toggle(list: string, key: string) {
  const mine = sel?.list === list ? sel : null
  const keys = mine?.set.has(key) ? mine.keys.filter((k) => k !== key) : [...(mine?.keys ?? []), key]
  put(make(list, keys, key, mine?.touch))
}

/** What a right-click or a drag on this row is about: every selected key when it's one of several, else null (and a
 *  right-click elsewhere lets the selection go, as in Finder). */
export function selectionFor(list: string, key: string, letGo = true): string[] | null {
  if (sel?.list === list && sel.set.has(key) && (sel.keys.length > 1 || sel.touch)) return sel.keys
  if (letGo && sel && !sel.touch) put(null)
  return null
}

/** A row's menu: the list's menu for the selection when the row is in one, else its own. */
export function rowMenu(list: string, key: string, own: () => MenuItem[]): () => MenuItem[] {
  return () => {
    const keys = selectionFor(list, key)
    // (Select first: a phone's menu opens at the finger, and a file's menu can be long.)
    if (keys) return selectionMenu(list, keys)
    const pick = selectItem(list, key), items = own()
    return pick.length ? [...pick, ...items.map((it, i) => (i ? it : { ...it, sep: true }))] : items
  }
}

/** The list's menu for these keys, under a line saying how many. */
export function selectionMenu(list: string, keys: string[]): MenuItem[] {
  const def = lists.get(list)
  if (!def) return []
  // Done with them once one is chosen (they may have moved, closed or gone).
  const after = (it: MenuItem): MenuItem => ({ ...it, run: () => { clearSelection(); it.run() }, items: it.items?.map(after) })
  return [{ label: countOf(list, keys.length), caption: true, run: () => {} }, ...def.menu(keys).map((it, i) => after(i ? it : { ...it, sep: true }))]
}
export const countOf = (list: string, n: number) => {
  const [one, many] = lists.get(list)?.noun ?? ["item", "items"]
  return `${n} ${n === 1 ? one : many} selected`
}

/** Phones (no keys): "Select" in a row's menu starts selecting with it. */
export function selectItem(list: string, key: string): MenuItem[] {
  if (!coarse || !lists.has(list)) return []
  return [{ label: "Select", icon: CheckSquare, run: () => put(make(list, [key], key, true)) }]
}
/** Start a phone's select mode in a list with nothing picked yet (a list's own Select button). */
export const startSelecting = (list: string) => put(make(list, [], null, true))

/** What a row draws while selected: `data-selected`, styled once in index.css. */
export const selectedAttr = (on: boolean) => (on ? { "data-selected": "" } : {})

// ---------- the keyboard ----------
const ROW = "[data-keyrow]"
/** The selectable row the keyboard is on: its list and key. */
function keyRow() {
  const a = document.activeElement
  const row = a instanceof HTMLElement ? a.closest<HTMLElement>("[data-select-key]") ?? a.querySelector<HTMLElement>(":scope > [data-select-key]") : null
  const list = row?.closest<HTMLElement>("[data-select-list]")?.dataset.selectList
  return row && list && lists.has(list) ? { row, list, key: row.dataset.selectKey! } : null
}
/** ⇧↑ / ⇧↓: the keyboard moves a row and the selection runs from where it started to there. */
function extend(delta: 1 | -1) {
  const at = keyRow()
  if (!at) return
  const box = at.row.closest<HTMLElement>("[data-select-list]")!
  const rows = [...box.querySelectorAll<HTMLElement>("[data-select-key]")].filter((r) => r.getClientRects().length > 0)
  const i = rows.indexOf(at.row), next = rows[i + delta]
  if (!next) return
  const order = rows.map((r) => r.dataset.selectKey!)
  const anchor = sel?.list === at.list && sel.anchor && order.includes(sel.anchor) ? sel.anchor : at.key
  const [a, b] = [order.indexOf(anchor), i + delta].sort((x, y) => x - y)
  put(make(at.list, order.slice(a, b + 1), anchor))
  const focus = next.matches(ROW) ? next : next.querySelector<HTMLElement>(ROW) ?? next
  focus.focus({ preventScroll: true })
  focus.scrollIntoView({ block: "nearest" })
}
function selectAll() {
  const at = keyRow()
  if (!at) return
  const box = at.row.closest<HTMLElement>("[data-select-list]")!
  const keys = [...box.querySelectorAll<HTMLElement>("[data-select-key]")].filter((r) => r.getClientRects().length > 0).map((r) => r.dataset.selectKey!)
  put(make(at.list, keys, at.key))
}

if (typeof window !== "undefined") {
  // A press outside the selected list (and outside a menu, the phone's bar or a dialog it opened) lets it go.
  addEventListener("pointerdown", (e) => {
    if (!sel || sel.touch || !(e.target instanceof Element)) return
    if (e.target.closest(`[data-select-list="${CSS.escape(sel.list)}"], [role=menu], [data-selection-bar], dialog, .fixed.inset-0`)) return
    put(null)
  }, true)
}

registerCommands([
  { id: "list:select-down", name: "Select the next row too", keys: ["Shift+ArrowDown"], when: () => !!keyRow(), run: () => extend(1), icon: SquareMousePointer },
  { id: "list:select-up", name: "Select the row above too", keys: ["Shift+ArrowUp"], when: () => !!keyRow(), run: () => extend(-1), icon: SquareMousePointer },
  { id: "list:select-all", name: "Select every row in the list", keys: ["Mod+A"], when: () => !!keyRow(), run: selectAll, icon: CheckSquare },
  { id: "list:select-none", name: "Clear the selection", keys: ["Escape"], when: () => !!sel && !menuShowing(), run: clearSelection, icon: SquareDashed },
])
