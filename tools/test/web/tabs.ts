import path from "node:path"
import { pathToFileURL } from "node:url"
import { check } from "../lib.ts"
import { type Any, type Props, same, WEB, web } from "./lib.ts"
import { messageOf } from "../../../core/values.ts"

// ---------- tabs: tabs hold panes (core/layout.ts; web/src/core/workspace.ts, splits.ts, tabgroups.ts, drop.ts) ----------

// Just enough of a browser for the tabs: the address, its history, a phone's or a computer's width, what's saved.
let desktop = true
const g = globalThis as Any
const mem = new Map<string, string>()
g.location = { hash: "", search: "", pathname: "/" }
g.history = { state: null, pushState(st: unknown, _: string, h: string) { this.state = st; g.location.hash = h }, replaceState(st: unknown, _: string, h?: string) { this.state = st; if (h) g.location.hash = h } }
g.matchMedia = () => ({ matches: desktop })
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem() {} }
g.addEventListener = () => {}
g.requestAnimationFrame = () => 0
g.document = { addEventListener() {}, activeElement: null, querySelector: () => null, documentElement: { dataset: {} } }
g.CSS = { escape: (s: string) => s, supports: () => false }
g.dispatchEvent = () => true
g.HashChangeEvent = class { type: string; constructor(type: string) { this.type = type } }
const ws: Any = await web("core/workspace.ts")
const sp: Any = await web("core/splits.ts")
const gr: Any = await web("core/tabgroups.ts")
const dr: Any = await web("core/drop.ts")
const tev: Any = await web("core/tabevents.ts")
const lay: Any = await web("../../core/layout.ts")
const tid = await import("../../../core/terminalids.ts")
check("terminal ids: an agent, its account, a resumed session and a machine read back; a shell is none",
  JSON.stringify(tid.parseTerminal("claude_personal-k3j2h1g0@studio")) === JSON.stringify({ agent: "claude", profile: "personal", resume: null, machine: "studio" })
  && tid.parseTerminal(tid.resumeTerminalId("codex", "0199-abc"))?.resume === "0199-abc" && tid.parseTerminal("k3j2h1g0") === null
  && /^claude_work-[a-z0-9]{8}$/.test(tid.newTerminalId(tid.agentIn("claude", "work"))) && tid.agentIn("claude", "No way") === "claude")
check("tabs: a target's file, and only a vault one's vault path", lay.tabPath("file:a.md") === "a.md" && lay.tabPath("file:/x/b.pdf") === "/x/b.pdf"
  && lay.tabPath("view:terminal/1") === null && lay.vaultPath("file:a.md") === "a.md" && lay.vaultPath("file:/x/b.pdf") === null && lay.vaultPath("new") === null)

// A pane showing its file (or `to`); a tab of one pane (its id "t" and the pane's); a split tab; splits.
type Tb = { id: string; root: Any; focus: string; [k: string]: unknown }
const pane = (id: string, to = `file:${id}.md`): Any => ({ id, to })
const TP = (p: Any, extra: Props = {}): Tb => ({ id: `t${p.id}`, root: p, focus: p.id, ...extra })
const T = (id: string, to?: string, extra: Props = {}) => TP(pane(id, to), extra)
const S = (id: string, root: Any, focus: string, extra: Props = {}): Tb => ({ id, root, focus, ...extra })
const row = (id: string, kids: Any[], sizes?: number[]) => ({ id, dir: "row", kids, sizes: sizes ?? kids.map(() => 1 / kids.length) })
const col = (id: string, kids: Any[], sizes?: number[]) => ({ id, dir: "col", kids, sizes: sizes ?? kids.map(() => 1 / kids.length) })
// (the tabs it takes away are kept elsewhere: not remembered as closed)
const put = (tabs: Tb[], active: string, extra: Props = {}) => ws.replaceWorkspace({ tabs, active, ...extra }, { kept: true })
// The list as "a,[b|c]*,d": each tab's panes (files without ".md"), splits in brackets, the tab on screen starred.
const short = (to: string) => (to.startsWith("file:") ? to.slice(5).replace(/\.md$/, "") : to)
const desc = (n: Any): string => (n.kids ? `[${n.kids.map(desc).join(n.dir === "row" ? "|" : "/")}]` : short(n.to))
const tabs = () => ws.here().tabs.map((t: Tb) => desc(t.root) + (t.id === ws.here().active ? "*" : "")).join(",")
const focus = () => ws.activePane().id
const shares = (t: Tb = ws.activeTab()) => t.root.sizes?.map((x: number) => x.toFixed(2)).join(",")
const tree = (n: Any = ws.activeTab().root): string => (n.kids ? `${n.dir}(${n.kids.map((k: Any, i: number) => `${tree(k)}:${n.sizes[i].toFixed(2)}`).join(" ")})` : n.id)
const a = pane("a"), b = pane("b"), c = pane("c"), d = pane("d")

// ---- the model: what's saved read back, and from before tabs held panes ----
const oldLayout = { root: { id: "s0", dir: "row", sizes: [0.6, 0.4], kids: [
  { id: "gL", active: "a", sets: [{ id: "S", name: "Work", color: "blue" }], tabs: [{ id: "a", to: "file:a.md" }, { id: "b", to: "file:b.md", set: "S", pinned: true, name: "Reading" }] },
  { id: "gR", active: "d", tabs: [{ id: "c", to: "file:c.md" }, { id: "d", to: "file:d.md", back: ["file:x.md"], name: "Desk" }] }] }, focus: "gR", zoom: "gR" }
const mig = lay.clean(oldLayout), split = mig?.tabs.find((t: Tb) => t.id === "ta")
check("migration: old tab ids are pane ids, each tab's id \"t\" and its first pane's, the split tab where the focused group's shown tab was",
  mig?.tabs.map((t: Tb) => `${t.id}:${desc(t.root)}`).join() === "tb:b,tc:c,ta:[a|d]" && mig.active === "ta", mig)
check("migration: the split keeps its sizes, the focus and zoom on the focused group's shown tab, history kept",
  split?.root.id === "s0" && split.root.sizes.join() === "0.6,0.4" && split.focus === "d" && split.zoom === "d" && split.root.kids[1].back?.join() === "file:x.md", split)
const tb = mig?.tabs[0]
check("migration: pinned, name and tab group (set) carried; the old groups' sets are the list's groups",
  tb?.pinned === true && tb.name === "Reading" && tb.group === "S" && split?.name === "Desk" && same(mig.groups, [{ id: "S", name: "Work", color: "blue" }]), [tb, mig?.groups])
check("migration: the same on every device, and read again unchanged", same(lay.clean(oldLayout), mig) && same(lay.clean(JSON.parse(JSON.stringify(mig))), mig))
const oldFloat = lay.clean({ root: { id: "s1", dir: "row", sizes: [0.5, 0.25, 0.25], kids: [{ id: "gA", tabs: [{ id: "a", to: "file:a.md" }], active: "a" },
  { id: "gM", tabs: [{ id: "m", to: "view:terminal/q" }], active: "m", float: { x: 0.5, y: 0.1, w: 0.4, h: 0.5 } }, { id: "gC", tabs: [{ id: "c", to: "file:c.md" }], active: "c" }] }, focus: "gA", zoom: "gM" })
check("migration: a floating group's shown tab floats in the split tab; a zoom of a group not focused is dropped",
  oldFloat?.tabs.length === 1 && oldFloat.tabs[0].id === "ta" && same(oldFloat.tabs[0].root.kids[1].float, { x: 0.5, y: 0.1, w: 0.4, h: 0.5 }) && oldFloat.tabs[0].focus === "a"
  && !("zoom" in oldFloat.tabs[0]), oldFloat)
check("migration: an old layout with no tab is none; with an unknown focus, the first group's", lay.clean({ root: { id: "g0", tabs: [], active: "" } }) === null
  && lay.clean({ root: { id: "s0", dir: "row", kids: [{ id: "g1", tabs: [{ id: "a", to: "file:a.md" }], active: "a" }, { id: "g2", tabs: [{ id: "b", to: "file:b.md" }], active: "b" }] }, focus: "gone" })?.tabs[0].focus === "a")
const dup = lay.clean({ tabs: [T("a"), { ...T("a"), id: "tz" }, { id: "te", root: { kids: [] }, focus: "" }], active: "tz" })
check("reading: a pane in two tabs stays in the first, a tab with no pane goes, the active one falls back to the first",
  dup?.tabs.map((t: Tb) => t.id).join() === "ta" && dup.active === "ta", dup)

// What older versions kept on this device (workspace.ts' older()), and its closed tabs, read by a fresh copy of the module.
let freshN = 0
const fresh = async (saved: unknown, closed?: unknown, popout = "") => {
  mem.clear(); mem.set("vaultite.tabs", JSON.stringify(saved))
  if (closed) mem.set(`vaultite.tabs.closed${popout ? `.${popout}` : ""}`, JSON.stringify(closed))
  g.location.search = popout ? `?popout=${popout}` : ""
  const m: Any = await import(`${pathToFileURL(path.join(WEB, "core", "workspace.ts")).href}?fresh=${++freshN}`)
  mem.clear(); g.location.search = ""
  return m
}
const listOf = (m: Any) => m.here().tabs.map((t: Tb) => desc(t.root) + (t.id === m.here().active ? "*" : "")).join(",")
const one = await fresh({ tabs: [{ id: "a", to: "file:a.md" }, { id: "b", to: "file:b.md" }], active: "b" })
check("older saves: one pane's tabs ({tabs, active}) are tabs of one pane each", listOf(one) === "a,b*" && one.here().tabs.map((t: Tb) => t.id).join() === "ta,tb", listOf(one))
const twoSaved = await fresh({ groups: [{ id: "gL", tabs: [{ id: "a", to: "file:a.md" }], active: "a" }, { id: "gR", tabs: [{ id: "b", to: "file:b.md" }, { id: "c", to: "file:c.md" }], active: "c" }], split: 0.3 })
check("older saves: a main pane and a right split ({groups, split}) are one split tab at those sizes, the rest tabs of their own",
  listOf(twoSaved) === "[a|c]*,b" && shares(twoSaved.activeTab()) === "0.70,0.30", [listOf(twoSaved), shares(twoSaved.activeTab())])
const grouped = { tabs: [T("a", undefined, { group: "g" }), T("b", undefined, { group: "g" }), S("tx", row("s0", [c, d]), "d"), T("e")],
  groups: [{ id: "g", name: "Work", color: "blue", collapsed: true }], active: "te" }
const groupedSaved = await fresh(grouped)
check("saves: a list with tab groups (its `groups`, not the old {groups, split}) loads back as itself", same(groupedSaved.here(), grouped), groupedSaved.here())
const rooted = await fresh(oldLayout, [{ tab: { id: "x", to: "file:x.md" }, at: 1, closed: 5 }, { pane: { tabs: [{ id: "y", to: "file:y.md" }, { id: "z", to: "file:z.md" }] }, closed: 6 }])
check("older saves: a layout of groups in splits migrates; closed tabs and panes of tabs saved then reopen as tabs",
  listOf(rooted) === "b,c,[a|d]*" && rooted.closedTabs().map((r: Any) => `${r.id}:${r.closed}`).join() === "tz:6,ty:6,tx:5", [listOf(rooted), rooted.closedTabs()])
// A pop-out keeps its own list in the workspace; the main window keeps its own and which pop-outs there are.
const pop = await fresh({ tabs: [T("a")], active: "ta", windows: [{ id: "w1", tabs: [T("p")], active: "tp" }] }, undefined, "w1")
const theirs = { tabs: [T("a"), T("b")], active: "tb", windows: [{ id: "w1", tabs: [T("q")], active: "tq" }, { id: "w2", tabs: [T("r")], active: "tr" }] }
const popMine = pop.mineInto(theirs)
check("pop-out: its own list is what it shows; saved, it puts that into the workspace, the other windows' as they are",
  listOf(pop) === "p*" && popMine.tabs.map((t: Tb) => t.id).join() === "ta,tb" && popMine.windows.map((w: Any) => `${w.id}:${w.tabs.map((t: Tb) => t.id).join()}`).join() === "w1:tp,w2:tr", popMine)
