// Workspaces: up to five setups (tabs, splits, panels, pins, `state`), a file per slot in .vaultite/plugins/workspaces/
// so devices on different ones never write the same file. Terminal tabs are saved with their machine (`shown`/`saved`).
import fs from "node:fs"
import path from "node:path"
import { HTTPError, type OpCtx, OpError, type Param, pathAsSaid, pinProblem, placePin, Plugin, readSidebars, relocatedPin, repinList, sameSidebars } from "../../../core/plugins.ts"
import { ConfigError, type Item } from "../../../core/vault.ts"
import { blankLayout, isBlank } from "./blank.ts"

export const plugin = new Plugin(import.meta.url)
export const MAX = 5

/** A workspace's sidebars are the default: none of its own, or the same as sidebars.json's. */
const defaultSidebars = (x: unknown) => x === undefined || sameSidebars(readSidebars(x), readSidebars(plugin.vault.config("sidebars")))

/** The slots as they're saved, checked: a slot is an object or null (unused: blank.ts), at most five, trailing unused
 *  ones left out. A workspace's `sidebars` reads as the app reads sidebars.json (core/sidebars.ts). */
export function slots(): (Item | null)[] {
  const list = Array.from({ length: MAX }, (_, i) => {
    const x = plugin.settings({}, String(i + 1))
    if (!Object.keys(x).length || isBlank(x, defaultSidebars)) return null
    const { sidebars, ...rest } = x
    const own = readSidebars(sidebars)
    return own ? { ...rest, sidebars: own } : rest
  })
  while (list.length && list[list.length - 1] === null) list.pop()
  return list
}

/** Write each slot this change changed to its own file, removing ones left unused. Refused while a file it would change
 *  doesn't read (iCloud mid-sync), never overwritten; other slots' files are never touched. */
function save(list: (Item | null)[]) {
  const was = slots()
  for (let i = 0; i < MAX; i++) {
    const d = list[i] ?? null
    const next = d && !isBlank(d, defaultSidebars) ? d : null
    // Unchanged; but a file that reads as unused (written by hand, or by an older app) goes.
    if (JSON.stringify(next) === JSON.stringify(was[i] ?? null) && (next || !Object.keys(plugin.settings({}, String(i + 1))).length)) continue
    readable(i)
    plugin.saveSettings(next, String(i + 1))
  }
}

/** Refuse (409, 503) when slot i's file (or with no i, any slot's) is there but doesn't read now: what's shown of it may
 *  not be what it holds, and a write would lose that. */
function readable(i?: number) {
  for (const n of i === undefined ? [...Array(MAX).keys()] : [i]) {
    try { plugin.readSettings(String(n + 1)) } catch (e) {
      if (!(e instanceof ConfigError)) throw e
      if (e.busy) throw new HTTPError(503, `workspace ${n + 1}'s file can't be read right now: try again`)
      throw new HTTPError(409, `workspace ${n + 1}'s file doesn't read as JSON right now: not overwriting it`)
    }
  }
}

function slot(arg: string) {
  const n = Number(arg)
  if (!Number.isInteger(n) || n < 1 || n > MAX) throw new HTTPError(400, `a workspace is 1 to ${MAX}, not '${arg}'`)
  return n - 1
}

// ---------- terminal tabs and the machine they run on (see the docstring) ----------
const TERM = "view:terminal/"
/** This server's id in the Machines list ("": none, one machine), as found last; found again now and then. */
let selfNow = ""
let selfAt = 0
let selfFind: Promise<string> | null = null
function findSelf(): Promise<string> {
  if (selfFind) return selfFind
  selfAt = Date.now()
  const fn = plugin.service("machines:self")
  if (typeof fn !== "function") { selfNow = ""; return Promise.resolve("") }
  selfFind = Promise.resolve().then(() => fn()).then((id) => { selfNow = typeof id === "string" ? id : "" }, () => {})
    .then(() => selfNow).finally(() => { selfFind = null })
  return selfFind
}
/** This machine's id, found within `ms` (else as found last). */
export const selfId = (ms = 1500) => Promise.race([findSelf(), new Promise<string>((r) => setTimeout(() => r(selfNow), ms).unref?.())])
let selfKey = ""
plugin.onSync(() => {
  // Again when the machines' list changed, else every minute (cheap: Machines knows itself by its address).
  const key = JSON.stringify(plugin.peer("machines")?.settings({}) ?? null)
  if (!plugin.service("machines:self")) selfNow = ""
  else if (key !== selfKey || Date.now() - selfAt > 60000) { selfKey = key; void findSelf() }
})

/** A tab's place as this machine's app has it: its own terminals without "@<this machine>". */
const localPlace = (to: string, self = selfNow) =>
  self && to.startsWith(TERM) && to.endsWith(`@${self}`) && to.length > TERM.length + self.length + 1 ? to.slice(0, -self.length - 1) : to
