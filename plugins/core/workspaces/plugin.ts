import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { fileTree, HTTPError, type OpCtx, OpError, type Param, pathAsSaid, pinProblem, placePin, Plugin, readSidebars, relocatedPin, repinList, sameSidebars } from "../../../core/plugins.ts"
import { ConfigError, type Item } from "../../../core/vault.ts"
import { allPanes, blankList, clean, mapPlaces, newPaneId, newTabId, panesOf, placesIn, placesOf, tabWith, tabWithout, withoutPanes, withoutTabs, type Pane, type Tab, type TabList, type Workspace } from "../../../core/layout.ts"
import { blankLayout, isBlank } from "./blank.ts"

export const plugin = new Plugin(import.meta.url)
export const MAX = 5

const defaultSidebars = (x: unknown) => x === undefined || sameSidebars(readSidebars(x), readSidebars(plugin.vault.config("sidebars")))

const RUNTIME = ["layout", "state"]
const filePart = (d: Item) => Object.fromEntries(Object.entries(d).filter(([k]) => !RUNTIME.includes(k)))
const keptPart = (d: Item) => Object.fromEntries(Object.entries(d).filter(([k]) => RUNTIME.includes(k)))
const keptOfSlot = (i: number) => plugin.kept<Item>(String(i + 1), {})

export function slots(): (Item | null)[] {
  const list = Array.from({ length: MAX }, (_, i) => {
    const x = { ...filePart(plugin.settings({}, String(i + 1))), ...keptOfSlot(i) }
    if (!Object.keys(x).length || isBlank(x, defaultSidebars)) return null
    const { sidebars, ...rest } = x
    const own = readSidebars(sidebars)
    return own ? { ...rest, sidebars: own } : rest
  })
  while (list.length && list[list.length - 1] === null) list.pop()
  return list
}

function save(list: (Item | null)[]) {
  for (let i = 0; i < MAX; i++) {
    const d = list[i] ?? null
    const next = d && !isBlank(d, defaultSidebars) ? d : null
    const run = next ? keptPart(next) : {}
    plugin.keep(String(i + 1), Object.keys(run).length ? run : null, { shared: true })
    const own = next ? filePart(next) : {}, had = plugin.settings({}, String(i + 1))
    if (JSON.stringify(own) === JSON.stringify(had)) continue
    readable(i)
    plugin.saveSettings(Object.keys(own).length ? own : null, String(i + 1))
  }
}

let lookedAt = ""
plugin.onSync((vault) => {
  const key = `${vault.path}:${vault.settingsVersion}`
  if (key === lookedAt) return
  lookedAt = key
  for (let i = 0; i < MAX; i++) {
    let d: Item | null
    try { d = plugin.readSettings(String(i + 1)) } catch { continue }
    if (!d || !RUNTIME.some((k) => k in d!)) continue
    // not by the file's time: a coarse clock (Linux) can date it before what was kept a moment earlier
    plugin.keep(String(i + 1), { ...keptOfSlot(i), ...keptPart(d) }, { shared: true })
    const own = filePart(d)
    plugin.saveSettings(Object.keys(own).length ? own : null, String(i + 1))
  }
  migrateLayouts()
})
function migrateLayouts() {
  for (let i = 0; i < MAX; i++) {
    const k = keptOfSlot(i), l = k.layout as Item | undefined
    if (!l || typeof l !== "object" || Array.isArray(l.tabs) || !l.root) continue
    const w = clean(l)
    plugin.keep(String(i + 1), { ...k, layout: w ?? undefined }, { shared: true })
  }
}

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

const TERM = "view:terminal/"
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
export const selfId = (ms = 1500) => Promise.race([findSelf(), new Promise<string>((r) => setTimeout(() => r(selfNow), ms).unref?.())])
let selfKey = ""
plugin.onSync(() => {
  const key = JSON.stringify(plugin.peer("machines")?.settings({}) ?? null)
  if (!plugin.service("machines:self")) selfNow = ""
  else if (key !== selfKey || Date.now() - selfAt > 60000) { selfKey = key; void findSelf() }
})

const localPlace = (to: string, self = selfNow) =>
  self && to.startsWith(TERM) && to.endsWith(`@${self}`) && to.length > TERM.length + self.length + 1 ? to.slice(0, -self.length - 1) : to