put([T("a"), T("c")], "ta", { windows: [{ id: "w1", tabs: [T("p")], active: "tp" }] })
const mainMine = ws.mineInto(theirs)
check("pop-out: the main window saving puts its own tabs in, the pop-outs it has with their own lists",
  mainMine.tabs.map((t: Tb) => t.id).join() === "ta,tc" && mainMine.windows.map((w: Any) => `${w.id}:${w.tabs.map((t: Tb) => t.id).join()}`).join() === "w1:tq", mainMine)

// ---- tabs and panes leaving: what shows next ----
const L = (ids: string[], active: string, extra: Props = {}) => ({ tabs: ids.map((x) => T(x)), active: `t${active}`, ...extra })
check("closing: the tab shown, gone, hands over to the nearest after it, else before it; others going leave it shown",
  lay.withoutTabs(L(["a", "b", "c"], "b"), new Set(["tb"])).active === "tc" && lay.withoutTabs(L(["a", "b", "c"], "c"), new Set(["tc"])).active === "tb"
  && lay.withoutTabs(L(["a", "b", "c", "d"], "b"), new Set(["tb", "tc"])).active === "td" && lay.withoutTabs(L(["a", "b", "c"], "a"), new Set(["tc"])).active === "ta"
  && lay.withoutTabs(L(["a"], "a"), new Set(["ta"])) === null)
// [x] (A: a1 a2) (B folded: b1 b2) c, as Chrome's tab strip picks the next.
const G = (active: string) => ({ active: `t${active}`, groups: [{ id: "A", name: "", color: "blue" }, { id: "B", name: "", color: "red", collapsed: true }],
  tabs: [T("x", "new"), T("a1", undefined, { group: "A" }), T("a2", undefined, { group: "A" }), T("b1", undefined, { group: "B" }), T("b2", undefined, { group: "B" }), T("c")] })
const after = (active: string, ...ids: string[]) => lay.withoutTabs(G(active), new Set(ids.map((x) => `t${x}`))).active.slice(1)
check("closing in a tab group: another of its tabs (after, else before); its last, the nearest outside it, never into a folded group",
  after("a1", "a1") === "a2" && after("a2", "a2") === "a1" && after("a2", "a1", "a2") === "c" && after("c", "c") === "a2", [after("a1", "a1"), after("a2", "a2"), after("a2", "a1", "a2"), after("c", "c")])
const lastGroup = lay.withoutTabs(G("c"), new Set(["tx", "ta1", "ta2", "tc"]))
check("closing: with only folded groups left, the nearest, whose group opens", lastGroup.active === "tb2" && !lastGroup.groups[0].collapsed, lastGroup)
const three = S("tx", row("s", [a, b, c], [0.25, 0.5, 0.25]), "b")
const left = lay.tabWithout(three, new Set(["b"]))
check("closing: a pane closed in a split, the focus goes to the pane after it, else before it; the last one gone, the tab is none",
  left?.focus === "c" && desc(left.root) === "[a|c]" && lay.tabWithout({ ...three, focus: "c" }, new Set(["c"]))?.focus === "b"
  && lay.tabWithout(three, new Set(["a", "b", "c"])) === null, left)
const sub = lay.withoutPanesIn(row("s", [a, col("c2", [b, c]), d], [0.25, 0.5, 0.25]), new Set(["b", "c"]))
const flGone = lay.withoutPanesIn(row("s", [a, { ...b, float: { x: 0, y: 0, w: 0.5, h: 0.5 } }, c], [0.25, 0.5, 0.25]), new Set(["b"]))
check("closing: a whole split's panes at once, its room goes to the part before it; a floating one's, nowhere (the tiled ones keep theirs)",
  desc(sub) === "[a|d]" && sub.sizes.join() === "0.75,0.25" && desc(flGone) === "[a|c]" && flGone.sizes.join() === "0.5,0.5", [sub, flGone])
const lp = lay.withoutPanes({ tabs: [three, T("d")], active: "tx" }, new Set(["a", "b", "c"]))
check("closing: a tab left with no panes goes, the next shown", lp?.tabs.map((t: Tb) => t.id).join() === "td" && lp.active === "td", lp)

// ---- a tab's splits, pure (layout.ts) ----
// [a | [b / c]] with a a quarter wide.
const grid: Any = row("s", [a, col("c2", [b, c])], [0.25, 0.75])
const sw = lay.swapped(grid, "a", "c")
check("panes: swapping two puts each in the other's place, the same objects, the sizes staying with the places",
  desc(sw) === "[c|[b/a]]" && sw.kids[0] === c && sw.sizes.join() === "0.25,0.75" && lay.swapped(grid, "a", "x") === grid, desc(sw))
const near = (x: number, y: number) => Math.abs(x - y) < 1e-9
const r1 = lay.nudged(grid, "a", "right", 0.05, 0.1), r2 = lay.nudged(grid, "a", "left", 0.05, 0.1)
check("panes: resizing moves the divider on that side that way (by a share of the whole), else the one on the other side",
  near(r1.sizes[0], 0.3) && near(r2.sizes[0], 0.2) && near(lay.nudged(grid, "b", "left", 0.05, 0.1).sizes[0], 0.2), [r1.sizes, r2.sizes])
const r3 = lay.nudged(grid, "b", "bottom", 0.075, 0.1), r4 = lay.nudged(grid, "c", "bottom", 0.075, 0.1)
check("panes: … in the split it's in, the step a share of the whole (its split is the whole height here); its neighbour's edge too",
  near(r3.kids[1].sizes[0], 0.575) && near(r4.kids[1].sizes[0], 0.575) && near(lay.nudged(grid, "b", "top", 0.075, 0.1).kids[1].sizes[0], 0.425), [r3.kids[1].sizes, r4.kids[1].sizes])
check("panes: … never past a part's least size, and nothing without a divider that way",
  near(lay.nudged(grid, "a", "left", 0.5, 0.1).sizes[0], 0.1) && lay.nudged(a, "a", "left", 0.05, 0.1) === a && lay.nudged(grid, "a", "top", 0.05, 0.1) === grid)
const evAll = lay.evenedAll({ ...grid, kids: [grid.kids[0], { ...grid.kids[1], sizes: [0.8, 0.2] }] })
check("panes: evening them out makes every split's parts equal", evAll.sizes.join() === "0.5,0.5" && evAll.kids[1].sizes.join() === "0.5,0.5", evAll)
// Zoom (Tab.zoom) and floating panes (Pane.float): out of the tiling, their spot kept for docking back.
const fl = { x: 0.05, y: 0.1, w: 0.3, h: 0.5 }
const row3 = (fB?: Any) => row("s0", [pane("a"), { ...pane("b"), ...(fB ? { float: fB } : {}) }, pane("c")], [0.25, 0.5, 0.25])
const lo = lay.layout(row3(fl)), w2 = (r: Any) => r.w.toFixed(2)
check("float: out of the tiling, the tiled ones share its room as they shared theirs; one divider between them",
  lo.panes.map((p: Any) => `${p.pane.id}:${w2(p.rect)}`).join() === "a:0.50,c:0.50" && lo.floats[0]?.pane.id === "b" && same(lo.floats[0].rect, fl)
  && lo.dividers.length === 1 && lo.dividers[0].i === 0 && lo.dividers[0].at.toFixed(2) === "0.50", lo)
const rs = lay.resized(row3(fl), "s0", 0, 0.3, 0.05), ev = lay.evened(rs, "s0")
check("float: a divider dragged or evened out moves the tiled ones only; it keeps its share for docking",
  lay.layout(rs).panes.map((p: Any) => w2(p.rect)).join() === "0.30,0.70" && rs.sizes[1] === 0.5 && lay.layout(ev).panes.map((p: Any) => w2(p.rect)).join() === "0.50,0.50" && ev.sizes[1] === 0.5,
  [rs.sizes, ev.sizes])
check("float: docked, back in its spot at its share", same(lay.floated(row3(fl), "b", null), row3()))
const savedFloat = (f: unknown) => lay.clean({ tabs: [S("tx", row("s0", [pane("a"), { ...pane("b"), float: f }]), "a")], active: "tx" }).tabs[0].root.kids[1].float
check("float: a saved one is kept inside the workspace; one that isn't a place is dropped",
  same(savedFloat({ x: 0.9, y: -1, w: 0.5, h: 2 }), { x: 0.5, y: 0, w: 0.5, h: 1 }) && savedFloat({ x: "1" }) === undefined)
check("float: directional focus from it goes to the tiled pane past its edge", lay.neighbourOf(row3({ ...fl, x: 0.1 }), "b", "right")?.id === "c"
  && lay.neighbourOf(row3(fl), "b", "left") === null)
// A pane as the user names it (vau open --in): where it is in the tab.
const idsOf = (ps: Any[]) => ps.map((p: Any) => p.id).join()
const lr = row("s0", [col("s1", [pane("a"), pane("b")]), pane("c")]), row3x = row("s0", [pane("a"), pane("b"), pane("c")])
check("named: position words, filler and synonyms dropped; other words aren't a place",
  same(lay.spotWords("the left side panel"), ["left"]) && same(lay.spotWords("Top-right one"), ["top", "right"]) && same(lay.spotWords("lower half"), ["bottom"])
  && lay.spotWords("the one showing Squad") === null && lay.spotWords("the pane") === null)
check("named: a side is the panes touching that edge, two sides both; middle what touches neither edge of the axis",
  idsOf(lay.panesAt(lr, ["left"])) === "a,b" && idsOf(lay.panesAt(lr, ["top", "left"])) === "a" && idsOf(lay.panesAt(lr, ["right"])) === "c"
  && idsOf(lay.panesAt(lr, ["bottom", "right"])) === "c" && idsOf(lay.panesAt(row3x, ["middle"])) === "b" && idsOf(lay.panesAt(lr, ["middle"])) === ""
  && idsOf(lay.panesAt(col("s0", [pane("a"), pane("b"), pane("c")]), ["middle"])) === "b" && idsOf(lay.panesAt(row3x, ["top"])) === "a,b,c", [idsOf(lay.panesAt(lr, ["middle"]))])
const st = (root: Any, f: string, zoom?: string) => lay.settledTab({ id: "tx", root, focus: f, ...(zoom ? { zoom } : {}) })
check("settled: with every pane floating they dock; the focus on one of its panes; a zoom only on the focused pane, tiled, beside others",
  !lay.leaves(st({ ...pane("a"), float: fl }, "a").root).some((p: Any) => p.float) && st(row3(), "gone").focus === "a"
  && st(row3(), "a", "c").zoom === undefined && st(row3(), "a", "a").zoom === "a"
  && st(row3(fl), "b", "b").zoom === undefined && st(pane("a"), "a", "a").zoom === undefined)