/** A tab's place as it's saved: a terminal of this machine's with "@<this machine>". */
const savedPlace = (to: string, self = selfNow) =>
  self && to.startsWith(TERM) && to.length > TERM.length && !to.includes("@") ? `${to}@${self}` : to
/** A layout with each tab's place changed by f (anything else as it is). */
function placesMapped(l: unknown, f: (to: string) => string): unknown {
  if (!l || typeof l !== "object" || !isNode((l as Layout).root)) return l
  const root = mapGroups((l as Layout).root, (g) => ({ ...g, tabs: g.tabs.map((t) => (t && typeof t.to === "string" ? { ...t, to: f(t.to) } : t)) }))
  return { ...(l as Layout), root }
}
/** The slots as this machine's app has them (`localPlace`). */
const shownSlot = (d: Item | null, self = selfNow): Item | null => withPins(d && self && layoutOf(d) ? { ...d, layout: placesMapped(d.layout, (to) => localPlace(to, self)) } : d)
/** Its pins where their files are now (one moved outside the app: Vault.relocated). */
const withPins = (d: Item | null) => { const own = ownPins(d); return own ? { ...d, pinned: relocatedPins(own) } : d }
const relocatedPins = (list: string[]) => [...new Set(list.map((p) => relocatedPin(plugin.vault, p)))]
export const shown = (self = selfNow) => slots().map((d) => shownSlot(d, self))

// What the app reads: the slots as this machine shows them. Worked out with the machine known (state is cached until
// the settings change: a workspace's tabs change them often).
plugin.state(async () => ({ workspaces: shown(await selfId()) }))

plugin.route("GET", "workspaces", async () => ({ workspaces: shown(await selfId()) }))

/** Every slot as saved, unused ones too (what `state` an unused one keeps is dropped on save: blank.ts). */
function slotList(): (Item | null)[] {
  const list = slots()
  while (list.length < MAX) list.push(null)
  return list
}
const obj = (v: unknown): Item => (v && typeof v === "object" && !Array.isArray(v) ? v as Item : {})

plugin.route("PUT", "workspaces/*", (req) => putSlot(slot(req.arg(0)), req.body))

/** Merge keys into slot i (0-based), making it if it's unused: PUT /api/workspaces/<n>. What the app is shown of it. */
function putSlot(i: number, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HTTPError(400, "send an object: the keys to change")
  const list = slotList()
  const next: Item = { ...(list[i] ?? {}) }
  // The tabs as this machine's app has them, saved with their machine (a terminal tab new to the file is this one's).
  for (const [k, v] of Object.entries(body)) {
    if (k === "layout" && v !== null) { next.layout = placesMapped(v, (to) => savedPlace(to)); continue }
    if (k === "state" && v !== null) {
      // Key by key: a device saving the files it opened doesn't put back another's open folders.
      const st = { ...obj(next.state) }
      for (const [sk, sv] of Object.entries(obj(v))) { if (sv === null) delete st[sk]; else st[sk] = sv }
      if (Object.keys(st).length) next.state = st; else delete next.state
    } else if (v === null) delete next[k]
    else next[k] = v
  }
  if (typeof next.name === "string" && !next.name.trim()) delete next.name
  list[i] = next
  save(list)
  return shown()[i] ?? null
}