const savedPlace = (to: string, self = selfNow) =>
  self && to.startsWith(TERM) && to.length > TERM.length && !to.includes("@") ? `${to}@${self}` : to
const placesMapped = (l: Workspace, f: (to: string) => string): Workspace => {
  const list = <L extends TabList>(x: L): L => ({ ...x, tabs: x.tabs.map((t) => ({ ...t, root: mapPlaces(t.root, (p) => ({ ...p, to: f(p.to) })) })) })
  return { ...list(l), ...(l.windows ? { windows: l.windows.map(list) } : {}) }
}
const shownSlot = (d: Item | null, self = selfNow): Item | null => {
  const l = self ? layoutOf(d) : null
  return withPins(l ? { ...d, layout: placesMapped(l, (to) => localPlace(to, self)) } : d)
}
const withPins = (d: Item | null) => { const own = ownPins(d); return own ? { ...d, pinned: relocatedPins(own) } : d }
const relocatedPins = (list: string[]) => [...new Set(list.map((p) => relocatedPin(plugin.vault, p)))]
export const shown = (self = selfNow) => slots().map((d) => shownSlot(d, self))

plugin.state(async () => ({ workspaces: shown(await selfId()) }))

plugin.route("GET", "workspaces", async () => ({ workspaces: shown(await selfId()) }))

function slotList(): (Item | null)[] {
  const list = slots()
  while (list.length < MAX) list.push(null)
  return list
}
const obj = (v: unknown): Item => (v && typeof v === "object" && !Array.isArray(v) ? v as Item : {})

plugin.route("PUT", "workspaces/*", (req) => putSlot(slot(req.arg(0)), req.body))