// ---- blank tabs are never left behind ----
const N = T("n", "new")
put([T("a"), N], "tn"); ws.go("file:a.md")
check("tabs: opening what another tab has from a blank tab closes the blank one", tabs() === "a*", tabs())
put([T("a"), N], "tn"); ws.go("view:terminals", true)
check("tabs: asked for a new tab from a blank tab, it opens in the blank one", tabs() === "a,view:terminals*", tabs())
put([T("a"), N], "tn"); ws.go("file:a.md", true)
check("tabs: asked for a new tab of what another tab has, from a blank tab: that tab, no copy", tabs() === "a*", tabs())
put([T("a"), T("b")], "tb"); ws.go("file:a.md", true)
check("tabs: asked for a new tab from a tab with something, it still gets one", tabs() === "a,b,a*", tabs())
put([T("a"), N], "tn"); g.location.hash = "#file/a.md"; ws.followHash("file/a.md")
check("tabs: a link from a blank tab to what another tab has closes the blank one", tabs() === "a*", tabs())
put([T("a"), N], "tn"); ws.selectTab("ta")
check("tabs: switching away from a blank tab by hand keeps it", tabs() === "a*,new", tabs())
put([T("a")], "ta"); ws.newTab(); ws.selectTab("ta"); ws.newTab(); ws.newTab()
check("tabs: New tab never makes a second blank tab", tabs() === "a,new*", tabs())
put([S("tx", row("s0", [a, pane("n", "new")]), "n")], "tx"); ws.go("file:a.md")
check("tabs: a split's blank pane stays when what's opened is in the split (the split is the user's)", tabs() === "[a|new]*" && focus() === "a", tabs())
put([S("tx", row("s0", [a, pane("n", "new")]), "n")], "tx"); ws.go("file:z.md")
check("tabs: … and takes what's opened from it", tabs() === "[a|z]*" && focus() === "n", tabs())
put([S("tx", row("s0", [a, pane("n", "new")]), "n")], "tx"); sp.openAt("file:b.md", "n", "center")
check("tabs: a file dropped into a blank pane's middle takes its place, the blank one not in its history", tabs() === "[a|b]*" && !ws.paneById("n").back?.length, tabs())
put([S("tx", row("s0", [a, pane("n", "new")]), "n"), T("b")], "tx"); sp.tabIntoPane("tb", "n", "center")
check("tabs: a tab dropped into a blank pane's middle takes its place, no blank tab back in the list", tabs() === "[a|b]*", tabs())
put([S("tx", row("s0", [a, pane("n", "new")]), "n"), T("b")], "tx"); sp.paneIntoPane("b", "n", "center")
check("tabs: a pane dropped into a blank pane's middle takes its place, no blank tab left where it was", tabs() === "[a|b]*", tabs())
put([T("a"), N], "tn"); ws.openTab("view:web/")
check("new web page: from a blank tab, in it", tabs() === "a,view:web/*", tabs())
put([S("tx", row("s0", [a, pane("w", "view:web/")]), "a")], "tx"); ws.openTab("view:web/")
check("new web page: in a split, one of the focused pane's own tabs, though the split has a blank page", tabs() === "[view:web/|view:web/]*", tabs())

// ---- what's opened goes to the focused pane; a split stays, and switches away whole ----
put([S("tx", row("s0", [a, b]), "b"), T("c")], "tx"); ws.go("file:d.md")
check("split: what's opened goes in the focused pane, the split staying", tabs() === "[a|d]*,c" && focus() === "b" && ws.paneById("b").back?.join() === "file:b.md", tabs())
ws.setTabKeeper((to: string) => to.startsWith("view:terminal/"))
put([S("tx", row("s0", [a, pane("q", "view:terminal/q")]), "q"), T("c")], "tx"); ws.go("file:d.md")
check("split: from a pane that keeps its view (a terminal), in another pane of the split that fits, focused", tabs() === "[d|view:terminal/q]*,c" && focus() === "a", tabs())
put([S("tx", row("s0", [pane("q", "view:terminal/q"), pane("r", "view:terminal/r")]), "q")], "tx"); ws.go("file:d.md")
check("split: … none fits, a new tab", tabs() === "[view:terminal/q|view:terminal/r],d*", tabs())
ws.setTabKeeper(() => false)
put([S("tx", row("s0", [a, b]), "b"), T("c")], "tx"); ws.selectTab("tc")
check("split: another tab selected, the split switches away whole, as it was", tabs() === "[a|b],c*" && ws.tabById("tx").focus === "b", tabs())
ws.go("file:a.md")
check("split: … opening what one of its panes shows comes back to it, that pane focused", tabs() === "[a|b]*,c" && focus() === "a", tabs())
put([T("a", undefined, { pinned: true }), T("b")], "ta"); ws.go("file:z.md")
check("pinned: what's opened from a pinned tab opens in a tab beside it", tabs() === "a,z*,b", tabs())
put([S("tx", row("s0", [a, b]), "b"), T("c")], "tx"); ws.replaceWorkspace({ tabs: [S("tx", row("s0", [a, b]), "a"), T("c"), T("d")], active: "tc" }, { merge: true })
check("tabs: the same workspace changed on another device keeps the tab this one shows and its focus", tabs() === "[a|b]*,c,d" && focus() === "b", tabs())

// ---- Chrome's openers: where a tab opens, and what closing it shows ----
const tabOfPane = (id: string) => ws.paneTab(id).id
put([T("a"), T("b")], "ta"); ws.openTab("view:terminal/x", { background: true })
check("tabs: a tab opened behind goes beside the active one, which stays shown", tabs() === "a*,view:terminal/x,b", tabs())
// Links opened from a page: behind it in click order after its earlier ones, as Chrome does, till the user moves on.
put([T("a"), T("b")], "ta"); ws.openTab("file:1.md", { background: true, from: "a" }); ws.openTab("file:2.md", { background: true, from: "a" }); ws.openTab("file:a.md", { background: true, from: "a" })
check("tabs: links opened behind one tab go after it in the order they were opened, a copy of an open one too", tabs() === "a*,1,2,a,b", tabs())
ws.selectTab("tb"); ws.selectTab("ta"); ws.openTab("file:3.md", { background: true, from: "a" })
check("tabs: … once the user showed another tab, the next goes right after it again", tabs() === "a*,3,1,2,a,b", tabs())
put([T("a"), T("b")], "ta"); const kid = tabOfPane(ws.openTab("file:k.md", { from: "a" }))
check("tabs: one opened in front from a tab is shown, after it", tabs() === "a,k*,b" && ws.here().active === kid, tabs())
ws.closeTab(kid)
check("tabs: … closing it straight away goes back to the tab it came from", ws.here().active === "ta", ws.here().active)
const kid2 = tabOfPane(ws.openTab("file:k.md", { from: "a" })); ws.selectTab("tb"); ws.selectTab(kid2); ws.closeTab(kid2)
check("tabs: … but not once another was shown in between: its neighbour, as ever", ws.here().active === "tb", ws.here().active)
// Chrome's order after closing one of several opened from a tab: the next of them, to the right then the left, then the tab.
put([T("a"), T("b")], "ta"); const k1 = tabOfPane(ws.openTab("file:1.md", { background: true, from: "a" })), k2 = tabOfPane(ws.openTab("file:2.md", { background: true, from: "a" }))
const k3 = tabOfPane(ws.openTab("file:3.md", { background: true, from: "a" })); ws.selectTab(k2); ws.closeTab(k2)
check("tabs: closing one of the tabs a tab opened, come to from it: the next it opened", ws.here().active === k3, ws.here().active)
ws.closeTab(k3)
check("tabs: … with none after it, the one before it", ws.here().active === k1, ws.here().active)
ws.closeTab(k1)
check("tabs: … and with none left, the tab that opened them", ws.here().active === "ta", ws.here().active)
put([T("a"), T("b")], "ta"); const k4 = tabOfPane(ws.openTab("file:4.md", { background: true, from: "a" })); ws.openTab("file:5.md", { background: true, from: "a" })
ws.selectTab("tb"); ws.selectTab(k4); ws.closeTab(k4)
check("tabs: … come to from another tab, its neighbour to the right, as ever", ws.activePane().to === "file:5.md", ws.activePane())
ws.selectTab("tb"); ws.closeTab(ws.findOpen("file:5.md").t.id)
check("tabs: closing one not shown leaves the shown one be", ws.here().active === "tb", ws.here().active)
put([T("a"), T("b")], "ta"); ws.openTab("file:6.md", { background: true, from: "a" }); const front = tabOfPane(ws.openTab("file:7.md", { from: "a" }))
check("tabs: one opened in front goes right after its tab, before those opened behind", tabs() === "a,7*,6,b", tabs())
ws.closeTab(front)
check("tabs: … and closing it goes back to its tab, not one opened behind (Chrome forgets those)", ws.here().active === "ta", ws.here().active)
put([T("a"), T("b")], "ta"); const midP = ws.openTab("file:8.md", { from: "a" }), mid = tabOfPane(midP); const leaf = tabOfPane(ws.openTab("file:9.md", { background: true, from: midP })); ws.closeTab(mid)
check("tabs: closing a tab goes first to the one it opened", ws.here().active === leaf, ws.here().active)
ws.closeTab(leaf)
check("tabs: … which is then its opener's: closing it goes back there", ws.here().active === "ta", ws.here().active)

// ---- a tab dropped on a pane, a pane on a pane, a pane out to a tab of its own ----
put([T("a"), T("b"), T("c"), T("d")], "ta"); sp.tabIntoPane("tc", "a", "center")
check("tab into pane: in its middle it takes the pane's place; what was there goes back to the list where the dropped tab was",
  tabs() === "c*,b,a,d" && focus() === "c" && ws.here().tabs[0].id === "ta", tabs())
put([T("a"), T("b"), T("c")], "ta"); sp.tabIntoPane("tc", "a", "right")
check("tab into pane: on an edge, a split beside it, the dropped tab's pane focused", tabs() === "[a|c]*,b" && focus() === "c" && shares() === "0.50,0.50", tabs())
put([S("tx", row("s0", [a, b]), "b"), T("c")], "tc"); sp.tabIntoPane("tx", "c", "bottom")
check("tab into pane: a split tab dropped brings all its panes, its focus kept", tabs() === "[c/[a|b]]*" && focus() === "b", tabs())
put([S("tx", row("s0", [a, b]), "b"), T("c", undefined, { group: "G" }), T("d")], "tx", { groups: [{ id: "G", name: "G", color: "blue" }] }); sp.replaceWithTab("tc")
check("replace with tab (⌥-click): in a split, the tab is one of the focused pane's own, shown, what it showed behind it",
  tabs() === "[a|c]*,d" && focus() === "c" && lay.placesOf(ws.activeTab().root.kids[1]).map((p: Any) => p.id).join() === "b,c" && shares() === "0.50,0.50", tabs())