/** A workspace's own pinned pages, or null when it has none of its own (the vault's apply). */
const ownPins = (d: Item | null) => (Array.isArray(d?.pinned) ? (d.pinned as unknown[]).filter((x): x is string => typeof x === "string" && !!x) : null)
/** The vault's pinned pages (pages.json, Pinned's): the default a workspace without its own shows. */
const vaultPins = () => { const p = plugin.vault.config("pages").pinned; return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string" && !!x) : [] }

plugin.route("POST", "workspaces/*/pins", (req) => pinIn(slot(req.arg(0)), obj(req.body)))

/** Pin or unpin one page in slot i's list (0-based): POST /api/workspaces/<n>/pins. */
function pinIn(i: number, body: Item) {
  const p = typeof body.path === "string" ? relocatedPin(plugin.vault, body.path.trim().replace(/^\/+/, "")) : ""
  if (!p) throw new HTTPError(400, "path is required")
  const list = slotList()
  const own = ownPins(list[i])
  const cur = relocatedPins(own ?? vaultPins())
  const on = body.pinned !== false
  // A page is a file (or a heading in one, or a search): a path that isn't one would be a pin nothing shows.
  const problem = on && !cur.includes(p) ? pinProblem(plugin.vault, p) : null
  if (problem) throw new HTTPError(404, problem)
  const before = body.before === null ? null : typeof body.before === "string" ? body.before : undefined
  const out = placePin(cur, p, on, before)
  // No change, nothing written (a workspace without its own list keeps following the vault's).
  if (out.join("\n") !== cur.join("\n")) {
    list[i] = { ...(list[i] ?? {}), pinned: out }
    save(list)
  }
  return { workspace: i + 1, pinned: out }
}

plugin.route("POST", "workspaces/*/pins/default", (req) => {
  const i = slot(req.arg(0))
  const own = ownPins(slotList()[i])
  if (!own) return { pinned: vaultPins() }
  plugin.vault.setConfig("pages", { ...plugin.vault.config("pages"), pinned: own })
  return { pinned: own }
})

/** Pages just pinned in the vault's list because their plugin brought them (Pinned, when they're installed): a
 *  workspace with a list of its own gets them too, at its end, so a plugin turned on shows its pages wherever you are. */
plugin.provide("pins:installed", (paths: string[]) => {
  const list = slotList()
  let changed = false
  const out = list.map((d) => {
    const own = ownPins(d)
    const add = own ? paths.filter((x) => !own.includes(x)) : []
    if (!add.length) return d
    changed = true
    return { ...d!, pinned: [...own!, ...add] }
  })
  if (changed) try { save(out) } catch { /* a file iCloud holds: left as it was */ }
})

// ---------- files moving: pins and tabs follow ----------
/** A file moved or trashed (dst null): every workspace's pins and tabs follow (a trashed file's tab stays, showing it's
 *  gone), so an AI's move leaves nothing stale in workspaces nobody's looking at. */
function follow(src: string, dst: string | null) {
  const list = slotList()
  const moved = (p: string) => (p === src ? dst : p.startsWith(src + "/") ? (dst === null ? null : dst + p.slice(src.length)) : p)
  let changed = false
  const out = list.map((d) => {
    if (!d) return d
    const next: Item = { ...d }
    const pins = ownPins(d)
    const pinned = pins && repinList(pins, src, dst)
    if (pins && pinned!.join("\n") !== pins.join("\n")) { changed = true; next.pinned = pinned }
    const l = layoutOf(d)
    if (l && dst !== null) {
      const root = mapGroups(l.root, (g) => ({ ...g, tabs: g.tabs.map((t) => {
        if (typeof t.to !== "string" || !t.to.startsWith("file:")) return t
        const to = moved(t.to.slice(5))
        return to && to !== t.to.slice(5) ? { ...t, to: `file:${to}` } : t
      }) }))
      if (JSON.stringify(root) !== JSON.stringify(l.root)) { changed = true; next.layout = { ...l, root } }
    }
    return next
  })
  if (changed) try { save(out) } catch { /* a file iCloud holds: left as it was */ }
}
plugin.onMove(follow)

/** Every place open in any workspace's tabs, as this machine has them, for "tabs:open": a terminal shown in a workspace
 *  nobody's looking at isn't idle. */
plugin.provide("tabs:open", () => shown().flatMap((d) => {
  const l = layoutOf(d)
  return l ? leaves(l.root).flatMap((g) => g.tabs.map((t) => t.to)).filter((t): t is string => typeof t === "string") : []
}))

plugin.route("DELETE", "workspaces/*", (req) => {
  const i = slot(req.arg(0))
  const list = slots()
  if (i < list.length) { list[i] = null; save(list) }
  return { ok: true }
})

// ---------- moving tabs and panes to another workspace, or opening files there ----------
// The app's layout shape, only what's needed here and checked loosely, since the file is written by hand too.
type Tab = { id: string; to: string }
type Group = { id: string; tabs: Tab[]; active: string }
type Split = { id: string; dir: string; kids: Node[]; sizes: number[] }
type Node = Group | Split
type Layout = { root: Node; focus?: string }
const isSplit = (n: Node): n is Split => Array.isArray((n as Split).kids)
const isNode = (n: unknown): n is Node => !!n && typeof n === "object" && (Array.isArray((n as Split).kids) || Array.isArray((n as Group).tabs))
const leaves = (n: Node): Group[] => (isSplit(n) ? n.kids.filter(isNode).flatMap(leaves) : [n])
const layoutOf = (d: Item | null): Layout | null => (d && isNode((d.layout as Layout | undefined)?.root) ? d.layout as Layout : null)
let seq = 0
const newId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

/** The tree without empty groups, splits of one, or a split inside another going the same way (as the app tidies it). */
function tidy(n: Node): Node | null {
  if (!isSplit(n)) return n.tabs.length ? n : null
  const kids: Node[] = [], sizes: number[] = []
  n.kids.forEach((k, i) => {
    const t = isNode(k) ? tidy(k) : null
    const s = n.sizes?.[i] > 0 ? n.sizes[i] : 1 / n.kids.length
    if (!t) return
    if (isSplit(t) && t.dir === n.dir) t.kids.forEach((x, j) => { kids.push(x); sizes.push(s * t.sizes[j]) })
    else { kids.push(t); sizes.push(s) }
  })
  if (kids.length < 2) return kids[0] ?? null
  const sum = sizes.reduce((a, b) => a + b, 0)
  return { ...n, kids, sizes: sizes.map((s) => s / sum) }
}
const mapGroups = (n: Node, f: (g: Group) => Group): Node => (isSplit(n) ? { ...n, kids: n.kids.map((k) => (isNode(k) ? mapGroups(k, f) : k)) } : f(n))

/** The layout without the tabs `ids`, as closing them would leave it (without closing anything: a terminal's shell
 *  runs on). A group left with none closes (a whole pane moved); a workspace left with none gets one blank tab. */
function without(l: Layout, ids: Set<string>): Layout {
  const was = leaves(l.root).map((g) => g.id)
  const root = tidy(mapGroups(l.root, (g) => {
    if (!g.tabs.some((t) => ids.has(t.id))) return g
    const tabs = g.tabs.filter((t) => !ids.has(t.id))
    const i = g.tabs.findIndex((t) => t.id === g.active)
    return { ...g, tabs, active: !ids.has(g.active) ? g.active : tabs[Math.min(Math.max(i, 0), tabs.length - 1)]?.id ?? "" }
  }))
  if (!root) { const t = newId("t"), g = was[0] ?? "g0"; return { root: { id: g, tabs: [{ id: t, to: "new" }], active: t }, focus: g } }
  // A focused group that closed hands the focus to its neighbour (after it, else before it).
  const gs = leaves(root)
  let focus = l.focus
  if (!gs.some((g) => g.id === focus)) {
    const i = Math.max(0, was.indexOf(focus ?? ""))
    focus = (gs.find((g) => g.id === was[i + 1]) ?? [...gs].reverse().find((g) => was.indexOf(g.id) < i) ?? gs[0]).id
  }
  return { ...l, root, focus }
}

/** Tabs coming into a layout, with new ids where theirs are taken there (ids are made per device). */
function freshIds(l: Layout | null, tabs: Tab[]): Tab[] {
  const taken = new Set(l ? leaves(l.root).flatMap((g) => g.tabs.map((t) => t.id)) : [])
  return tabs.map((t) => { const out = taken.has(t.id) ? { ...t, id: newId("t") } : t; taken.add(out.id); return out })
}
/** Tabs that are nothing yet (none, or a lone blank tab): what comes in takes their place. */
const unused = (l: Layout | null) => blankLayout(l)

/** The layout with `tabs` added at the end of the group focused last (not shown: each device keeps the tab it shows).
 *  A workspace with no tabs yet, or only one blank one, gets them in its place. */
function withTabs(l: Layout | null, tabs: Tab[]): { layout: Layout; tabs: Tab[] } {
  if (unused(l)) {
    const g = l ? leaves(l.root)[0]?.id ?? "g0" : "g0"
    return { layout: { root: { id: g, tabs, active: tabs[0].id }, focus: g }, tabs }
  }
  tabs = freshIds(l, tabs)
  const gs = leaves(l!.root)
  const into = gs.find((g) => g.id === l!.focus) ?? gs[0]
  const root = mapGroups(l!.root, (g) => (g.id !== into.id ? g : { ...g, tabs: [...g.tabs, ...tabs], active: g.tabs.some((t) => t.id === g.active) ? g.active : tabs[0].id }))
  return { layout: { ...l!, root }, tabs }
}

/** The layout with a whole pane (a group and its tabs) added as a new pane on the right, taking its share of the width;
 *  the focus stays where it was. A workspace with nothing yet is that pane. */
function withPane(l: Layout | null, g: Group): { layout: Layout; tabs: Tab[]; group: string } {
  if (unused(l)) return { layout: { root: g, focus: g.id }, tabs: g.tabs, group: g.id }
  const tabs = freshIds(l, g.tabs)
  const active = tabs[Math.max(0, g.tabs.findIndex((t) => t.id === g.active))].id
  const id = leaves(l!.root).some((x) => x.id === g.id) ? newId("g") : g.id
  const k = isSplit(l!.root) && l!.root.dir === "row" ? l!.root.kids.length : 1
  const root = tidy({ id: newId("s"), dir: "row", kids: [l!.root, { id, tabs, active }], sizes: [k / (k + 1), 1 / (k + 1)] })!
  return { layout: { ...l!, root }, tabs, group: id }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null)
/** A tab's target from a path: "Notes/Idea.md" -> "file:Notes/Idea.md"; "view:…" and "new" as they are. */
const targetOf = (p: string) => { const x = p.replace(/^\/+/, ""); return x.startsWith("view:") || x.startsWith("file:") || x === "new" ? x : `file:${x}` }

plugin.route("POST", "workspaces/move", (req) => {
  const body = (req.body ?? {}) as Item
  const to = slot(String(body.to ?? ""))
  const id = str(body.tab), gid = str(body.group), file = str(body.path)
  const open = (Array.isArray(body.open) ? body.open : [body.open]).filter((x): x is string => typeof x === "string" && !!x)
  if ([id, gid, file, open.length ? "open" : null].filter(Boolean).length !== 1) {
    throw new HTTPError(400, "say what, one of: `tab` (a tab's id), `group` (a pane's id: all its tabs), `path` (the file a tab shows) or `open` (files to open there)")
  }
  readable()
  const list = slots()
  while (list.length <= to) list.push(null)
  const dest = list[to] ?? {}

  // Files opened there (a file dragged from the tree onto a number): new tabs, like moved ones; one already open there
  // is left as it is.
  if (open.length) {
    const l = layoutOf(dest)
    const there = new Set(l ? leaves(l.root).flatMap((g) => g.tabs.map((t) => localPlace(t.to))) : [])
    const want = [...new Set(open.map((x) => localPlace(targetOf(x))))].filter((t) => t !== "new" && !there.has(t))
    for (const t of want) {
      if (t.startsWith("file:") && !fs.existsSync(path.join(plugin.vault.path, t.slice(5)))) throw new HTTPError(404, `there's no ${t.slice(5)} in the vault`)
    }
    if (!want.length) return { to: to + 1, tabs: [], workspaces: shown() }
    const put = withTabs(l, want.map((t) => ({ id: newId("t"), to: savedPlace(t) })))
    list[to] = { ...dest, layout: put.layout }
    save(list)
    return { to: to + 1, tabs: put.tabs.map((t) => ({ ...t, to: localPlace(t.to) })), tab: { ...put.tabs[0], to: localPlace(put.tabs[0].to) }, workspaces: shown() }
  }

  // Where it is: workspace `from`, or the one workspace that has it. A pane is found by its group's id (ids repeat
  // between workspaces: "g0" is everywhere, so say `from`), a tab by its id or the file it shows.
  const target = file ? localPlace(targetOf(file)) : null
  const what = id ? `tab ${id}` : gid ? `pane ${gid}` : file!
  const has = (i: number): Group | null => {
    const l = layoutOf(list[i])
    return l ? leaves(l.root).find((g) => (gid ? g.id === gid : g.tabs.some((t) => (id ? t.id === id : localPlace(t.to) === target)))) ?? null : null
  }
  let from: number
  if (body.from !== undefined && body.from !== null) {
    from = slot(String(body.from))
    if (!has(from)) throw new HTTPError(404, `${what} isn't open in workspace ${from + 1}`)
  } else {
    const where = list.map((_, i) => i).filter((i) => has(i))
    if (!where.length) throw new HTTPError(404, `${what} isn't open in any workspace`)
    if (where.length > 1) throw new HTTPError(409, `${what} is open in workspaces ${where.map((i) => i + 1).join(" and ")}: say which with \`from\``)
    from = where[0]
  }
  if (from === to) throw new HTTPError(400, `${what} is already in workspace ${to + 1}`)
  const g = has(from)!
  const moving = (gid ? g.tabs : g.tabs.filter((t) => (id ? t.id === id : localPlace(t.to) === target)).slice(0, 1)).map((t) => ({ id: t.id, to: t.to }))
  list[from] = { ...list[from]!, layout: without(layoutOf(list[from])!, new Set(moving.map((t) => t.id))) }
  // What's open there already isn't opened twice (two tabs of one terminal would fight over its size): it just leaves
  // here, and the tab there stays as it is.
  const dl = layoutOf(dest)
  const there = new Set(dl ? leaves(dl.root).flatMap((x) => x.tabs.map((t) => localPlace(t.to))) : [])
  const coming = moving.filter((t) => t.to === "new" || !there.has(localPlace(t.to)))
  if (!coming.length) {
    save(list)
    return { from: from + 1, to: to + 1, tabs: [], workspaces: shown() }
  }
  const active = coming.some((t) => t.id === g.active) ? g.active : coming[0].id
  const put = gid ? withPane(dl, { id: g.id, tabs: coming, active }) : withTabs(dl, coming)
  list[to] = { ...dest, layout: put.layout }
  save(list)
  const tabs = put.tabs.map((t) => ({ ...t, to: localPlace(t.to) }))
  return { from: from + 1, to: to + 1, tabs, tab: tabs[0], ...("group" in put ? { group: put.group } : {}), workspaces: shown() }
})

plugin.route("POST", "workspaces/close", async (req) => {
  const body = (req.body ?? {}) as Item
  const id = str(body.tab), file = str(body.path)
  if ([id, file].filter(Boolean).length !== 1) throw new HTTPError(400, "say what, one of: `tab` (a tab's id) or `path` (what its tabs show: a file, or view:terminal/<id>)")
  const self = await selfId()
  const only = body.from !== undefined && body.from !== null ? slot(String(body.from)) : null
  readable(only ?? undefined)
  const list = slots()
  // As this machine's app has them: its own terminals without "@<this machine>", whichever way they're saved or named.
  const target = file ? localPlace(targetOf(file), self) : null
  // A tab by its id (in `from`, or the one workspace that has it), or every tab showing `path` (in `from`, or in every
  // workspace): like closing them in the app, without ending anything (a terminal's shell runs on).
  const closing = list.map((w, i) => {
    const l = layoutOf(w)
    if (!l || (only !== null && i !== only)) return []
    return leaves(l.root).flatMap((g) => g.tabs.filter((t) => (id ? t.id === id : localPlace(t.to, self) === target)).map((t) => ({ id: t.id, to: localPlace(t.to, self) })))
  })
  const where = closing.flatMap((tabs, i) => (tabs.length ? [i] : []))
  const what = id ? `tab ${id}` : target!.replace(/^file:/, "")
  if (!where.length) throw new HTTPError(404, `${what} isn't open in ${only !== null ? `workspace ${only + 1}` : "any workspace"}`)
  if (id && where.length > 1) throw new HTTPError(409, `${what} is open in workspaces ${where.map((i) => i + 1).join(" and ")}: say which with \`from\``)
  for (const i of where) list[i] = { ...list[i]!, layout: without(layoutOf(list[i])!, new Set(closing[i].map((t) => t.id))) }
  save(list)
  return { closed: where.flatMap((i) => closing[i].map((t) => ({ workspace: i + 1, ...t }))), workspaces: shown(self) }
})

// ---------- for the core's operations and vau: which workspace's panels and pins, and the workspace ops ----------

const nameOf = (w: Item | null | undefined, n: number) => (w && typeof w.name === "string" ? w.name : `Workspace ${n}`)
const pinsOf = (w: Item | null | undefined) => (w && Array.isArray(w.pinned) ? (w.pinned as unknown[]).filter((x): x is string => typeof x === "string") : null)

/** Workspace n's sidebars, for the core's panel ops (`vau panels`): its own setup (null: sidebars.json's) and how to
 *  save one. */
plugin.provide("sidebars:of", (n: number) => {
  const w = shown()[n - 1] ?? null
  return { label: `Workspace ${n}${w ? ` (${nameOf(w, n)})` : ""}`, setup: w ? readSidebars(w.sidebars) : null,
    save: (next: unknown) => putSlot(n - 1, { sidebars: next }) }
})

/** Workspace n's pinned pages, for Pinned's ops (`vau pin`): its own list (null: pages.json's, until its first change)
 *  and one change to it. */
plugin.provide("pins:of", (n: number) => {
  const w = shown()[n - 1] ?? null
  return { label: `workspace ${n}${w ? ` (${nameOf(w, n)})` : ""}`, pinned: pinsOf(w),
    pin: (p: string, on: boolean, before?: string) => pinIn(n - 1, { path: p, pinned: on, ...(before ? { before } : {}) }) }
})

/** What `vau context` says of it: the workspace the user's window is on. */
plugin.provide("context", ({ workspace: n }: { workspace: number | null }) => {
  if (!n) return null
  const label = nameOf(shown()[n - 1], n)
  return { data: { workspace: { n, label } }, text: `Workspace: ${n} (${label}), the one the user's window is on (vau workspace lists them)` }
})

type PaneTabs = { pane: number; group: string; focused: boolean; tabs: { id: string; to: string; path?: string }[] }

/** A workspace's tabs, pane by pane (left to right, top to bottom). */
function workspaceTabs(w: Item, n: number) {
  const panes: PaneTabs[] = []
  const l = layoutOf(w)
  for (const g of l ? leaves(l.root) : []) {
    panes.push({ pane: panes.length + 1, group: String(g.id), focused: g.id === l!.focus,
      tabs: g.tabs.filter((t) => t && typeof t.to === "string").map((t) => ({ id: String(t.id), to: t.to, ...(t.to.startsWith("file:") ? { path: t.to.slice(5) } : {}) })) })
  }
  return { workspace: n, name: nameOf(w, n), panes }
}
const allTabs = () => shown().flatMap((w, i) => (w ? [workspaceTabs(w, i + 1)] : []))

/** The workspace the user's window is on (the app tells the server), or null. */
async function windowOn(ctx: OpCtx): Promise<number | null> {
  try { const n = (await ctx.ui(null) as Item)?.workspace; return Number.isInteger(n) ? n as number : null } catch { return null }
}

const N = (description: string, required = true): Param => ({ type: "integer", minimum: 1, maximum: MAX, required, description })
const FROM: Param = { type: "integer", minimum: 1, maximum: MAX, description: "the workspace it's in, when it's open in several" }

const HELP = `The Workspaces plugin keeps up to five workspaces, numbered in the sidebar's header: each is a desk, what's
open (the tabs and splits, \`layout\`), what's within reach (the sidebars' panels, \`sidebars\`, shaped like
.vaultite/sidebars.json, none: that file's; its pinned pages, \`pinned\`, none: .vaultite/pages.json's, until its
first pin or unpin) and what the app keeps for it (\`state\`), in .vaultite/plugins/workspaces/<n>.json (a file each,
none: unused; edit one to change it). A workspace with no name or pinned pages of its own, the default
sidebars and only a blank tab counts as unused: it's listed as such and never kept. There always is a current one, each window's own (vau context says the user's). With a number, the window the
user was in last switches to it (the command workspace:<n>; an unused one shows sidebars.json's sidebars and a blank
tab, and is made once something changes there).

tabs: each workspace's tabs (or workspace <n>'s), pane by pane: the tab's id and what it shows (a file's path, or
view:terminal/<id>, new for a blank tab). Panes are numbered left to right, top to bottom; * marks the one focused last.

move: moves a tab to workspace <n> (POST /api/workspaces/move), like dragging it onto that number in the sidebar's
header: it leaves its workspace (its pane closes if it was the last tab there; a workspace's only tab leaves a blank
one) and goes at the end of <n>'s pane focused last (made with plugins.json's sidebar if <n> is empty). Name it by
its tab id (from vau workspace tabs) or by the file it shows (a path or a name, like vau open); if that file is open in
several workspaces, say which with --from <m>. --pane moves the whole pane that has it, all its tabs, like dragging
the pane by its handle onto the number: it becomes a pane of its own on the right of <n>'s. Every open window on either
workspace follows at once; nobody is switched, and nothing is closed (a terminal's shell keeps running).

open: opens a file in workspace <n> (a new tab at the end of its pane focused last, not shown there; nothing if it's
already open there), like dragging it from the file tree onto the number. Nobody is switched.

close: closes a tab by its id, or every tab showing a file or a view (view:terminal/<id>), in every workspace or in
--from <m>'s (POST /api/workspaces/close). Every open window follows at once. Closing a terminal's tab doesn't end
its session (vau terminal end does both).

  vau workspace
  vau workspace 2
  vau workspace tabs
  vau workspace tabs 1 --json
  vau workspace move "Notes/Idea.md" 2
  vau workspace move Idea 3 --from 1
  vau workspace move t1k2x9a0 2
  vau workspace move Idea 2 --pane
  vau workspace open "Notes/Idea.md" 3
  vau workspace close t1k2x9a0
  vau workspace close view:terminal/claude-k3j2h1g0
  vau workspace close "Notes/Idea.md" --from 2`

/** What a tab given as a file (a path or a name), a view or a tab's id is: its id, or what it shows ("file:<path>"). */
async function tabNamed(ctx: OpCtx, what: string, ids: Set<string>) {
  if (ids.has(what)) return { id: what, target: null }
  const target = what.startsWith("view:") || what === "new" ? what : pathAsSaid(await ctx.api("GET", "files"), what)
  return { id: null, target }
}

plugin.op({
  id: "workspace.list",
  cli: "workspace list",
  summary: "The workspaces (1 to 5): each one's panels, pinned pages and how many tabs; unused ones say so.",
  help: HELP,
  kind: "read",
  run: async (_p, ctx) => ({ workspaces: shown(), window: await windowOn(ctx) }),
  text: (r) => listText(r),
})

/** The workspaces as `vau workspace` prints them. */
function listText(r: { workspaces: (Item | null)[]; window: number | null }) {
  const rows = r.workspaces.map((w, i) => {
    const here = i + 1 === r.window ? " (the user's window)" : ""
    if (!w) return `${i + 1}. (unused)${here}`
    const sb = w.sidebars as { left?: unknown; right?: unknown } | undefined
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : [])
    const panels = sb ? `left ${strs(sb.left).join(", ") || "(none)"}; right ${strs(sb.right).join(", ") || "(none)"}` : "sidebars.json's sidebars"
    const count = workspaceTabs(w, i + 1).panes.reduce((t, p) => t + p.tabs.length, 0)
    const pins = pinsOf(w) ? `pinned: ${pinsOf(w)!.join(", ") || "(none)"}` : "pages.json's pinned pages"
    return `${i + 1}. ${nameOf(w, i + 1)}${here}: ${panels}; ${pins}; ${count || 1} tab(s)`
  })
  return rows.length ? rows.join("\n") : "(no workspaces yet: the sidebars are .vaultite/sidebars.json's)"
}