function putSlot(i: number, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HTTPError(400, "send an object: the keys to change")
  const list = slotList()
  const next: Item = { ...(list[i] ?? {}) }
  for (const [k, v] of Object.entries(body)) {
    if (k === "layout" && v !== null) { const w = clean(v); if (w) next.layout = placesMapped(w, (to) => savedPlace(to)); else delete next.layout; continue }
    if (k === "state" && v !== null) {
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

const ownPins = (d: Item | null) => (Array.isArray(d?.pinned) ? d.pinned.filter((x): x is string => typeof x === "string" && !!x) : null)
const vaultPins = () => { const p = plugin.vault.config("pages").pinned; return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string" && !!x) : [] }

plugin.route("POST", "workspaces/*/pins", (req) => pinIn(slot(req.arg(0)), obj(req.body)))

function pinIn(i: number, body: Item) {
  const p = typeof body.path === "string" ? relocatedPin(plugin.vault, body.path.trim().replace(/^\/+/, "")) : ""
  if (!p) throw new HTTPError(400, "path is required")
  const list = slotList()
  const own = ownPins(list[i])
  const cur = relocatedPins(own ?? vaultPins())
  const on = body.pinned !== false
  const problem = on && !cur.includes(p) ? pinProblem(plugin.vault, p) : null
  if (problem) throw new HTTPError(404, problem)
  const before = body.before === null ? null : typeof body.before === "string" ? body.before : undefined
  const out = placePin(cur, p, on, before)
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

/** Pages a plugin just pinned in the vault's list: a workspace with a list of its own gets them too, at its end. */
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
      const after = placesMapped(l, (to) => { if (!to.startsWith("file:")) return to; const m = moved(to.slice(5)); return m ? `file:${m}` : to })
      if (JSON.stringify(after) !== JSON.stringify(l)) { changed = true; next.layout = after }
    }
    return next
  })
  if (changed) try { save(out) } catch { /* a file iCloud holds: left as it was */ }
}
plugin.onMove(follow)

/** Every place open in any workspace's tabs, as this machine has them: a terminal shown in a workspace nobody's looking at isn't idle. */
plugin.provide("tabs:open", () => shown().flatMap((d) => {
  const l = layoutOf(d)
  return l ? [l, ...(l.windows ?? [])].flatMap(allPanes).map((p) => p.to) : []
}))

plugin.route("DELETE", "workspaces/*", (req) => {
  const i = slot(req.arg(0))
  const list = slots()
  if (i < list.length) { list[i] = null; save(list) }
  return { ok: true }
})

const layoutOf = (d: Item | null): Workspace | null => clean(d?.layout)
const nothing = (l: Workspace | null) => !l || blankLayout(l)

function without(l: Workspace, tabs: Set<string>, panes = new Set<string>()): Workspace {
  const left = withoutPanes(withoutTabs(l, tabs) ?? blankList(), panes)
  return { ...(left ?? blankList()), ...(l.windows ? { windows: l.windows } : {}) }
}

function freshIds(l: Workspace | null, tabs: Tab[]): Tab[] {
  const taken = new Set(l ? [l, ...(l.windows ?? [])].flatMap((x) => x.tabs.flatMap((t) => [t.id, ...placesIn(t).map((p) => p.id)])) : [])
  return tabs.map((t) => {
    const ids = new Map(placesIn(t).map((p) => [p.id, taken.has(p.id) ? newPaneId() : p.id]))
    const out = { ...t, id: taken.has(t.id) ? newTabId() : t.id, root: mapPlaces(t.root, (p) => ({ ...p, id: ids.get(p.id)! })), focus: ids.get(t.focus) ?? t.focus }
    taken.add(out.id); ids.forEach((id) => taken.add(id))
    return out
  })
}
function withTabs(l: Workspace | null, tabs: Tab[], at?: number, group?: string): { layout: Workspace; tabs: Tab[] } {
  const bare = tabs.map((t) => { const { group: _, ...rest } = t; return rest })
  if (nothing(l)) return { layout: { tabs: bare, active: bare[0].id }, tabs: bare }
  const list = l!.tabs, i = at === undefined ? list.length : Math.max(0, Math.min(list.length, at))
  const inGroup = !!group && (list[i - 1]?.group === group || list[i]?.group === group)
  const fresh = freshIds(l, bare).map((t) => (inGroup ? { ...t, group } : t))
  return { layout: { ...l!, tabs: [...list.slice(0, i), ...fresh, ...list.slice(i)] }, tabs: fresh }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null)
const targetOf = (p: string) => { const x = p.replace(/^\/+/, ""); return x.startsWith("view:") || x.startsWith("file:") || x === "new" ? x : `file:${x}` }
type Found = { tab: Tab; pane?: Pane }

plugin.route("POST", "workspaces/move", (req) => {
  const body = req.body
  const to = slot(String(body.to ?? ""))
  const id = str(body.tab), pid = str(body.pane), file = str(body.path)
  const open = (Array.isArray(body.open) ? body.open : [body.open]).filter((x): x is string => typeof x === "string" && !!x)
  if ([id, pid, file, open.length ? "open" : null].filter(Boolean).length !== 1) {
    throw new HTTPError(400, "say what, one of: `tab` (a tab's id: all its panes), `pane` (a pane's id: out of its split), `path` (the file a pane shows) or `open` (files to open there)")
  }
  readable()
  const list = slots()
  while (list.length <= to) list.push(null)
  const dest = list[to] ?? {}

  if (open.length) {
    const l = layoutOf(dest)
    const there = new Set(l ? allPanes(l).map((p) => localPlace(p.to)) : [])
    const want = [...new Set(open.map((x) => localPlace(targetOf(x))))].filter((t) => t !== "new" && !there.has(t))
    for (const t of want) {
      if (t.startsWith("file:") && !fs.existsSync(path.join(plugin.vault.path, t.slice(5)))) throw new HTTPError(404, `there's no ${t.slice(5)} in the vault`)
    }
    if (!want.length) return { to: to + 1, tabs: [], workspaces: shown() }
    const put = withTabs(l, want.map((t) => tabWith({ id: newPaneId(), to: savedPlace(t) })))
    list[to] = { ...dest, layout: put.layout }
    save(list)
    const tabs = put.tabs.map(local)
    return { to: to + 1, tabs, tab: tabs[0], workspaces: shown() }
  }

  const target = file ? localPlace(targetOf(file)) : null
  const what = id ? `tab ${id}` : pid ? `pane ${pid}` : file!
  const has = (i: number): Found | null => {
    const l = layoutOf(list[i])
    if (!l) return null
    for (const t of l.tabs) {
      if (id && t.id === id) return { tab: t }
      const p = placesIn(t).find((x) => (pid ? x.id === pid : !id && localPlace(x.to) === target))
      if (p) return { tab: t, pane: p }
    }
    return null
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
  const f = has(from)!
  const alone = f.pane && panesOf(f.tab).length > 1 ? f.pane : null
  const moving: Tab = alone ? tabWith(alone, `t${alone.id}`) : f.tab
  list[from] = { ...list[from]!, layout: alone ? without(layoutOf(list[from])!, new Set(), new Set([alone.id])) : without(layoutOf(list[from])!, new Set([f.tab.id])) }
  const dl = layoutOf(dest)
  const there = new Set(dl ? allPanes(dl).map((p) => localPlace(p.to)) : [])
  const going = placesIn(moving).filter((p) => p.to !== "new" && there.has(localPlace(p.to)))
  const coming = going.length ? tabWithout(moving, new Set(going.map((p) => p.id))) : moving
  if (!coming) {
    save(list)
    return { from: from + 1, to: to + 1, tabs: [], workspaces: shown() }
  }
  const at = typeof body.at === "number" && Number.isInteger(body.at) ? body.at : undefined
  const put = withTabs(dl, [coming], at, str(body.group) ?? undefined)
  list[to] = { ...dest, layout: put.layout }
  save(list)
  const tabs = put.tabs.map(local)
  return { from: from + 1, to: to + 1, tabs, tab: tabs[0], workspaces: shown() }
})
const local = (t: Tab): Tab => ({ ...t, root: mapPlaces(t.root, (p) => ({ ...p, to: localPlace(p.to) })) })

plugin.route("POST", "workspaces/close", async (req) => {
  const body = req.body
  const id = str(body.tab), file = str(body.path)
  if ([id, file].filter(Boolean).length !== 1) throw new HTTPError(400, "say what, one of: `tab` (a tab's or pane's id) or `path` (what its panes show: a file, or view:terminal/<id>)")
  const self = await selfId()
  const only = body.from !== undefined && body.from !== null ? slot(String(body.from)) : null
  readable(only ?? undefined)
  const list = slots()
  const target = file ? localPlace(targetOf(file), self) : null
  const closing = list.map((w, i) => {
    const l = layoutOf(w)
    if (!l || (only !== null && i !== only)) return []
    return l.tabs.flatMap((t) => (id === t.id ? placesIn(t) : placesIn(t).filter((p) => (id ? p.id === id : localPlace(p.to, self) === target))).map((p) => ({ id: p.id, tab: t.id, to: localPlace(p.to, self) })))
  })
  const where = closing.flatMap((tabs, i) => (tabs.length ? [i] : []))
  const what = id ? `tab ${id}` : target!.replace(/^file:/, "")
  if (!where.length) throw new HTTPError(404, `${what} isn't open in ${only !== null ? `workspace ${only + 1}` : "any workspace"}`)
  if (id && where.length > 1) throw new HTTPError(409, `${what} is open in workspaces ${where.map((i) => i + 1).join(" and ")}: say which with \`from\``)
  for (const i of where) list[i] = { ...list[i]!, layout: without(layoutOf(list[i])!, new Set(), new Set(closing[i].map((t) => t.id))) }
  save(list)
  return { closed: where.flatMap((i) => closing[i].map((t) => ({ workspace: i + 1, ...t }))), workspaces: shown(self) }
})

const nameOf = (w: Item | null | undefined, n: number) => (w && typeof w.name === "string" ? w.name : `Workspace ${n}`)
const pinsOf = (w: Item | null | undefined) => (w && Array.isArray(w.pinned) ? w.pinned.filter((x): x is string => typeof x === "string") : null)

/** Workspace n's sidebars, for the core's panel ops (`vau panels`): its own setup (null: sidebars.json's) and how to save one. */
plugin.provide("sidebars:of", (n: number) => {
  const w = shown()[n - 1] ?? null
  return { label: `Workspace ${n}${w ? ` (${nameOf(w, n)})` : ""}`, setup: w ? readSidebars(w.sidebars) : null,
    save: (next: unknown) => putSlot(n - 1, { sidebars: next }) }
})

/** Workspace n's pinned pages, for Pinned's ops (`vau pin`): its own list (null: pages.json's) and one change to it. */
plugin.provide("pins:of", (n: number) => {
  const w = shown()[n - 1] ?? null
  return { label: `workspace ${n}${w ? ` (${nameOf(w, n)})` : ""}`, pinned: pinsOf(w),
    pin: (p: string, on: boolean, before?: string) => pinIn(n - 1, { path: p, pinned: on, ...(before ? { before } : {}) }) }
})

plugin.provide("context", ({ workspace: n }: { workspace: number | null }) => {
  if (!n) return null
  const label = nameOf(shown()[n - 1], n)
  return { data: { workspace: { n, label } }, text: `Workspace: ${n} (${label}), the one the user's window is on (vau workspace lists them)` }
})

type TabRow = { id: string; active?: boolean; pinned?: boolean; name?: string; group?: string; panes: { id: string; to: string; path?: string; behind?: string; focused?: boolean }[] }

function workspaceTabs(w: Item, n: number) {
  const l = layoutOf(w)
  const tabs: TabRow[] = (l?.tabs ?? []).map((t) => ({ id: t.id, ...(t.pinned ? { pinned: true } : {}), ...(t.name ? { name: t.name } : {}), ...(t.group ? { group: t.group } : {}),
    panes: panesOf(t).flatMap((x) => placesOf(x).map((p) => ({ id: p.id, to: p.to, ...(p.to.startsWith("file:") ? { path: p.to.slice(5) } : {}),
      ...(p.id !== x.id ? { behind: x.id } : {}), ...(p.id === t.focus && panesOf(t).length > 1 ? { focused: true } : {}) }))) }))
  return { workspace: n, name: nameOf(w, n), tabs, groups: l?.groups ?? [], windows: (l?.windows ?? []).length }
}
const allTabs = () => shown().flatMap((w, i) => (w ? [workspaceTabs(w, i + 1)] : []))
const allPanesIn = () => allTabs().flatMap((w) => w.tabs.flatMap((t) => t.panes.map((p) => ({ ...p, tab: t.id, alone: t.panes.length === 1, workspace: w.workspace }))))

async function windowOn(ctx: OpCtx): Promise<number | null> {
  try { const n = (await ctx.ui(null) as Item)?.workspace; return Number.isInteger(n) ? n as number : null } catch { return null }
}

const N = (description: string, required = true): Param => ({ type: "integer", minimum: 1, maximum: MAX, required, description })
const FROM: Param = { type: "integer", minimum: 1, maximum: MAX, description: "the workspace it's in, when it's open in several" }

const HELP = `The Workspaces plugin keeps up to five workspaces, numbered in the sidebar's header: each is a desk, what's
open (the tabs and splits, \`layout\`), what's within reach (the sidebars' panels, \`sidebars\`, shaped like
.vaultite/sidebars.json, none: that file's; its pinned pages, \`pinned\`, none: .vaultite/pages.json's, until its
first pin or unpin) and what the app keeps for it (\`state\`). Its name, icon, sidebars and pins are in
.vaultite/plugins/workspaces/<n>.json (a file each, none: unused; edit one to change them); its tabs and state are kept by
the server, not the vault (these ops read and change them). A workspace with no name or pinned pages of its own, the default
sidebars and only a blank tab counts as unused: it's listed as such and never kept. There always is a current one, each window's own (vau context says the user's). With a number, the window the
user was in last switches to it (the command workspace:<n>; an unused one shows sidebars.json's sidebars and a blank
tab, and is made once something changes there).

tabs: each workspace's tabs in order (or workspace <n>'s): each tab's id and its panes (a split tab has several), each
pane's id and what it shows (a file's path, or view:terminal/<id>, new for a blank pane), a tab group's tabs under it
(vau tabs group changes them); * marks a split tab's focused pane.

move: moves a tab, or a pane out of its split, to workspace <n> (POST /api/workspaces/move), like dragging it onto
that number in the sidebar's header: it leaves its workspace (a workspace's only tab leaves a blank one) and goes at
the end of <n>'s tabs as a tab (its panes with it). Name it by a tab's or pane's id (from vau workspace tabs) or by the
file a pane shows (a path or a name, like vau open: that pane, alone if it's in a split; --whole: its whole tab); if
it's open in several workspaces, say which with --from <m>. Every open window on either workspace follows at once;
nobody is switched, and nothing is closed (a terminal's shell keeps running).

open: opens a file in workspace <n> (a new tab at the end of its tabs, not shown there; nothing if it's already open
there), like dragging it from the file tree onto the number. Nobody is switched.

close: closes a tab or pane by its id, or every pane showing a file or a view (view:terminal/<id>), in every workspace
or in --from <m>'s (POST /api/workspaces/close); a tab goes with its last pane. Every open window follows at once.
Closing a terminal's pane doesn't end its session (vau terminal end does both).

  vau workspace
  vau workspace 2
  vau workspace tabs
  vau workspace tabs 1 --json
  vau workspace move "Notes/Idea.md" 2
  vau workspace move Idea 3 --from 1
  vau workspace move t1k2x9a0 2
  vau workspace move Idea 2 --whole
  vau workspace open "Notes/Idea.md" 3
  vau workspace close t1k2x9a0
  vau workspace close view:terminal/claude-k3j2h1g0
  vau workspace close "Notes/Idea.md" --from 2`

async function tabNamed(ctx: OpCtx, what: string, ids: Set<string>) {
  if (ids.has(what)) return { id: what, target: null }
  const target = what.startsWith("view:") || what === "new" ? what : pathAsSaid(await fileTree(ctx), what)
  return { id: null, target }
}

plugin.op({
  id: "workspace.list",
  cli: "workspace list",
  summary: "The workspaces (1 to 5): each one's panels, pinned pages and how many tabs; unused ones say so.",
  help: HELP,
  kind: "read",
  run: (_p, ctx) => listed(ctx),
  text: (r) => listText(r),
})

const listed = async (ctx: OpCtx) => ({ workspaces: shown(), window: await windowOn(ctx) })
const TabRef = z.looseObject({ id: z.string() })
const Moved = z.looseObject({ from: z.number().optional(), to: z.number(), tabs: z.array(TabRef), tab: TabRef.optional() })
const Closed = z.looseObject({ closed: z.array(z.looseObject({ workspace: z.number(), id: z.string(), to: z.string() })) })

function listText(r: { workspaces: (Item | null)[]; window: number | null }) {
  const rows = r.workspaces.map((w, i) => {
    const here = i + 1 === r.window ? " (the user's window)" : ""
    if (!w) return `${i + 1}. (unused)${here}`
    const sb: { left?: unknown; right?: unknown } | undefined = w.sidebars
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : [])
    const panels = sb ? `left ${strs(sb.left).join(", ") || "(none)"}; right ${strs(sb.right).join(", ") || "(none)"}` : "sidebars.json's sidebars"
    const count = workspaceTabs(w, i + 1).tabs.length
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
    if (!n) return await listed(ctx)
    try {
      return { switched: n, window: await ctx.ui({ action: "command", id: `workspace:${n}` }) }
    } catch (e) {
      if (e instanceof OpError && e.status === 409) throw new OpError("no app window is open on this server: open the app (browser or desktop) first", 409)
      throw e
    }
  },
  text: (r) => ("switched" in r ? `Sent workspace:${r.switched}.` : listText(r)),
})

plugin.op({
  id: "workspace.tabs",
  cli: "workspace tabs",
  summary: "Each workspace's tabs (or one's), each with its panes: their ids and what each pane shows.",
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
      `${w.workspace}. ${w.name}${w.windows ? ` (and ${w.windows} pop-out window${w.windows === 1 ? "" : "s"})` : ""}`,
      ...(w.tabs.length ? w.tabs.flatMap((t, i) => {
        const g = t.group && t.group !== w.tabs[i - 1]?.group ? w.groups.find((x) => x.id === t.group) : null
        const head = g ? [`  group ${g.name ? `"${g.name}"` : "(no name)"} ${g.color}${g.collapsed ? ", collapsed" : ""} (${g.id})`] : []
        const pad = t.group ? "    " : "  ", what = (p: TabRow["panes"][number]) => p.path ?? p.to
        if (t.panes.length === 1) return [...head, `${pad}${t.id}  pane ${t.panes[0].id}  ${what(t.panes[0])}${t.pinned ? " (pinned)" : ""}`]
        return [...head, `${pad}${t.id}  split${t.name ? ` "${t.name}"` : ""}${t.pinned ? " (pinned)" : ""}`, ...t.panes.map((p) => `${pad}  ${p.focused ? "*" : " "} pane ${p.id}  ${what(p)}`)]
      }) : ["  (one blank tab)"]),
    ])
    return rows.length ? rows.join("\n") : "(no workspaces yet: the sidebar uses .vaultite/plugins.json)"
  },
})