put([S("tx", row("s0", [a, b]), "b"), T("n", "new")], "tx")
check("tab into pane: not onto its own panes, nor a blank tab", !sp.canTabIntoPane("tx", "a", "center") && !sp.canTabIntoPane("tx", "a", "left") && !sp.canTabIntoPane("tn", "a", "left") && sp.canJoin("tn") === false)
{
  const now = Date.now
  let clock = now()
  Date.now = () => (clock += 1000)
  put([T("a", undefined, { group: "G", pinned: true, name: "Docs" }), T("b"), T("c", undefined, { group: "H" })], "tc",
    { groups: [{ id: "G", name: "G", color: "blue" }, { id: "H", name: "H", color: "red" }] }); ws.selectTab("ta")
  check("tab into its own pane: not in the middle", !sp.canTabIntoPane("ta", "a", "center") && sp.canTabIntoPane("ta", "a", "right"))
  sp.tabIntoPane("ta", "a", "right")
  const t = ws.activeTab()
  check("tab into its own pane's edge: a split, it on that side, the tab shown before it on the other, out of the list",
    tabs() === "[c|a]*,b" && focus() === "a" && t.id === "ta" && t.group === "G" && t.pinned && t.name === "Docs" && !ws.here().groups.some((g: Any) => g.id === "H"), [tabs(), t, ws.here().groups])
  put([T("c"), S("tx", row("s0", [a, b]), "b")], "tx"); ws.selectTab("tc"); Date.now = now; sp.tabIntoPane("tc", "c", "top")
  check("tab into its own pane's edge: … a split shown before it comes whole", tabs() === "[c/[a|b]]*" && focus() === "c", tabs())
  put([T("a")], "ta"); sp.tabIntoPane("ta", "a", "left")
  check("tab into its own pane's edge: … with no other tab, a blank pane, focused", tabs() === "[a|new]*" && ws.activePane().to === "new" && ws.activeTab().id === "ta", tabs())
}
put([S("tx", row("s0", [a, b]), "a")], "tx"); sp.paneIntoPane("a", "b", "center")
check("pane into pane: in its middle the two swap places, the moved one focused", tabs() === "[b|a]*" && focus() === "a", tabs())
put([S("tx", row("s0", [a, b]), "a"), T("c")], "tx"); sp.paneIntoPane("c", "a", "center")
check("pane into pane: … across tabs too, each where the other was", tabs() === "[c|b]*,a" && focus() === "c" && ws.here().tabs[1].id === "tc", tabs())
put([S("tx", row("s0", [a, b]), "a"), T("c")], "tx"); sp.paneIntoPane("c", "b", "bottom")
check("pane into pane: on an edge it moves beside it; its tab, left with no panes, closes", tabs() === "[a|[b/c]]*" && focus() === "c", tabs())
put([S("tx", row("s0", [a, b, c]), "b")], "tx"); sp.paneIntoPane("a", "c", "bottom")
check("pane into pane: … within its own tab", tabs() === "[b|[c/a]]*" && focus() === "a", tabs())
put([T("a")], "ta")
check("pane into pane: not onto itself", !sp.canPaneIntoPane("a", "a", "center") && !sp.canPaneIntoPane("a", "a", "left"))
put([S("tx", row("s0", [a, b]), "a"), T("c")], "tx"); sp.paneToTab("b")
check("pane to tab: out of its split into a tab of its own, right after its tab, shown", tabs() === "a,b*,c" && !sp.canPaneToTab("a"), tabs())
put([S("tx", row("s0", [a, b]), "a"), T("c")], "tx"); sp.paneToTab("b", 0)
check("pane to tab: … or where it's dropped in the list", tabs() === "b*,a,c", tabs())
put([S("tx", row("s0", [a, c]), "a"), T("b")], "tx"); sp.moveToSplit("right", "tb"); const mid3 = shares(); sp.paneToTab("b")
check("panes: one made beside another and gone again leaves it its room", mid3 === "0.25,0.25,0.50" && shares(ws.tabById("tx")) === "0.50,0.50", [mid3, shares(ws.tabById("tx"))])
put([S("tx", row("s0", [a, c], [1 - 2 ** -20, 2 ** -20]), "a")], "tx")
check("panes: one squeezed too thin to draw (a layout saved so) comes back at an even share", shares() === "0.50,0.50", shares())
put([S("tx", row("s0", [a, b, c], [0.6, 0.3, 0.1]), "a")], "tx")
check("panes: a thin one the user dragged to stays", shares() === "0.60,0.30,0.10", shares())
put([T("q", "view:terminal/q")], "tq"); sp.splitPane("right")
check("split pane: a file opens again beside it; a terminal isn't doubled, the new pane blank", tabs() === "[view:terminal/q|new]*" && focus() !== "q"
  && (put([T("a")], "ta"), sp.splitPane("bottom"), tabs() === "[a/a]*" && focus() !== "a"), tabs())

// ---- panes from the keyboard: focus by side, order and last; swap; resize; even out ----
put([S("tx", row("s0", [a, b, c], [0.3, 0.3, 0.4]), "a")], "tx"); sp.movePane("right")
check("panes: moving one swaps it with its neighbour that way, keeping the focus", tabs() === "[b|a|c]*" && shares() === "0.30,0.30,0.40" && focus() === "a", tabs())
sp.focusByOrder(1); const f1 = focus(); sp.focusByOrder(1); const f2 = focus(); sp.focusByOrder(-1)
check("panes: the next and previous pane go in order, round from the last to the first", f1 === "c" && f2 === "b" && focus() === "c", [f1, f2])
sp.focusLastPane(); const was = focus(); sp.focusLastPane()
check("panes: Focus last pane goes back to the one before, and again to where it was", was === "b" && focus() === "c" && sp.hasLastPane(), was)
sp.focusSide("left"); const fl1 = focus(); sp.focusSide("left")
check("panes: focus by side goes to the pane that way, none past the edge", fl1 === "a" && focus() === "b" && !sp.hasNeighbour("left") && sp.hasNeighbour("right"), [fl1, focus()])
put([S("tx", row3(), "a")], "tx"); sp.resize("s0", 0, 0.4, 0.05); const dragged = shares(); sp.evenOut("s0")
check("panes: a divider dragged moves the two parts beside it; double-clicked, the split's parts are even", dragged === "0.40,0.35,0.25" && shares() === "0.33,0.33,0.33", [dragged, shares()])
put([S("tx", row("s", [a, col("c2", [b, c], [0.8, 0.2])], [0.25, 0.75]), "a")], "tx"); sp.evenOutAll()
check("panes: Even out panes evens every split in the tab", shares() === "0.50,0.50" && ws.activeTab().root.kids[1].sizes.join() === "0.5,0.5" && sp.canNudge("right") && (put([T("a")], "ta"), !sp.canNudge("right")), shares())

// ---- float, dock and zoom in a tab ----
const floats = () => ws.panes().filter((p: Any) => p.float).map((p: Any) => p.id).join()
put([S("tx", row3(), "b")], "tx")
const flat = tree()
sp.floatPane()
check("float pane: the focused one floats over where it was, focused, still the tab's", floats() === "b" && focus() === "b"
  && ws.panes().length === 3 && lay.layout(ws.activeTab().root).panes.length === 2 && !sp.canFloat("b") && sp.isFloating(), floats())
sp.placeFloat("b", { x: 0.6, y: 0.2, w: 0.3, h: 0.4 })
check("float pane: moved by hand, it stays put; dock pane puts it back as it was", ws.paneById("b").float.x === 0.6 && (sp.dockPane(), floats() === "" && tree() === flat), tree())
sp.floatPane("b")
const fb = ws.paneById("b").float
check("float pane: centred on the right", fb.x + fb.w > 0.9 && Math.abs(fb.y + fb.h / 2 - 0.5) < 1e-9, fb)
sp.placeFloat("b", { x: 0.02, y: 0.02, w: 0.2, h: 0.2 }); sp.toggleFloat()
check("dock pane: away from its spot, it docks into the nearest half of the pane under it (near the top: the top half)",
  tree() === "row(col(b:0.50 a:0.50):0.50 c:0.50)" && focus() === "b", tree())
put([S("tx", row3(), "b")], "tx")
sp.toggleFloat()
check("float pane: the same command docks it", sp.isFloating() && (sp.toggleFloat(), !sp.isFloating() && tree() === flat), tree())
sp.floatPane("b"); ws.setFocusedPane("a"); sp.floatPane("a")
check("float pane: several at once, but not the last tiled one", floats() === "a,b" && !sp.canFloat("c"), floats())
ws.closePane("c"); ws.closePane("a")
check("float pane: the last tiled one closed, a floating one docks", floats() === "" && tree() === "b", tree())
put([S("tx", row3(fl), "b")], "tx"); sp.paneIntoPane("b", "c", "left")
check("float pane: dragged onto a pane's edge, it docks there, the other panes as they were", floats() === "" && tree() === "row(a:0.50 b:0.25 c:0.25)", tree())
put([S("tx", row("s0", [a, { ...b, float: fl }, c, d], [0.2, 0.4, 0.2, 0.2]), "c")], "tx"); ws.closePane("c")
check("float pane: a tiled one closed beside it leaves its room to the tiled one before", lay.layout(ws.activeTab().root).panes.map((p: Any) => w2(p.rect)).join() === "0.67,0.33",
  lay.layout(ws.activeTab().root).panes)
put([S("tx", row3(fl), "b")], "tx"); sp.splitPane("right")
check("float pane: split, it docks first", floats() === "" && lay.layout(ws.activeTab().root).panes.length === 4, tree())
put([S("tx", row3(), "b")], "tx"); sp.zoomPane()
check("zoom: the focused pane fills the tab, the others still there", ws.activeTab().zoom === "b" && sp.isZoomed() && ws.panes().length === 3)
sp.zoomPane()
check("zoom: again, it's back", !sp.isZoomed())
sp.zoomPane(); ws.setFocusedPane("a")
check("zoom: another pane focused, it's back", !sp.isZoomed())
sp.zoomPane(); sp.splitPane("right")
check("zoom: a split, it's back", !sp.isZoomed())
put([S("tx", row3(), "b")], "tx"); sp.zoomPane(); ws.newTabsAt("end", () => ws.openTab("file:z.md"))
check("zoom: another tab shown, the zoomed one keeps its zoom", !sp.isZoomed() && ws.tabById("tx").zoom === "b" && (ws.selectTab("tx"), sp.isZoomed()))
sp.openInSplit("file:y.md", "right", false)
check("zoom: something opened in another pane behind leaves it be", sp.isZoomed() && desc(ws.activeTab().root) === "[a|b|y]", desc(ws.activeTab().root))
ws.closePane("b")
check("zoom: closed, it's gone", !sp.isZoomed() && !("zoom" in ws.activeTab()))
put([S("tx", row3(), "b", { zoom: "b" })], "tx")
check("zoom: a saved one comes back; one of a pane that isn't focused doesn't", sp.isZoomed() && (put([S("tx", row3(), "a", { zoom: "b" })], "tx"), !sp.isZoomed()))

// ---- files moving and going: panes follow ----
while (ws.canReopenTab()) ws.reopenTab()
const F = (id = "f") => pane(id, "file:Inbox/x.md")
put([T("a"), TP(F()), T("b")], "tf"); ws.closeFileTabs("Inbox/x.md")
check("files: a file trashed closes its panes, reopenable", tabs() === "a,b*" && ws.canReopenTab(), tabs())
put([T("a"), TP(F()), T("b")], "tf"); ws.retarget("Inbox/x.md", "Inbox/.archive/x.md")
check("files: a file archived or moved stays open where it went, the address too", tabs() === "a,Inbox/.archive/x*,b" && g.location.hash === "#file/Inbox%2F.archive%2Fx.md", [tabs(), g.location.hash])
put([S("tx", row("s0", [{ ...a, back: ["file:Inbox/x.md"] }, F()]), "a")], "tx"); ws.retarget("Inbox", "Done")
check("files: a folder moved, the panes of its files follow, and their history", tabs() === "[a|Done/x]*" && ws.paneById("a").back.join() === "file:Done/x.md", tabs())
put([T("a"), TP(F())], "tf"); ws.closeFileTabs("Inbox")
check("files: a folder's going closes its files' panes", tabs() === "a*", tabs())
put([S("tx", row("s0", [{ ...a, back: ["file:q.md", "file:Inbox/x.md", "file:q.md"] }, F()]), "f")], "tx"); ws.dropTabs("Inbox/x.md")
check("files: deleted, its panes close (the split's others stay), it leaves every history and what ⌘⇧T reopens",
  tabs() === "a*" && ws.paneById("a").back.join() === "file:q.md" && !ws.closedTabs().some((r: Any) => r.tabs.some((t: Tb) => lay.panesOf(t).some((p: Any) => p.to === "file:Inbox/x.md"))), [tabs(), ws.closedTabs()])