plugin.op({
  id: "workspace.switch",
  cli: "workspace",
  summary: "Switch the user's window to a workspace (1 to 5); without one, list the workspaces.",
  help: HELP,
  kind: "write",
  params: { n: N("the workspace to switch to; left out: the list (vau workspace list)", false) },
  args: ["n"],
  run: async ({ n }, ctx) => {
    if (!n) return await ctx.op("workspace.list")
    try {
      return { switched: n, window: await ctx.ui({ action: "command", id: `workspace:${n}` }) }
    } catch (e) {
      if (e instanceof OpError && e.status === 409) throw new OpError("no app window is open on this server: open the app (browser or desktop) first", 409)
      throw e
    }
  },
  text: (r, p) => (p.n ? `Sent workspace:${p.n}.` : listText(r)),
})

plugin.op({
  id: "workspace.tabs",
  cli: "workspace tabs",
  summary: "Each workspace's tabs (or one's), pane by pane: the tab's id and what it shows.",
  help: HELP,
  kind: "read",
  params: { n: N("only this workspace", false) },
  args: ["n"],
  run: ({ n }) => {
    const out = allTabs().filter((w) => !n || w.workspace === n)
    if (n && !out.length) throw new OpError(`workspace ${n} is unused`, 404)
    return out
  },
  text: (out: ReturnType<typeof workspaceTabs>[]) => {
    const rows = out.flatMap((w) => [
      `${w.workspace}. ${w.name}`,
      ...(w.panes.length ? w.panes.flatMap((p) => [`  pane ${p.pane}${p.focused ? " *" : ""}`, ...p.tabs.map((t) => `    ${t.id}  ${t.path ?? t.to}`)]) : ["  (one blank tab)"]),
    ])
    return rows.length ? rows.join("\n") : "(no workspaces yet: the sidebar uses .vaultite/plugins.json)"
  },
})