plugin.op({
  id: "workspace.move",
  cli: "workspace move",
  summary: "Move a tab (all its panes), or a pane out of its split, to another workspace, like dragging it onto its number.",
  help: HELP,
  kind: "write",
  params: {
    tab: { type: "string", required: true, description: "the tab or pane: its id (vau workspace tabs), or the file or view a pane shows (a path or a name)" },
    to: N("the workspace to move it to"),
    from: FROM,
    whole: { type: "boolean", description: "named by a pane in a split: move its whole tab" },
  },
  args: ["tab", "to"],
  run: async ({ tab: what, to, from, whole }, ctx) => {
    const panes = allPanesIn()
    const ids = new Set([...panes.map((p) => p.id), ...panes.map((p) => p.tab)])
    const { id, target } = await tabNamed(ctx, what, ids)
    const shows = target && (target.startsWith("view:") || target === "new" ? target : `file:${target}`)
    const found = panes.filter((p) => (id ? p.id === id || p.tab === id : p.to === shows) && (!from || p.workspace === from))
    if (!found.length) throw new OpError(`${id ? id : target} isn't open${from ? ` in workspace ${from}` : " in any workspace"} (vau workspace tabs lists them)`, 404)
    const where = [...new Set(found.map((p) => p.workspace))]
    if (where.length > 1 && !from) throw new OpError(`${id ?? target} is open in workspaces ${where.join(" and ")}: say which with \`from\``, 409)
    const p = found[0], at = from ?? p.workspace
    const byTab = id === p.tab || whole || p.alone
    const r = Moved.parse(await ctx.api("POST", "workspaces/move", { from: at, to, ...(byTab ? { tab: p.tab } : { pane: p.id }) }))
    return { ...r, moved: byTab ? `tab ${p.tab}` : `pane ${p.id}`, ...(r.tab?.id && r.tab.id !== p.tab ? { as: r.tab.id } : {}) }
  },
  text: (r) => `Moved ${r.moved} from workspace ${r.from} to workspace ${r.to}${r.as ? ` (tab ${r.as} there)` : ""}.`,
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
  run: async ({ path: file, to }, ctx) => ({ ...Moved.parse(await ctx.api("POST", "workspaces/move", { to, open: [file] })), path: file }),
  text: (r) => (r.tabs.length ? `Opened ${r.path} in workspace ${r.to}.` : `${r.path} is already open in workspace ${r.to}.`),
})

plugin.op({
  id: "workspace.close",
  cli: "workspace close",
  summary: "Close a tab or pane by its id, or every pane showing a file or a view, in every workspace or one (nothing is ended).",
  help: HELP,
  kind: "write",
  params: {
    tab: { type: "string", required: true, description: "a tab's or pane's id, or the file or view (view:terminal/<id>) its panes show" },
    from: { ...FROM, description: "only in this workspace" },
  },
  args: ["tab"],
  run: async ({ tab: what, from }, ctx) => {
    const ids = new Set(allPanesIn().flatMap((p) => [p.id, p.tab]))
    const { id, target } = await tabNamed(ctx, what, ids)
    return { ...Closed.parse(await ctx.api("POST", "workspaces/close", { ...(from ? { from } : {}), ...(id ? { tab: id } : { path: target }) })), what }
  },
  text: (r) => {
    const closed = r.closed
    const at = [...new Set(closed.map((t) => t.workspace))].join(", ")
    return `Closed ${closed.length === 1 ? closed[0].to.replace(/^file:/, "") : `${closed.length} panes of ${r.what}`} in workspace ${at}.`
  },
})