// ---- views hear their panes leave (a web page is its pane's), `last` once its place shows nowhere (a terminal) ----
const heard: string[] = []
ws.setTabCloser((to: string, p: string, last: boolean, moved: boolean) => { heard.push(`${to} ${p}${last ? " last" : ""}${moved ? " moved" : ""}`); return false })
const W = "view:web/https://example.com/"
put([T("a"), T("w1", W), T("w2", W)], "tw2"); ws.closeTab("tw1", true)
check("closing: a pane of a place another pane shows is heard, not as the last", heard.join("|") === `${W} w1`, heard)
heard.length = 0; ws.closeTab("tw2", true)
check("closing: the last pane of a place is heard as the last", heard.join("|") === `${W} w2 last`, heard)
heard.length = 0; put([T("a"), T("w1", W), T("w2", W)], "ta"); ws.closeTabs("others", "ta", true)
check("closing several of a place: each heard, the last once", heard.join("|") === `${W} w1|${W} w2 last`, heard)
heard.length = 0; put([S("tx", row("s0", [a, pane("w1", W)]), "w1")], "tx"); ws.closePane("w1", true)
check("closing: a pane of a split heard, the tab staying", heard.join("|") === `${W} w1 last` && tabs() === "a*", heard)
heard.length = 0; put([T("a"), T("w1", W)], "tw1"); ws.takeOut(["tw1"])
check("a tab taken out to another window is heard as moved, never as the last", heard.join("|") === `${W} w1 moved`, heard)
heard.length = 0; put([T("a"), T("w1", W)], "tw1"); ws.closeTab("ta", true)
check("closing a file's tab tells no view", !heard.length, heard)
ws.setTabCloser(() => false)

// ---- ⌘⇧T: closed tabs and panes come back where they were ----
while (ws.canReopenTab()) ws.reopenTab()
put([S("tx", row("s0", [a, b, d], [0.6, 0.3, 0.1]), "b")], "tx"); ws.closePane()
check("close pane: its room goes to the pane before it, the focus to the one after", tree() === "row(a:0.90 d:0.10)" && focus() === "d", tree())
ws.reopenTab()
check("close pane: ⌘⇧T brings it back where it sat, at its share, focused", tree() === "row(a:0.60 b:0.30 d:0.10)" && focus() === "b", tree())
put([S("tx", row("s0", [a, col("s1", [b, c], [0.25, 0.75])], [0.7, 0.3]), "a")], "tx")
ws.closePane("b"); ws.closePane("a")
check("close pane: two closed, the splits closing up", tree() === "c", tree())
ws.reopenTab(); ws.reopenTab()
check("close pane: reopened in turn, each where it sat", tree() === "row(a:0.70 col(b:0.25 c:0.75):0.30)", tree())
put([T("a"), T("b")], "ta")
check("close pane: a tab's only pane is Close tab", !ws.canClosePane() && (ws.closePane(), tabs() === "b*"), tabs())
put([T("a"), S("tx", row("s0", [b, c]), "c"), T("d")], "tx"); ws.closeTab("tx"); ws.reopenTab()
check("reopen: a split tab closed comes back whole where it was, its focus kept", tabs() === "a,[b|c]*,d" && focus() === "c", tabs())
// Search tabs: the tab focused last first; the ones closed lately listed, the latest first, and reopened where they were.
while (ws.canReopenTab()) ws.reopenTab()
const now = Date.now
let clock = now()
Date.now = () => (clock += 1000)
put([T("a"), T("b"), T("c")], "ta"); ws.selectTab("tc"); ws.selectTab("tb")
const recent = () => ws.tabsByRecent().map((t: Tb) => t.id).join()
check("search tabs: the one on screen first, then each by when it was left", recent() === "tb,tc,ta", recent())
Date.now = () => clock
ws.selectTab("ta"); ws.selectTab("tb")
check("search tabs: … but for one only passed through", recent() === "tb,tc,ta", recent())
Date.now = now
ws.closeTab("tc"); ws.closeTab("ta")
const shut = () => ws.closedTabs().map((r: Any) => r.id).join()
check("search tabs: closed ones, the latest first", shut() === "ta,tc", shut())
ws.reopenClosed("tc")
check("search tabs: one reopened where it was, shown, and off the list", tabs() === "b,c*" && shut() === "ta", [tabs(), shut()])
put([S("tx", row("s0", [d, pane("e")]), "d")], "tx"); ws.closePane("e")
check("search tabs: a pane closed from a split is listed as a tab", shut() === "te,ta", shut())
ws.reopenClosed("te")
check("search tabs: … and comes back where it sat in its split", tabs() === "[d|e]*" && shut() === "ta", [tabs(), shut()])
while (ws.canReopenTab()) ws.reopenTab()

const rn = () => { const l = ws.here(); return l.tabs.map((t: Tb) => { const g = l.groups?.find((x: Any) => x.id === t.group); return desc(t.root) + (g ? `(${g.name})` : "") }).join(",") }
// What closed together comes back together (Chrome's "N tabs"), each where it was, with its group.
const G1 = { id: "g1", name: "Trip", color: "teal" }
put([T("a"), T("b", undefined, { group: "g1" }), T("c", undefined, { group: "g1" }), T("d")], "ta", { groups: [G1] })
const told: [string, number][] = []
ws.setClosedTogether((id: string, n: number) => told.push([id, n]))
ws.closeTabs("others", "ta", true)
check("several closed: one entry", tabs() === "a*" && shut() === "tb", [tabs(), shut()])
check("several closed: the app is told once, with the entry Undo reopens and how many", told.join("|") === "tb,3", told)
ws.reopenClosed("tb")
check("several closed: Undo (reopenClosed) brings them all back", rn() === "a,b(Trip),c(Trip),d" && !ws.canReopenTab(), rn())
ws.closeTab("td"); ws.reopenTab()
check("several closed: one tab closed tells nothing", told.length === 1, told)
ws.setClosedTogether(() => {}); ws.selectTab("ta")
ws.closeTabs("others", "ta", true)
ws.reopenTab()
check("several closed: one ⌘⇧T brings all back where they were, the tab on screen staying, their group back", rn() === "a,b(Trip),c(Trip),d" && ws.here().active === "ta"
  && !ws.canReopenTab(), [rn(), ws.here().active])
ws.selectTab("tc"); gr.closeGroup("g1")
check("close group: the group goes with its tabs", rn() === "a,d" && !ws.here().groups, rn())
ws.reopenTab()
check("close group: ⌘⇧T brings the group back, named and coloured, its tab on screen shown", rn() === "a,b(Trip),c(Trip),d" && ws.here().active === "tc", rn())
put([T("a"), T("b", undefined, { group: "g1" }), T("c")], "tb", { groups: [G1] }); ws.closeTab("tb", true)
ws.reopenTab()
check("a group's last tab closed: reopened, the group comes back", rn() === "a,b(Trip),c", rn())
ws.closeTabIds(["ta", "tb", "tc"], { force: true })
check("all closed: a blank tab left", tabs() === "new*", tabs())
ws.reopenTab()
check("all closed: one ⌘⇧T brings them back, the blank tab making way, the one shown then shown", rn() === "a,b(Trip),c" && ws.here().active === "tb", [rn(), ws.here().active])

// A pane closed comes back as it was: floating at its place (the tiled ones keeping their sizes), zoomed.
const flt = { x: 0.5, y: 0.1, w: 0.3, h: 0.4 }
put([S("tx", row("s0", [a, b, { ...c, float: flt }], [0.25, 0.75, 0.2]), "c")], "tx")
const tiles = () => lay.layout(ws.activeTab().root).panes.map((x: Any) => `${x.pane.id}:${x.rect.w.toFixed(2)}`).join()
const tiled0 = tiles()
ws.closePane("c", true); ws.reopenTab()
const backP = lay.panesOf(ws.activeTab()).find((p: Any) => p.id === "c")
check("close pane: a floating one comes back floating where it was, the tiled ones as they were", same(backP?.float, flt) && tiles() === tiled0 && focus() === "c", [backP, tiles(), tiled0])
put([S("tx", row("s0", [a, b]), "b", { zoom: "b" })], "tx")
ws.closePane("b", true); ws.reopenTab()
check("close pane: a zoomed one comes back zoomed", ws.activeTab().zoom === "b" && tree() === "row(a:0.50 b:0.50)", [ws.activeTab(), tree()])

// Nothing is lost for good: what a list put in place takes away (a layout, another device) is remembered as closed.
while (ws.canReopenTab()) ws.reopenTab()
put([T("a"), S("tx", row("s0", [b, c], [0.3, 0.7]), "c", { group: "g1" }), T("d")], "tx", { groups: [G1] })
ws.replaceWorkspace({ tabs: [T("a")], active: "ta" })
check("taken away: remembered as one entry", tabs() === "a*" && shut() === "tx", [tabs(), shut()])
ws.reopenTab()
check("taken away: ⌘⇧T brings it all back, splits, sizes and group", rn() === "a,[b|c](Trip),d" && shares(ws.here().tabs[1]) === "0.30,0.70", [rn(), shares(ws.here().tabs[1])])
ws.replaceWorkspace({ tabs: [T("a"), S("tx", c, "c", { group: "g1" }), T("d")], groups: [G1], active: "tx" }, { merge: true })
check("taken away: a pane of a split another device closed is remembered as a pane", shut() === "tb", shut())
ws.reopenTab()
check("… and comes back in its split", tabs() === "a,[b|c]*,d", tabs())
ws.replaceWorkspace({ tabs: [T("q")], active: "tq" }, { kept: true })
check("taken away, kept elsewhere (a workspace switched from): nothing remembered", !ws.canReopenTab(), shut())
ws.setOpenElsewhere((to: string) => to === "file:q.md")
ws.replaceWorkspace({ tabs: [T("a")], active: "ta" })
check("taken away, open in another workspace: nothing remembered", !ws.canReopenTab(), shut())
ws.setOpenElsewhere(() => false)
ws.replaceWorkspace({ tabs: [pane("r"), pane("a", "file:a.md")].map((p) => TP(p)), active: "tr" })
check("taken away, open there under another id: nothing remembered", !ws.canReopenTab(), shut())

// What closes is its workspace's, as its tabs are: ⌘⇧T reopens what closed there.
let wsNow = 1
ws.setWorkspaceOf(() => wsNow)
put([T("a"), T("b")], "tb"); ws.closeTab("tb", true)
wsNow = 2
check("workspaces: what closed in another isn't reopened here", !ws.canReopenTab() && shut() === "", shut())
wsNow = 1
check("… and is, back there", ws.canReopenTab() && shut() === "tb", shut())
ws.reopenTab()
ws.setWorkspaceOf(() => 0)