plugin.op({
  id: "workspace.move",
  cli: "workspace move",
  summary: "Move a tab (or with pane, the whole pane that has it) to another workspace, like dragging it onto its number.",
  help: HELP,
  kind: "write",
  params: {
    tab: { type: "string", required: true, description: "the tab: its id (vau workspace tabs), or the file or view it shows (a path or a name)" },
    to: N("the workspace to move it to"),
    from: FROM,
    pane: { type: "boolean", description: "move the whole pane that has it, all its tabs" },
  },
  args: ["tab", "to"],
  run: async ({ tab: what, to, from, pane }, ctx) => {
    const all = allTabs()
    const tabs = all.flatMap((w) => w.panes.flatMap((p) => p.tabs.map((t) => ({ ...t, workspace: w.workspace }))))
    const { id, target } = await tabNamed(ctx, what, new Set(tabs.map((t) => t.id)))
    const shows = target && (target.startsWith("view:") || target === "new" ? target : `file:${target}`)
    const found = tabs.filter((t) => (id ? t.id === id : t.to === shows) && (!from || t.workspace === from))
    if (!id) {
      const where = [...new Set(tabs.filter((t) => t.to === shows).map((t) => t.workspace))]
      if (!where.length) throw new OpError(`${target} isn't open in any workspace (vau workspace tabs lists them)`, 404)
      if (where.length > 1 && !from) throw new OpError(`${target} is open in workspaces ${where.join(" and ")}: say which with from`, 409)
    }
    if (pane) {
      // The pane that has it, by its group's id (ids repeat between workspaces, so with its workspace).
      const t = found[0]
      if (!t) throw new OpError(`${id ? `tab ${id}` : target} isn't open${from ? ` in workspace ${from}` : ""}`, 404)
      const p = all.find((w) => w.workspace === t.workspace)!.panes.find((x) => x.tabs.some((y) => y.id === t.id))!
      const r = await ctx.api("POST", "workspaces/move", { from: t.workspace, to, group: p.group })
      return { ...r, moved: `pane ${p.pane} (${p.tabs.length} tab${p.tabs.length === 1 ? "" : "s"})` }
    }
    const r = await ctx.api("POST", "workspaces/move", { to, ...(from ? { from } : {}), ...(id ? { tab: id } : { path: target }) })
    return { ...r, moved: `${id ? `tab ${id}` : target}`, ...(r.tab?.id && r.tab.id !== what ? { as: r.tab.id } : {}) }
  },
  text: (r) => `Moved ${r.moved} from workspace ${r.from} to workspace ${r.to}${r.as && !r.moved.startsWith("pane") ? ` (tab ${r.as})` : ""}.`,
})

