// Tab groups (TabSet, core/layout.ts), as browsers have them: making one of some tabs, adding tabs and taking them out,
// naming, colouring, folding, moving and closing one, and what agents ask of them (`vau tabs`). Each change is one `set`.
import { COLORS, isColor, type Color } from "../../../core/colors.ts"
import { beside, inSet, isBlank, leaves, mapGroups, newId, outsideSets, runOf, type Group, type Layout, type Side, type Tab, type TabSet } from "@/core/layout"
import { closeTabIds, getWorkspace, groupOfTab, groups, set, show, showActive } from "@/core/workspace"
import { answerUi } from "@/core/live"
import { signal } from "@/core/signal"

/** A tab group and the pane it's in. */
export function setById(id: string): { g: Group; s: TabSet } | null {
  for (const g of groups()) { const s = g.sets?.find((x) => x.id === id); if (s) return { g, s } }
  return null
}
/** The tab groups of every pane, in order. */
export const allSets = () => groups().flatMap((g) => g.sets ?? [])

/** The colour a new tab group takes: the first no group has, then round again. */
export function nextColor(): Color {
  const used = allSets().map((s) => s.color)
  return COLORS.find((c) => !used.includes(c)) ?? COLORS[used.length % COLORS.length]
}

/** The site a web tab shows ("view:web/@work/https://www.example.com/a" -> "example.com"). */
function siteOf(to: string) {
  if (!to.startsWith("view:web/")) return null
  try { return new URL(to.slice(9).replace(/^@[a-z0-9]+\//, "")).hostname.replace(/^www\./, "") || null } catch { return null }
}
/** A name for a new group of these tabs: the folder or the site they all share, else none (the chip is its colour). */
export function suggestName(tabs: Tab[]): string {
  const folders = tabs.map((t) => (t.to.startsWith("file:") && !t.to.startsWith("file:/") ? t.to.slice(5).split("/").slice(0, -1).join("/") : null))
  if (folders.every((f) => f) && new Set(folders).size === 1) return folders[0]!.split("/").pop()!
  const sites = tabs.map((t) => siteOf(t.to))
  if (sites.every((s) => s) && new Set(sites).size === 1) return sites[0]!.split(".").slice(-2, -1)[0]?.replace(/^./, (c) => c.toUpperCase()) ?? ""
  return ""
}

/** `g` without the tabs in `ids` (the tab shown moves on to the nearest one left). */
function without(g: Group, ids: Set<string>): Group {
  if (!g.tabs.some((t) => ids.has(t.id))) return g
  const tabs = g.tabs.filter((t) => !ids.has(t.id))
  if (!ids.has(g.active)) return { ...g, tabs }
  const i = g.tabs.findIndex((t) => t.id === g.active)
  const next = g.tabs.slice(i).find((t) => !ids.has(t.id)) ?? [...g.tabs.slice(0, i)].reverse().find((t) => !ids.has(t.id))
  return { ...g, tabs, active: next?.id ?? "" }
}
/** The tabs `ids` in their order on screen. */
const inOrder = (ids: string[]) => groups().flatMap((g) => g.tabs).filter((t) => ids.includes(t.id))

/** Put `tabs` into pane `gid` at `at` (as computed without them), in group `set`, taking them out of wherever they are. */
function gather(tabs: Tab[], gid: string, at: (g: Group) => number, setId: string, def?: TabSet): Layout {
  const chosen = new Set(tabs.map((t) => t.id))
  return mapGroups(getWorkspace().root, (g) => {
    if (g.id !== gid) return without(g, chosen)
    const rest = g.tabs.filter((t) => !chosen.has(t.id)), i = at(g)
    const active = chosen.has(g.active) || rest.some((t) => t.id === g.active) ? g.active : rest[0]?.id ?? tabs[0].id
    return { ...g, tabs: [...rest.slice(0, i), ...tabs.map((t) => inSet(t, setId)), ...rest.slice(i)], active, ...(def ? { sets: [...(g.sets ?? []), def] } : {}) }
  })
}

/** Make tabs a new tab group, where the first of them is (those from other panes move there): its name and colour, or
 *  the suggested ones. Returns its id. */
export function makeSet(ids: string[], opts: { name?: string; color?: Color; collapsed?: boolean } = {}): string | null {
  const tabs = inOrder(ids)
  if (!tabs.length) return null
  const home = groupOfTab(tabs[0].id)!
  const id = `s${newId()}`
  const def: TabSet = { id, name: (opts.name ?? suggestName(tabs)).trim().slice(0, 80), color: opts.color ?? nextColor(), ...(opts.collapsed ? { collapsed: true } : {}) }
  const chosen = new Set(tabs.map((t) => t.id))
  const first = home.tabs.findIndex((t) => t.id === tabs[0].id)
  const at = (g: Group) => { const rest = g.tabs.filter((t) => !chosen.has(t.id)); return outsideSets(rest, g.tabs.slice(0, first).filter((t) => !chosen.has(t.id)).length) }
  set({ ...getWorkspace(), root: gather(tabs, home.id, at, id, def) })
  return id
}

/** Add tabs to the end of a tab group (from anywhere: they move to its pane). */
export function addToSet(ids: string[], setId: string) {
  const where = setById(setId)
  const tabs = inOrder(ids).filter((t) => t.set !== setId)
  if (!where || !tabs.length) return
  const chosen = new Set(tabs.map((t) => t.id))
  const at = (g: Group) => { const rest = g.tabs.filter((t) => !chosen.has(t.id)), r = runOf({ ...g, tabs: rest }, setId); return r.at + r.n }
  set({ ...getWorkspace(), root: gather(tabs, where.g.id, at, setId) })
}

/** Put the tab showing `to` (the one on screen in its pane, as a tab just opened is) in the tab group named `name`: an
 *  agent's tabs, "<agent>/<task>". Its pane's group of that name, else another pane's, else a new one. */
export function groupTab(to: string, name: string) {
  const all = groups()
  const g = all.find((x) => x.tabs.some((t) => t.id === x.active && t.to === to)) ?? all.find((x) => x.tabs.some((t) => t.to === to))
  const tab = g && (g.tabs.find((t) => t.id === g.active && t.to === to) ?? g.tabs.find((t) => t.to === to))
  if (!g || !tab || !name.trim()) return
  const named = g.sets?.find((s) => s.name === name) ?? allSets().find((s) => s.name === name)
  if (named) addToSet([tab.id], named.id)
  else makeSet([tab.id], { name })
}

/** Take tabs out of their tab groups: each goes right after what's left of its group, as in a browser. */
export function leaveSet(ids: string[]) {
  const going = new Set(inOrder(ids).filter((t) => t.set).map((t) => t.id))
  if (!going.size) return
  const root = mapGroups(getWorkspace().root, (g) => {
    if (!g.tabs.some((t) => going.has(t.id))) return g
    let tabs = g.tabs.filter((t) => !going.has(t.id))
    for (const s of g.sets ?? []) {
      const out = g.tabs.filter((t) => going.has(t.id) && t.set === s.id).map((t) => inSet(t, undefined))
      if (!out.length) continue
      const last = tabs.map((t) => t.set).lastIndexOf(s.id)
      const at = last >= 0 ? last + 1 : g.tabs.slice(0, g.tabs.findIndex((t) => t.set === s.id)).filter((t) => !going.has(t.id)).length
      tabs = [...tabs.slice(0, at), ...out, ...tabs.slice(at)]
    }
    return { ...g, tabs }
  })
  set({ ...getWorkspace(), root })
}

/** Change a tab group's name, colour or fold (collapseSet folds it the way that keeps a tab on screen). */
function changeSet(id: string, fn: (s: TabSet) => TabSet) {
  if (!setById(id)) return
  set({ ...getWorkspace(), root: mapGroups(getWorkspace().root, (g) => (g.sets?.some((s) => s.id === id) ? { ...g, sets: g.sets.map((s) => (s.id === id ? fn(s) : s)) } : g)) })
}
export const renameSet = (id: string, name: string) => changeSet(id, (s) => ({ ...s, name: name.trim().slice(0, 80) }))
export const colorSet = (id: string, color: Color) => changeSet(id, (s) => ({ ...s, color }))

/** Fold a tab group to its name, or open it (`collapsed` left out: the other way). Folding the one whose tab is on
 *  screen shows the tab after it (else before it; none: a new tab), as browsers do. */
export function foldSet(id: string, collapsed?: boolean) {
  const where = setById(id)
  if (!where) return
  const { g, s } = where
  const fold = collapsed ?? !s.collapsed
  if (!!s.collapsed === fold) return
  const { collapsed: _, ...open } = s
  const def: TabSet = fold ? { ...s, collapsed: true } : open
  let next: Group = { ...g, sets: g.sets!.map((x) => (x.id === id ? def : x)) }
  if (fold && g.tabs.find((t) => t.id === g.active)?.set === id) {
    const r = runOf(g, id)
    const other = g.tabs[r.at + r.n] ?? g.tabs[r.at - 1]
    if (other) next = { ...next, active: other.id }
    else {
      const blank = { id: newId(), to: "new" }
      next = { ...next, tabs: [...g.tabs, blank], active: blank.id }
    }
  }
  set({ ...getWorkspace(), root: mapGroups(getWorkspace().root, (x) => (x.id === g.id ? next : x)) })
  if (next.active !== g.active && getWorkspace().focus === g.id) showActive()
}

/** Ungroup: the group goes, its tabs stay where they are. */
export function ungroupSet(id: string) {
  if (!setById(id)) return
  set({ ...getWorkspace(), root: mapGroups(getWorkspace().root, (g) => (g.sets?.some((s) => s.id === id) ? { ...g, sets: g.sets.filter((s) => s.id !== id) } : g)) })
}

/** Close a tab group's tabs (each reopens with ⌘⇧T; the group goes with its last tab). */
export function closeSet(id: string) {
  const where = setById(id)
  if (where) closeTabIds(where.g.tabs.filter((t) => t.set === id).map((t) => t.id))
}

/** A new tab at the end of a tab group, shown (the pane's blank tab moves there if it has one). */
export function newTabInSet(id: string) {
  const where = setById(id)
  if (!where) return
  const { g } = where
  const blank = g.tabs.find(isBlank) ?? { id: newId(), to: "new" }
  const at = (x: Group) => { const r = runOf({ ...x, tabs: x.tabs.filter((t) => t.id !== blank.id) }, id); return r.at + r.n }
  const root = gather([blank], g.id, at, id)
  set({ root: mapGroups(root, (x) => (x.id === g.id ? { ...x, active: blank.id } : x)), focus: g.id })
  show("new", true)
}

/** Would moving a whole tab group there change anything? Not onto its own place. */
export function canMoveSet(id: string, gid: string, where: Side | "center" | number) {
  const from = setById(id)
  const to = groups().find((g) => g.id === gid)
  if (!from || !to) return false
  if (from.g.id !== gid || typeof where !== "number") return from.g.id !== gid || (where !== "center" && from.g.tabs.length > runOf(from.g, id).n)
  const r = runOf(from.g, id)
  return where < r.at || where > r.at + r.n
}

/** Move a whole tab group (dragged by its name): into a bar before its `where`th tab (never inside another group: before
 *  it), a pane's end, or a new split beside a pane. Its tabs keep their places in it; the pane it lands in gets the focus. */
export function moveSetTo(id: string, gid: string, where: Side | "center" | number) {
  if (!canMoveSet(id, gid, where)) return
  const { g: from, s } = setById(id)!
  const tabs = from.tabs.filter((t) => t.set === id), ids = new Set(tabs.map((t) => t.id))
  const shown = tabs.some((t) => t.id === from.active) ? from.active : null
  let root = mapGroups(getWorkspace().root, (g) => (g.id === from.id ? { ...without(g, ids), sets: g.sets!.filter((x) => x.id !== id) } : g))
  if (typeof where === "number" || where === "center") {
    const before = typeof where === "number" ? from.tabs.slice(0, where).filter((t) => from.id === gid && ids.has(t.id)).length : 0
    root = mapGroups(root, (g) => {
      if (g.id !== gid) return g
      const at = where === "center" ? g.tabs.length : outsideSets(g.tabs, Math.min(where - before, g.tabs.length))
      // (in its own pane the tab on screen stays; moved to another, it shows the moved one that was on screen there)
      const active = from.id === gid ? from.active : shown ?? g.active
      return { ...g, tabs: [...g.tabs.slice(0, at), ...tabs, ...g.tabs.slice(at)], active, sets: [...(g.sets ?? []), s] }
    })
  } else {
    const pane: Group = { id: `g${newId()}`, tabs, active: shown ?? tabs[0].id, sets: [s] }
    root = beside(root, gid, pane, where)
    gid = pane.id
  }
  set({ root, focus: gid })
  showActive()
}

// ---------- naming in place ----------

/** The tab group whose name is being typed, and where (the tab bar's chip or the Tabs panel's row): one place at a time. */
type Renaming = { id: string; at: "bar" | "panel" } | null
let renaming: Renaming = null
const renamed = signal()
export const askRenameSet = (id: string, at: "bar" | "panel") => { renaming = { id, at }; renamed.notify() }
export const useRenaming = () => renamed.use(() => renaming)
export const doneRenaming = () => { renaming = null; renamed.notify() }

// ---------- what agents ask (vau tabs: plugins/core/tabs/plugin.ts) ----------

/** The window's tabs, pane by pane, with their tab groups. */
export function tabsReport() {
  const { root, focus } = getWorkspace()
  return {
    panes: leaves(root).map((g, i) => ({
      pane: i + 1, id: g.id, focused: g.id === focus,
      tabs: g.tabs.map((t) => ({ id: t.id, to: t.to, ...(t.id === g.active ? { active: true } : {}), ...(t.pinned ? { pinned: true } : {}), ...(t.set ? { group: t.set } : {}) })),
      groups: (g.sets ?? []).map((s) => ({ ...s, tabs: runOf(g, s.id).n })),
    })),
  }
}
/** The tabs an agent names: by id, by what they show ("file:Notes/a.md", "view:terminal/x"), or by a file's path or name. */
function named(said: unknown): string[] {
  const all = groups().flatMap((g) => g.tabs)
  const out: string[] = []
  for (const q of Array.isArray(said) ? said.map(String) : []) {
    const low = q.toLowerCase().replace(/\.md$/, "")
    const hit = all.filter((t) => t.id === q || t.to === q || t.to === `file:${q}`)
    const found = hit.length ? hit : all.filter((t) => t.to.startsWith("file:") && (t.to.slice(5).toLowerCase().replace(/\.md$/, "") === low || t.to.slice(5).split("/").pop()!.toLowerCase().replace(/\.md$/, "") === low))
    if (!found.length) throw new Error(`no open tab is ${q} (vau tabs lists them)`)
    out.push(...found.map((t) => t.id).filter((id) => !out.includes(id)))
  }
  return out
}
answerUi("tabs", (m) => {
  if (m.do === "list") return tabsReport()
  const color = m.color === undefined || m.color === null ? undefined : String(m.color)
  if (color !== undefined && !isColor(color)) throw new Error(`a colour is one of ${COLORS.join(", ")}`)
  if (m.do === "group") {
    const ids = named(m.tabs)
    let id = typeof m.group === "string" && m.group ? m.group : null
    if (id && !setById(id)) throw new Error(`no tab group ${id} (vau tabs lists them)`)
    if (!id && !ids.length) throw new Error("say which tabs to group")
    if (id) addToSet(ids, id)
    else id = makeSet(ids, { name: typeof m.name === "string" ? m.name : undefined, color: color as Color | undefined })!
    if (typeof m.name === "string") renameSet(id, m.name)
    if (color) colorSet(id, color as Color)
    if (typeof m.collapsed === "boolean") foldSet(id, m.collapsed)
    const where = setById(id)!
    return { group: { ...where.s, tabs: where.g.tabs.filter((t) => t.set === id).map((t) => ({ id: t.id, to: t.to })) } }
  }
  if (m.do === "ungroup") {
    if (typeof m.group === "string" && m.group) {
      if (!setById(m.group)) throw new Error(`no tab group ${m.group} (vau tabs lists them)`)
      ungroupSet(m.group)
      return { ungrouped: m.group }
    }
    const ids = named(m.tabs)
    leaveSet(ids)
    return { removed: ids }
  }
  throw new Error("do is list, group or ungroup")
})