// ---- tab groups (tabgroups.ts) ----
const runs = () => { const l = ws.here(); return l.tabs.map((t: Tb) => { const s = l.groups?.find((x: Any) => x.id === t.group); return desc(t.root) + (s ? `(${s.name || s.color}${s.collapsed ? "-" : ""})` : "") }).join(",") }
const five = () => put(["a", "b", "c", "d", "e"].map((x) => T(x)), "ta")
// A phone's tab list (TabSwitcher.tsx): a drop keeping the tab on screen.
put([T("a"), T("b"), T("c")], "tc"); gr.groupWith("ta", "tc")
check("phone groups: a tab dropped on another: the two make a tab group where it was", runs() === "b,c(blue),a(blue)" && ws.here().active === "tc", runs())
put([T("a"), T("b"), T("c")], "ta"); gr.makeGroup(["ta", "tb"]); gr.groupWith("tc", "tb")
check("phone groups: dropped on a grouped tab, it joins that group", runs() === "a(blue),b(blue),c(blue)", runs())
put([T("a"), T("b"), T("c"), T("d")], "td"); const g0 = gr.makeGroup(["ta", "tb", "tc"]); sp.placeTabBy("ta", "after", "tc", g0)
check("phone groups: a tab moved within its open group stays in it", runs() === "b(blue),c(blue),a(blue),d", runs())
sp.placeTabBy("td", "before", "tb", null)
check("phone groups: a lone tab placed before a group stays out of it, the tab on screen kept", runs() === "d,b(blue),c(blue),a(blue)" && ws.here().active === "td", runs())
ws.selectTab("ta"); sp.placeTab("ta", 0, null); ws.selectTab("tb"); sp.keepShown("ta")
check("phone groups: after a move, the tab on screen kept", ws.here().active === "ta", ws.here().active)
// Folding the group on screen, and closing in groups, never shows a tab of another folded group while one isn't.
put(["a", "b", "c", "d", "e"].map((x) => T(x)), "tb")
const gw = gr.makeGroup(["tb", "tc"], { name: "W" }), gx = gr.makeGroup(["td"], { name: "X", collapsed: true })
gr.foldGroup(gw)
check("tab groups: folding the group on screen shows the nearest tab not folded away, past another folded group", runs() === "a,b(W-),c(W-),d(X-),e" && ws.here().active === "te", runs())
ws.selectTab("tc"); ws.closeTab("tc", true)
check("tab groups: closing a group's tab shows another of its own", ws.here().active === "tb", runs())
ws.closeTab("tb", true)
check("tab groups: closing a group's last tab shows the nearest tab not folded away", runs() === "a,d(X-),e" && ws.here().active === "te" && !!gx, runs())
five()
let g1 = gr.makeGroup(["tb", "td"], { name: "Work" })
check("tab groups: tabs made a group sit together where the first was, with the first unused colour", runs() === "a,b(Work),d(Work),c,e" && gr.allGroups()[0].color === "blue", runs())
gr.makeGroup(["te"])
check("tab groups: the next group takes the next colour; no name when the tabs share no folder or site", gr.allGroups()[1].color === "orange" && gr.allGroups()[1].name === "", gr.allGroups())
const { siteName } = await import("../../../plugins/core/web-viewer/address.ts")
gr.setGroupNamer((to: string) => (to.startsWith("view:web/") ? siteName(to.slice(9).replace(/^@[a-z0-9]+\//, "")) : null))
const of = (...tos: string[]) => tos.map((to) => lay.tabOf(to))
check("tab groups: a new group's name is the folder its panes' files share, or what their views name it (a site)",
  gr.suggestName([lay.tabOf("file:Projects/Lighthouse/a.md"), S("tx", row("s", [pane("x", "file:Projects/Lighthouse/b.md"), pane("y", "file:Projects/Lighthouse/c.md")]), "x")]) === "Lighthouse"
  && gr.suggestName(of("view:web/https://www.github.com/a", "view:web/@work/https://github.com/b")) === "Github" && gr.suggestName(of("file:a.md", "view:terminal/q")) === "")
gr.addToGroup(["ta"], g1)
check("tab groups: a tab added to a group goes to its end", runs() === "b(Work),d(Work),a(Work),c,e(orange)", runs())
gr.leaveGroup(["td"])
check("tab groups: a tab taken out of its group goes right after it", runs() === "b(Work),a(Work),d,c,e(orange)", runs())
sp.placeTab("tc", 1)
check("tab groups: a tab dragged between two of a group's tabs joins it", runs() === "b(Work),c(Work),a(Work),d,e(orange)", runs())
sp.placeTab("tc", 5)
check("tab groups: dragged out past the group's end, it leaves", runs() === "b(Work),a(Work),d,e(orange),c", runs())
sp.placeTab("ta", 2, null)
check("tab groups: at the group's end, its own last tab stays in unless the drop says none", runs() === "b(Work),a,d,e(orange),c", runs())
sp.placeTab("td", 1, g1)
check("tab groups: a drop just after a group's chip joins it", runs() === "b(Work),d(Work),a,e(orange),c", runs())
gr.foldGroup(g1)
check("tab groups: folding the group whose tab isn't on screen leaves the tab shown", runs() === "b(Work-),d(Work-),a,e(orange),c" && ws.here().active === "ta", runs())
ws.selectTab("tb")
check("tab groups: showing a tab of a folded group opens it", runs() === "b(Work),d(Work),a,e(orange),c" && ws.here().active === "tb", runs())
gr.foldGroup(g1)
check("tab groups: folding the group on screen shows the tab after it", runs() === "b(Work-),d(Work-),a,e(orange),c" && ws.here().active === "ta", runs())
gr.foldGroup(g1, false)
gr.moveGroupTo(g1, 5)
check("tab groups: a whole group dragged moves with its tabs in order", runs() === "a,e(orange),c,b(Work),d(Work)", runs())
gr.moveGroupTo(g1, 1)
check("tab groups: a group dropped inside another goes before it, never into it", runs() === "a,b(Work),d(Work),e(orange),c", runs())
// Where a drop lands among the tabs as drawn (drop.ts), each slot 96px wide and 100px from the last.
const g2 = gr.allGroups()[1].id
const laid = (keys: string[]) => keys.map((k, i) => ({ el: { closest: () => null, getBoundingClientRect: () => ({ left: i * 100, right: i * 100 + 96, top: 0, bottom: 28 }) },
  ...(k.startsWith("group:") ? { group: k.slice(6) } : { tab: k }) }))
const bar = laid(["ta", `group:${g1}`, "tb", "td", `group:${g2}`, "te", "tc"])
const at = (pos: number, slots = bar) => { const r = dr.slotIn(ws.here(), slots, pos, "x"); return `${r.index}:${r.group === g1 ? "Work" : r.group === g2 ? "orange" : r.group}` }
check("drops: right after a group's name, or between its tabs, joins it", at(150) === "1:Work" && at(250) === "2:Work", [at(150), at(250)])
check("drops: over a group's last tab joins its end; just past it, outside it at the same place", at(390) === "3:Work" && at(399) === "3:null", [at(390), at(399)])
check("drops: before a group's name joins none", at(120) === "1:null", at(120))
gr.foldGroup(g2)
const folded = laid(["ta", `group:${g1}`, "tb", "td", `group:${g2}`, "tc"])
check("drops: on the middle of a folded group's name, into its end; at its sides, beside it", at(448, folded) === "4:orange" && at(405, folded) === "3:null" && at(490, folded) === "4:null",
  [at(448, folded), at(405, folded), at(490, folded)])
sp.placeTab("tc", 4, g2)
check("drops: a tab dropped into a folded group is put away there, the tab on screen staying", runs() === "a,b(Work),d(Work),e(orange-),c(orange-)" && ws.here().active === "ta", runs())
sp.placeTab("tc", 5, null); gr.foldGroup(g2, false)
// What a list draws while dragging: the tabs as the drop would leave them.
const sl: Any = await web("core/slide.ts")
const order = (item: Any, dp: Any) => { const p = dr.previewIn(ws.here(), item, dp); return p && dr.previewOrder(ws.here(), p).map((k: string) => k === `group:${g1}` ? "[Work]" : k === `group:${g2}` ? "[orange]" : k.startsWith("t") ? k.slice(1) : k).join(",") }
check("drop preview: a tab dragged into a group's end shows there, its name before them",
  order({ from: "tab", tab: "tc" }, { kind: "list", index: 3, group: g1 }) === "a,[Work],b,d,c,[orange],e", order({ from: "tab", tab: "tc" }, { kind: "list", index: 3, group: g1 }))
check("drop preview: a file from elsewhere makes room where it'd open; a drop on a pane changes nothing in the list",
  order({ from: "tree", to: "file:z.md" }, { kind: "list", index: 1, group: null }) === `a,${sl.INCOMING},[Work],b,d,[orange],e,c`
  && order({ from: "tab", tab: "tc" }, { kind: "pane", pane: "a", zone: "left" }) === null)
check("drop preview: a whole group dragged moves with its name", order({ from: "group", group: g1 }, { kind: "list", index: 5, group: null }) === "a,[orange],e,c,[Work],b,d",
  order({ from: "group", group: g1 }, { kind: "list", index: 5, group: null }))
check("drop preview: a pane alone in its tab moves its tab", order({ from: "pane", pane: "c" }, { kind: "list", index: 0, group: null }) === "c,a,[Work],b,d,[orange],e",
  order({ from: "pane", pane: "c" }, { kind: "list", index: 0, group: null }))
// Every other list reordered by dragging (slide.ts): the order a drop at a slot leaves, which it makes way for.
const ro = (keys: string[], moving: string[], i: number) => { const r = sl.reorder(keys, moving, i); return `${r.order.join(",")}|${r.before}|${r.same}` }
check("make way: one dragged down past two lands after them, before the next", ro(["a", "b", "c", "d"], ["a"], 3) === "b,c,a,d|d|false", ro(["a", "b", "c", "d"], ["a"], 3))
check("make way: over its own place (either side of its middle), nothing changes", ro(["a", "b", "c"], ["b"], 1) === "a,b,c|c|true" && ro(["a", "b", "c"], ["b"], 2) === "a,b,c|c|true")
check("make way: past the last, the end", ro(["a", "b", "c"], ["a"], 3) === "b,c,a|null|false", ro(["a", "b", "c"], ["a"], 3))
check("make way: what comes from elsewhere opens one gap there", ro(["a", "b"], ["y", "z"], 1) === `a,${sl.INCOMING},b|b|false`, ro(["a", "b"], ["y", "z"], 1))
gr.renameGroup(g1, "  Lighthouse "); gr.colorGroup(g1, "teal")
check("tab groups: renamed (trimmed) and recoloured", gr.allGroups()[0].name === "Lighthouse" && gr.allGroups()[0].color === "teal", gr.allGroups())
while (ws.canReopenTab()) ws.reopenTab()
ws.closeTab("te")
check("tab groups: closing a group's last tab removes the group", runs() === "a,b(Lighthouse),d(Lighthouse),c" && gr.allGroups().length === 1, runs())
ws.closeTab("td"); ws.reopenTab()
check("tab groups: a closed tab reopens back in its group", runs() === "a,b(Lighthouse),d(Lighthouse),c", runs())
ws.reopenTab()
check("tab groups: one whose group went reopens where it was, its group back (Chrome's)", runs() === "a,b(Lighthouse),d(Lighthouse),e(orange),c" && gr.allGroups().length === 2, runs())
ws.selectTab("tb"); ws.go("file:z.md", true)
check("tab groups: a tab opened from a grouped tab joins its group", runs().startsWith("a,b(Lighthouse),z(Lighthouse),") && ws.activeTab().group === g1, runs())
ws.newTab()
check("tab groups: a new blank tab from a grouped tab goes after the group, in none", ws.activePane().to === "new" && !ws.activeTab().group
  && ws.here().tabs.findIndex((t: Tb) => lay.isBlankTab(t)) === ws.here().tabs.map((t: Tb) => t.group).lastIndexOf(g1) + 1, runs())
const savedGroups = JSON.parse(JSON.stringify(ws.getWorkspace())); ws.replaceWorkspace(savedGroups)
check("tab groups: a layout put back (another device, a reload) keeps them", runs() === "a,b(Lighthouse),z(Lighthouse),d(Lighthouse),new,e(orange),c", runs())
gr.ungroup(g1)
check("tab groups: ungrouped, the tabs stay where they were", runs() === "a,b,z,d,new,e(orange),c" && !ws.here().tabs.some((t: Tb) => t.group === g1), runs())
// Saved and read back: a tab in a group the list hasn't is in none; a group's tabs apart are gathered; a bad colour drops it.
const read = lay.clean({ active: "ta", tabs: [T("a", undefined, { group: "s" }), T("b"), T("c", undefined, { group: "s" }), T("d", undefined, { group: "gone" })],
  groups: [{ id: "s", name: "Read", color: "green", collapsed: true }, { id: "x", name: "Bad", color: "chartreuse" }] })
check("tab groups: read back as they must be (together, known groups only, the one on screen open)",
  read.tabs.map((t: Tb) => t.id + (t.group ?? "")).join(",") === "tas,tcs,tb,td" && read.groups.length === 1 && !read.groups[0].collapsed, read)
// An agent's pages, each in its task's tab group (openInGroup).
put([T("a"), T("c")], "ta"); const o1 = gr.openInGroup("view:web/https://z.test/", "Agent/other")
check("agent tabs: the first of a task goes in a new group of its name after the tab on screen, shown",
  runs() === "a,view:web/https://z.test/(Agent/other),c" && ws.here().active === ws.paneTab(o1).id, runs())
gr.openInGroup("view:web/https://y.test/", "Agent/other")
check("agent tabs: the next of the task goes to its group's end", runs() === "a,view:web/https://z.test/(Agent/other),view:web/https://y.test/(Agent/other),c", runs())
put([T("a"), T("c")], "ta"); const o3 = gr.openInGroup("view:web/https://h.test/", "Agent/here", true)
check("agent tabs: beside, a pane beside the focused one, the focus staying, the tab in a group of its name",
  runs() === "[a|view:web/https://h.test/](Agent/here),c" && focus() === "a" && ws.paneById(o3)?.to === "view:web/https://h.test/", runs())
// A tab's own name (Rename tab): set, trimmed, kept through a reload, and taken off by an empty one.
put([T("a"), T("b")], "ta"); ws.nameTab("tb", "  Reading   list ")
const named = lay.clean(JSON.parse(JSON.stringify(ws.getWorkspace())))
ws.nameTab("tb", " ")
const bad = lay.clean({ active: "tn", tabs: [{ ...T("n", "new"), name: 42 }] })
check("tab names: kept as one line, read back, cleared by an empty name, a bad one dropped", named.tabs[1].name === "Reading list"
  && !("name" in ws.tabById("tb")) && !("name" in bad.tabs[0]), [named.tabs[1], ws.tabById("tb"), bad.tabs[0]])

// ---- what changed, as events (tabevents.ts): what the companion follows ----
const evs: string[] = []
const off = tev.onTabsEvent((e: Any) => { const { type, ...rest } = e; evs.push([type, ...Object.values(rest).map(String)].join(" ")) })
const said = () => { const s = evs.join("|"); evs.length = 0; return s }
put([T("a"), T("b")], "ta"); said()
ws.selectTab("tb")
check("events: a tab selected: tab-focused and pane-focused, with what was", said() === "tab-focused tb ta|pane-focused b tb a")
const zp = ws.openTab("file:z.md", { background: true }), zt = ws.paneTab(zp).id
check("events: a tab opened: tab-opened and pane-opened", said() === `tab-opened ${zt}|pane-opened ${zp} ${zt}`)
sp.placeTab(zt, 0)
check("events: a tab dragged: tab-moved with its index, not the ones it shifted", said() === `tab-moved ${zt} 0`)
ws.goHere("file:y.md")
check("events: a pane shows another place: pane-changed", said() === "pane-changed b tb file:y.md")
sp.paneIntoPane(zp, "a", "right")
const moved = said()
check("events: a pane moved into another tab: pane-moved from its tab, which closed; that tab and pane focused",
  moved === `tab-closed ${zt}|pane-moved ${zp} ta ${zt}|tab-focused ta tb|pane-focused ${zp} ta b`, moved)
ws.setFocusedPane("a")
check("events: a pane clicked: only pane-focused", said() === `pane-focused a ta ${zp}`)
ws.closePane(zp)
check("events: a pane closed: pane-closed", said() === `pane-closed ${zp} ta`)
ws.closeTab("tb")
check("events: a tab closed: tab-closed and its panes' pane-closed", said() === "tab-closed tb|pane-closed b tb")
off()
ws.selectTab("ta")
check("events: unsubscribed, nothing heard", said() === "")

// A pane named as the user says it (vau open --in), and something opened there as a new tab of its own.
put([S("tx", row("s0", [col("s1", [a, b]), c]), "c"), T("d")], "tx")
gr.setPaneLabeler((p: Any) => (p.to === "file:c.md" ? "Squad: a team of agents" : p.to))
const nm = (q: string) => { try { return gr.paneNamed(q).id } catch (e) { return messageOf(e) } }
check("vau open --in: a pane by where it is, by this, by what it shows (another tab's too), by its title's words, by id",
  nm("top left") === "a" && nm("the bottom-left one") === "b" && nm("the right side panel") === "c" && nm("this") === "c" && nm("b.md") === "b"
  && nm("the one showing d") === "d" && nm("the one showing squad") === "c" && nm("a") === "a",
  ["top left", "the right side panel", "this", "b.md", "the one showing d", "the one showing squad"].map(nm))
check("vau open --in: two at the place named, or none showing it, says which there are",
  /^2 panes are at the left: a \(file:a\.md\), b \(file:b\.md\)/.test(nm("left")) && /^no pane shows Lighthouse: the tab on screen has a/.test(nm("Lighthouse")), [nm("left"), nm("Lighthouse")])
const inA = ws.openInPane("a", "view:web/https://x.test/")
const leafA = () => lay.paneWith(ws.activeTab().root, inA)
check("vau open --in: in a split, a new tab of that pane's own, shown and focused; the split as it was",
  tabs() === "[[view:web/https://x.test//b]|c]*,d" && focus() === inA && lay.placesOf(leafA()).map((p: Any) => p.to).join() === "file:a.md,view:web/https://x.test/", tabs())
ws.selectPane("a"); ws.setFocusedPane("c"); const twice = ws.openInPane("a", "view:web/https://x.test/")
check("vau open --in: one that pane has already is shown, not opened twice", twice === inA && focus() === inA && lay.placesOf(leafA()).length === 2, tabs())
ws.openInPane("d", "file:z.md")
check("vau open --in: a tab of one pane gets a tab after it", tabs() === "[[view:web/https://x.test//b]|c],d,z*", tabs())

// ---- what agents ask (vau tabs) ----
const ask = (m: Props) => { try { return g.__answerUi.tabs(m) } catch (e) { return { error: messageOf(e) } } }
put([S("tx", row("s0", [a, b]), "b"), T("c")], "tx")
check("vau tabs list: each tab with its panes (path, focused), the one on screen; the groups",
  same(ask({ do: "list" }), { tabs: [{ id: "tx", active: true, panes: [{ id: "a", to: "file:a.md", path: "a.md" }, { id: "b", to: "file:b.md", path: "b.md", focused: true }] },
    { id: "tc", panes: [{ id: "c", to: "file:c.md", path: "c.md", focused: true }] }], groups: [] }), ask({ do: "list" }))
const fc = ask({ do: "focus", what: "c.md" })
check("vau tabs focus: a pane named by its file shown, focused", same(fc, { tab: "tc", pane: "c" }) && tabs() === "[a|b],c*", fc)
const spl = ask({ do: "split", pane: "c", side: "bottom", to: "file:z.md" })
check("vau tabs split: something opened beside a pane, in its tab", spl.tab === "tc" && ws.paneById(spl.pane)?.to === "file:z.md" && tabs() === "[a|b],[c/z]*", [spl, tabs()])
ask({ do: "swap", pane: "a", with: "c" })
check("vau tabs swap: two panes in each other's places, across tabs", tabs() === "[c|b],[a/z]*", tabs())
ask({ do: "move", what: "z.md", at: 0 })
check("vau tabs move: a pane of a split to a place in the list, a tab of its own", tabs() === "z*,[c|b],a", tabs())
ask({ do: "move", what: "tc", into: "b", side: "right" })
check("vau tabs move: a tab into a pane's side", tabs() === "z,[c|b|a]*" && focus() === "a", tabs())
const grp = ask({ do: "group", tabs: ["z.md"], name: "Later", color: "green" })
check("vau tabs group: tabs named made a group, its name and colour", grp.group?.name === "Later" && grp.group.color === "green" && grp.group.tabs.length === 1, grp)
check("vau tabs: errors say what's wrong", ask({ do: "focus", what: "nope.md" }).error === "no open tab or pane is nope.md (vau tabs lists them)"
  && ask({ do: "split", pane: "b", side: "center" }).error === "a split's side is left, right, top or bottom"
  && ask({ do: "split", pane: "b", side: "up" }).error === "a side is left, right, top, bottom or center"
  && ask({ do: "swap", pane: "b", with: "b" }).error === "those are the same pane"
  && ask({ do: "group", tabs: ["b"], color: "chartreuse" }).error?.startsWith("a colour is one of")
  && ask({ do: "group", group: "nope" }).error === "no tab group nope (vau tabs lists them)"
  && ask({ do: "move", what: "z.md" }).error === "say where: `into` a pane (with `side`), or `at` a place in the list"
  && ask({ do: "what" }).error?.startsWith("do is list"), tabs())
const cl = ask({ do: "close", tabs: ["file:z.md", "file:a.md"] })
check("vau tabs close: the panes showing those close, a tab with none left too", cl.closed === 2 && tabs() === "[c|b]*", [cl, tabs()])

// ---- tabs that archive themselves: stamped while on screen (only with archiving on); never one on screen, pinned or
// that closing would lose; closed with no ⌘⇧T entry, put back where they were; stamps from another device's copy taken ----
const H = 3600_000, old = Date.now() - 48 * H
while (ws.canReopenTab()) ws.reopenTab()
ws.setArchivable((p: Any) => p.to !== "file:keep.md")
put([T("a"), T("b")], "ta")
check("archive: off, no pane is stamped", ws.here().tabs.every((t: Tb) => lay.panesOf(t).every((p: Any) => p.seen === undefined)), ws.here().tabs)
const seen = (p: Any) => ({ ...p, seen: old })
put([TP(seen(a)), TP(seen(b)), TP(seen(pane("p")), { pinned: true }), TP(seen(pane("k", "file:keep.md"))), T("c")], "ta")
ws.setArchiveAfter(24 * H)
const seenOf = (id: string) => ws.paneById(id)?.seen
check("archive: on, the panes on screen and those never stamped are seen now; the rest keep theirs", seenOf("a") > old && seenOf("c") > old && seenOf("b") === old, ws.here().tabs)
check("archive: due are the unseen, unpinned, not on screen and archivable", ws.unseenTabs(Date.now() - 24 * H).map((t: Tb) => t.id).join() === "tb")
put([S("tx", row("s0", [seen(pane("x1")), pane("x2")]), "x1"), T("y")], "ty"); const halfDue = ws.unseenTabs(Date.now() - 24 * H).length
put([S("tx", row("s0", [seen(pane("x1")), seen(pane("x2"))]), "x1"), T("y")], "ty")
check("archive: a split tab is due only once each of its panes is", halfDue === 0 && ws.unseenTabs(Date.now() - 24 * H).map((t: Tb) => t.id).join() === "tx")
put([TP(seen(a)), TP(seen(b)), TP(seen(pane("p")), { pinned: true }), TP(seen(pane("k", "file:keep.md"))), T("c")], "ta")
const gone = ws.closeToArchive(["tb"])
check("archive: closed, its place kept, nothing for ⌘⇧T", tabs() === "a*,p,keep,c" && gone[0]?.at === 1 && !ws.canReopenTab(), [tabs(), gone])
ws.selectTab("tc"); ws.restoreTab(gone[0], false)
check("archive: put back behind the tab on screen", tabs() === "a,b,p,keep,c*", tabs())
const soon = Math.floor(Date.now() / 60_000) * 60_000 + 5 * 60_000
ws.mergeSeen({ tabs: [TP({ ...a, seen: soon }), TP(seen(b))], active: "ta" })
check("archive: a later stamp from another device's copy is taken, an earlier one isn't", seenOf("a") === soon && seenOf("b") > old)
const copy = (s: number) => ({ ...ws.getWorkspace(), tabs: ws.here().tabs.map((t: Tb) => (t.id === "tb" ? TP({ ...t.root, seen: s }) : t)) })
check("archive: a stamp behind the file by over a quarter of the archive time is worth a write, else it rides along",
  ws.seenSince(copy(old)) && !ws.seenSince(copy(Date.now() - H)) && !ws.seenSince(ws.getWorkspace()))
ws.setArchiveAfter(0)
check("archive: off, nothing is worth a write", !ws.seenSince(copy(old)))
// (a layout turning archiving on: nothing goes at once by the stamps of the last time it was on)
ws.setArchiveAfter(24 * H)
const dueNow = ws.archivingDue()
mem.set("vaultite.tabs.archiving", String(Date.now() - 25 * H)); ws.setArchiveAfter(24 * H)
check("archive: none due till it's been on as long as the setting", !dueNow && ws.archivingDue())
ws.setArchiveAfter(0)

// ---- a split's panes with tabs of their own (Pane.stack): places stacked behind what a pane shows ----
{
  while (ws.canReopenTab()) ws.reopenTab()
  // Each pane of the tab on screen as its places in order, the shown one marked: "a ^x y|b".
  const own = (t: Tb = ws.activeTab()) => lay.panesOf(t).map((p: Any) => lay.placesOf(p).map((x: Any, _: number, all: Any[]) => (x.id === p.id && all.length > 1 ? "^" : "") + short(x.to)).join(" ")).join("|")
  const stk = (p: Any, stack: Any[], stackAt?: number) => ({ ...p, stack, ...(stackAt ? { stackAt } : {}) })
  const x = pane("x"), y = pane("y")
  check("stack: a pane's places in order, the shown one at stackAt; stacked() makes it back from them",
    lay.placesOf(stk(a, [x, y], 1)).map((q: Any) => q.id).join() === "x,a,y" && same(lay.stacked([x, a, y], "a"), stk(a, [x, y], 1)) && same(lay.stacked([a], "a"), a))
  const sx = S("tx", row("s0", [stk(a, [x, y]), b]), "a")
  check("stack: every place of a tab, the pane that has one, whether it's stacked; the tab of a stacked place",
    lay.placesIn(sx).map((q: Any) => q.id).join() === "a,x,y,b" && lay.paneWith(sx.root, "y")?.id === "a" && lay.isStacked(sx.root, "y") && !lay.isStacked(sx.root, "a")
    && lay.tabOfPane({ tabs: [T("q"), sx], active: "tq" }, "x")?.id === "tx" && lay.allPanes({ tabs: [sx], active: "tx" }).length === 4)
  const shownY = lay.showingPlace(sx, "y")
  check("stack: showing a place, what the pane showed goes behind it in its place, the focus following",
    own(shownY) === "a x ^y|b" && shownY.focus === "y" && lay.showingPlace(S("tx", row("s0", [stk(pane("n", "new"), [x]), b]), "n"), "x").root.kids[0].stack === undefined)
  const added = lay.withPlace(sx, "a", pane("z")), behind = lay.withPlace(sx, "a", pane("z"), { show: false, index: 3 })
  check("stack: a place added after one, shown and focused; or behind, at an index", own(added) === "a ^z x y|b" && added.focus === "z" && own(behind) === "^a x y z|b" && behind.focus === "a",
    [own(added), own(behind)])
  const gone1 = lay.tabWithout(sx, new Set(["a"])), gone2 = lay.tabWithout(S("tx", row("s0", [stk(a, [x], 1), b]), "a"), new Set(["a"]))
  check("stack: the shown place closed, the one after it shows (else before), focused; a stacked one closed, nothing moves",
    own(gone1) === "^x y|b" && gone1.focus === "x" && own(gone2) === "x|b" && own(lay.tabWithout(sx, new Set(["y"]))) === "^a x|b", [own(gone1), own(gone2)])
  check("stack: a pane's places all closed, the pane goes", desc(lay.tabWithout(sx, new Set(["a", "x", "y"])).root) === "b")
  const fl2 = { x: 0.5, y: 0.1, w: 0.4, h: 0.5 }
  check("stack: a floating pane's float stays where it is, with what it shows", same(lay.showingPlace(S("tx", row("s0", [{ ...stk(a, [x]), float: fl2 }, b]), "a"), "x").root.kids[0].float, fl2))
  const sp1 = lay.spilled({ tabs: [T("q"), { ...TP(stk(a, [x, y], 1)), group: "g" }], active: "ta" })
  check("stack: a tab of one pane can't hold one: its places are tabs of their own beside it, in its group, the shown one keeping it",
    sp1.tabs.map((t: Tb) => `${t.id}:${desc(t.root)}${t.group ? "@" + t.group : ""}`).join() === "tq:q,tx:x@g,ta:a@g,ty:y@g" && sp1.active === "ta", sp1)
  const read = lay.clean({ tabs: [S("tx", row("s0", [stk(a, [x, { ...y, float: fl2, stack: [c] }, x], 9), b]), "a"), T("x")], active: "tx" })
  check("stack: read back checked: no float or stack of its own, a place twice once, stackAt kept in range; a tab whose places are taken goes",
    own(read.tabs[0]) === "x y ^a|b" && read.tabs.length === 1 && !read.tabs[0].root.kids[0].stack[1].float && !read.tabs[0].root.kids[0].stack[1].stack, read)
  check("stack: a saved tab of one pane with a stack reads as tabs", lay.clean({ tabs: [TP(stk(a, [x]))], active: "ta" }).tabs.map((t: Tb) => desc(t.root)).join() === "a,x")

  // In the app: a split's pane opens its new tabs among its own.
  put([S("tx", row("s0", [a, pane("w", W)]), "a"), T("q")], "tx")
  ws.go("view:links")
  check("stack: in a split, what would open a new tab opens among the focused pane's tabs, shown; nothing new in the list",
    tabs() === "[view:links|view:web/https://example.com/]*,q" && own() === `a ^view:links|${W}`, [tabs(), own()])
  put([S("tx", row("s0", [a, b]), "a"), T("q")], "tx")
  const bg = ws.openTab("file:z.md", { background: true, from: "a" }), bg2 = ws.openTab("file:v.md", { background: true, from: "a" })
  check("stack: opened behind from a pane, it's stacked after it, the next after that one, as Chrome orders them; an agent's (no pane) is a tab in the list",
    own() === "^a z v|b" && ws.paneById(bg).from === "a" && !!bg2 && (ws.openTab("file:m.md", { background: true }), tabs() === "[a|b]*,m,q"), [own(), tabs()])
  ws.newTab()
  const blankId = focus()
  check("stack: ⌘T in a split, a blank tab of the focused pane; again, nothing more", own() === "a ^new z v|b" && (ws.newTab(), own() === "a ^new z v|b"), own())
  ws.go("file:c.md")
  check("stack: what's opened from it fills it", own() === "a ^c z v|b" && focus() === blankId, own())
  ws.selectPane(bg)
  check("stack: a stacked place selected shows in its pane, focused", own() === "a c ^z v|b" && focus() === bg, own())
  ws.go("file:c.md")
  check("stack: going to a place stacked in a pane shows it there", own() === "a ^c z v|b" && tabs() === "[c|b]*,m,q", [own(), tabs()])
  ws.cycleTab(1); const c1 = own(); ws.cycleTab(1); const c2 = own(); ws.cycleTab(1)
  check("stack: next tab goes through the focused pane's tabs, then on to the next tab", c1 === "a c ^z v|b" && c2 === "a c z ^v|b" && ws.activeTab().root.to === "file:m.md", [c1, c2, tabs()])
  ws.selectTab("tx"); ws.selectPane(bg2); ws.closePane()
  check("stack: closing the place shown, the pane's next shows (before it, at its end)", own() === "a c ^z|b" && focus() === bg, own())
  ws.reopenTab()
  check("stack: ⌘⇧T brings it back among them, where it was", own() === "a c z ^v|b" && focus() === bg2, own())
  ws.closePane("a"); ws.closePane(blankId)
  check("stack: a stacked one closed, the shown one stays", own() === "z ^v|b", own())
  ws.closePane(bg2); ws.closePane(bg)
  check("stack: its last place closed, the pane closes", tabs() === "b*,m,q", tabs())
  heard.length = 0
  ws.setTabCloser((_to: string, p: string, last: boolean) => { heard.push(`${p}${last ? " last" : ""}`); return false })
  put([S("tx", row("s0", [stk(pane("w1", W), [pane("w2", "view:web/https://example.net/")]), b]), "b")], "tx"); ws.closeTab("tx", true)
  check("stack: a split tab closed, the pages stacked in it hear it too", heard.join() === "w1 last,w2 last", heard)
  ws.setTabCloser(() => false)
  put([S("tx", row("s0", [stk(a, [x]), b]), "b")], "tx"); ws.closePane("b")
  check("stack: a split closed down to one pane, its tabs become tabs of their own", tabs() === "a*,x", tabs())
  put([S("tx", row("s0", [a, b]), "a"), T("q")], "tx"); sp.tabIntoPane("tq", "b", "center")
  check("stack: a tab dropped on a split's pane (or ⌥-clicked) is one of its tabs, what it showed behind it", tabs() === "[a|q]*" && own() === "a|b ^q" && focus() === "q", [tabs(), own()])
  put([S("tx", row("s0", [stk(a, [x, y]), b]), "a"), T("q")], "tx"); sp.openAt("file:k.md", "b", "center")
  const k = focus()
  check("stack: a file dropped on a split pane's middle opens among its tabs", own() === "^a x y|b ^k", own())
  sp.placeAmong("y", "a", 0)
  check("stack: a place dragged along its pane's list moves, what shows staying", own() === "y ^a x|b ^k", own())
  sp.placeAmong("x", k, 0)
  check("stack: dragged onto another pane's list, it's shown there, focused", own() === "y ^a|^x b k" && focus() === "x", own())
  sp.placeAmong("q", k, 1)
  check("stack: a tab of the list dragged onto a pane's list joins it", own() === "y ^a|x ^q b k" && tabs() === "[a|q]*", [own(), tabs()])
  sp.paneToTab("y")
  check("stack: a place dragged out to the list is a tab of its own, shown", tabs() === "[a|q],y*" && own(ws.tabById("tx")) === "a|x ^q b k", [tabs(), own(ws.tabById("tx"))])
  ws.selectTab("tx"); sp.paneIntoPane("q", "a", "right", true)
  check("stack: a place dragged onto a pane's edge is a pane of its own there, its pane showing its next", tabs() === "[a|q|b]*,y" && own() === "a|q|x ^b k", [tabs(), own()])
  sp.paneIntoPane("b", "a", "left")
  check("stack: a pane dragged by its bar moves with its tabs", own() === "x ^b k|a|q", own())
  ws.retarget("k.md", "Done/k.md")
  check("stack: a file moved, its stacked places follow", own() === "x ^b Done/k|a|q", own())
  check("stack: the place a pane shows onto its own pane: not its middle, nor the edge of one with no other",
    !sp.canPaneIntoPane("b", "b", "center", true) && !sp.canPaneIntoPane("a", "a", "right", true) && !sp.canPaneIntoPane("b", "b", "right") && sp.canPaneIntoPane("b", "b", "right", true))
  sp.paneIntoPane("b", "b", "bottom", true)
  check("stack: the place a pane shows onto its own pane's edge splits off there, its pane showing its next", own() === "x ^Done/k|b|a|q" && tabs() === "[[Done/k/b]|a|q]*,y" && focus() === "b", [own(), tabs()])
}

// ---- Workspaces holding the tabs (a layout turning it on and off): this device's own come back as they were ----
const stub = g.localStorage
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
put([T("a", undefined, { group: "g1" }), S("tb", row("s0", [b, col("s1", [c, d], [0.7, 0.3])], [0.25, 0.75]), "c", { group: "g1" }), T("e", undefined, { group: "g2" })], "tb",
  { groups: [{ id: "g1", name: "Trip", color: "teal" }, { id: "g2", name: "Later", color: "red", collapsed: true }] })
const mine = JSON.stringify(ws.getWorkspace())
const took = ws.tabsInWorkspace(true), again = ws.tabsInWorkspace(true)
put([T("w")], "tw")
check("workspaces: held, what's shown is saved apart; this device's own stay as they were", took && !again && mem.get("vaultite.tabs") === mine
  && JSON.parse(mem.get("vaultite.tabs.workspace") ?? "{}").active === "tw", [took, again])
ws.tabsInWorkspace(false)
check("workspaces: let go, this device's tabs, groups, splits, sizes and focus come back exactly", same(ws.getWorkspace(), JSON.parse(mine)) && !mem.has("vaultite.tabs.workspace"),
  [ws.getWorkspace(), mine])
g.localStorage = stub