plugin.op({
  id: "workspace.open",
  cli: "workspace open",
  summary: "Open a file in another workspace (a new tab there, not shown; nobody is switched).",
  help: HELP,
  kind: "write",
  params: {
    path: { type: "string", format: "path", required: true, description: "the file (a path, or a name as the user says it)" },
    to: N("the workspace to open it in"),
  },
  args: ["path", "to"],
  run: async ({ path: file, to }, ctx) => ({ ...await ctx.api("POST", "workspaces/move", { to, open: [file] }), path: file }),
  text: (r) => (r.tabs.length ? `Opened ${r.path} in workspace ${r.to}.` : `${r.path} is already open in workspace ${r.to}.`),
})

plugin.op({
  id: "workspace.close",
  cli: "workspace close",
  summary: "Close a tab by its id, or every tab showing a file or a view, in every workspace or one (nothing is ended).",
  help: HELP,
  kind: "write",
  params: {
    tab: { type: "string", required: true, description: "the tab's id, or the file or view (view:terminal/<id>) its tabs show" },
    from: { ...FROM, description: "only in this workspace" },
  },
  args: ["tab"],
  run: async ({ tab: what, from }, ctx) => {
    const ids = new Set(allTabs().flatMap((w) => w.panes.flatMap((p) => p.tabs.map((t) => t.id))))
    const { id, target } = await tabNamed(ctx, what, ids)
    return { ...await ctx.api("POST", "workspaces/close", { ...(from ? { from } : {}), ...(id ? { tab: id } : { path: target }) }), what }
  },
  text: (r) => {
    const closed = r.closed as { workspace: number; id: string; to: string }[]
    const at = [...new Set(closed.map((t) => t.workspace))].join(", ")
    return `Closed ${closed.length === 1 ? closed[0].to.replace(/^file:/, "") : `${closed.length} tabs of ${r.what}`} in workspace ${at}.`
  },
})
