import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, WS_DIR, api, app, check, clearWs, exists, read, readWs, write, writeWs } = $
  const { vau, conf, w2, uiOf } = $.vars
  // Layouts as the app keeps them (core/layout.ts): a list of tabs, each a tree of splits of panes. A tab of one pane
  // is "t" and the pane's id; a split tab `S`; `desc` the list as "[a|b],c*" (pane ids, the tab on screen starred).
  const P = (id: string, to: string) => ({ id, to })
  const T = (id: string, to: string) => ({ id: `t${id}`, root: P(id, to), focus: id })
  const S = (id: string, kids: Any[], focus: string, extra: Any = {}) => ({ id: `t${id}`, root: { id: `s${id}`, dir: "row", kids, sizes: kids.map(() => 1 / kids.length) }, focus, ...extra })
  const L = (tabs: Any[], active = tabs[0].id, extra: Any = {}) => ({ tabs, active, ...extra })
  const desc = (l: Any) => (l?.tabs ?? []).map((t: Any) => (t.root.kids ? `[${t.root.kids.map((k: Any) => k.id).join("|")}]` : t.root.id) + (t.id === l.active ? "*" : "")).join(",")
  const tos = (l: Any) => (l?.tabs ?? []).flatMap((t: Any) => (t.root.kids ?? [t.root]).map((p: Any) => p.to)).join()
  // ---------- workspaces (plugins/core/workspaces): a file per workspace ----------
  {
    let [st, body] = await api("GET", "workspaces")
    check("workspaces: none yet", st === 200 && Array.isArray(body.workspaces) && !body.workspaces.length, body)
    ;[st, body] = await api("PUT", "workspaces/2", { sidebars: { left: ["terminal:sessions"], right: [], collapsed: [], heights: {} }, name: "Shells" })
    check("workspaces: a slot is made, the ones before it empty", st === 200 && body.name === "Shells" &&
      JSON.stringify(readWs().workspaces.map((w: Any) => w && w.name)) === JSON.stringify([null, "Shells"]), readWs())
    ;[st, body] = await api("PUT", "workspaces/2", { layout: L([T("1", "file:Mac.md")]), name: null })
    check("workspaces: keys merge, null removes one", st === 200 && body.sidebars.left[0] === "terminal:sessions" && body.layout.active === "t1" && !("name" in body), body)
    // A layout from before tabs held panes (groups of tabs in splits): migrated as every device migrates it.
    ;[st, body] = await api("PUT", "workspaces/2", { layout: { root: { id: "s0", dir: "row", sizes: [0.5, 0.5], kids: [
      { id: "g0", tabs: [{ id: "t1", to: "file:Mac.md" }, { id: "t2", to: "file:Two.md" }], active: "t1" }, { id: "g1", tabs: [{ id: "t3", to: "file:Three.md" }], active: "t3" }] }, focus: "g1" } })
    check("workspaces: an old layout written is read back migrated (old tab ids are pane ids, each tab \"t\" and its first pane's)",
      st === 200 && desc(body.layout) === "t2,[t1|t3]*" && body.layout.tabs.map((t: Any) => t.id).join() === "tt2,tt1" &&
      body.layout.tabs[1].focus === "t3" && !("root" in body.layout) && desc(readWs().workspaces[1].layout) === "t2,[t1|t3]*", [body.layout, readWs().workspaces[1]])
    ;[st] = await api("PUT", "workspaces/6", { name: "Six" })
    check("workspaces: only 1 to 5", st === 400)
    const s2 = (await api("GET", "state"))[1]
    check("workspaces: in /api/state", s2.workspaces?.[1]?.sidebars?.left[0] === "terminal:sessions", s2.workspaces)
    ;[st] = await api("DELETE", "workspaces/2")
    check("workspaces: deleting empties the slot (trailing empties dropped)", st === 200 && readWs().workspaces.length === 0, readWs())
    // Two devices: a phone writes slot 1 while the file on disk already has another device's slot 2 (written behind the
    // server's back): the write goes into the file as it is then, and slot 2 stays.
    writeWs(({ workspaces: [null, { layout: L([T("9", "file:Mac.md")]) }], other: 1 }))
    ;[st] = await api("PUT", "workspaces/1", { layout: L([T("1", "file:Phone.md")]) })
    const both = readWs()
    check("workspaces: a write to one slot keeps another device's slot and other keys", st === 200 &&
      tos(both.workspaces[0].layout) === "file:Phone.md" && tos(both.workspaces[1].layout) === "file:Mac.md" && both.other === 1, both)
    write(`${WS_DIR}/1.json`, "{\"layout\": {")
    ;[st] = await api("PUT", "workspaces/1", { name: "Half" })
    check("workspaces: an unreadable file (mid-sync) isn't overwritten", st === 409 && read(`${WS_DIR}/1.json`) === "{\"layout\": {", [st, read(`${WS_DIR}/1.json`)])
    clearWs()
    const cw = await vau("workspace")
    check("vau workspace: lists them", cw.code === 0 && cw.out.includes("no workspaces yet"), cw)

    // Moving to another workspace (POST /api/workspaces/move): a tab (all its panes), or a pane out of its split as a tab
    // of its own, to the end of the target's list, not shown there; applied to the file as it is.
    writeWs(({ workspaces: [
      { name: "Main", layout: L([S("x", [P("a", "file:Notes/A.md"), P("b", "file:Notes/B.md")], "b"), T("c", "view:terminal/abc")]) },
      { sidebars: { left: ["terminal:sessions"], right: [], collapsed: [], heights: {} }, layout: L([T("y", "file:Notes/Y.md")]) },
      null,
      { layout: L([T("n", "new")]) },
    ], other: 1 }))
    const wsNow = readWs
    ;[st, body] = await api("POST", "workspaces/move", { from: 1, to: 2, pane: "b" })
    let w = wsNow().workspaces
    check("workspaces move pane: out of its split as a tab of its own (\"t\" and its id), at the end of the target's tabs, not shown there",
      st === 200 && body.from === 1 && body.to === 2 && body.tab.id === "tb" && body.tab.root.id === "b" &&
      desc(w[0].layout) === "a*,c" && w[0].layout.tabs[0].focus === "a" && desc(w[1].layout) === "y*,b" &&
      w[1].sidebars.left[0] === "terminal:sessions" && wsNow().other === 1 && body.workspaces[1].layout.tabs.length === 2, [st, body, w])
    ;[st, body] = await api("POST", "workspaces/move", { to: 3, path: "view:terminal/abc" })
    w = wsNow().workspaces
    check("workspaces move: a tab named by what its pane shows; an empty target is made with it (no sidebars of its own)",
      st === 200 && body.from === 1 && desc(w[0].layout) === "a*" && desc(w[2].layout) === "c*" && tos(w[2].layout) === "view:terminal/abc" && !("sidebars" in w[2]), [st, body, w])
    ;[st, body] = await api("POST", "workspaces/move", { from: 1, to: 4, path: "Notes/A.md" })
    w = wsNow().workspaces
    check("workspaces move: a workspace's only tab leaves a blank one (kept: it's named); an unused target (a lone blank tab) gets the tab in its place",
      st === 200 && w[0].name === "Main" && w[0].layout.tabs.length === 1 && tos(w[0].layout) === "new" && w[0].layout.active === w[0].layout.tabs[0].id &&
      desc(w[3].layout) === "a*" && w[3].layout.tabs[0].id === "tx", [st, w])
    ;[st, body] = await api("POST", "workspaces/move", { to: 2, path: "Notes/A.md", from: 1 })
    check("workspaces move: a tab that isn't there is a 404", st === 404, [st, body])
    ;[st, body] = await api("POST", "workspaces/move", { to: 4, tab: "tx" })
    check("workspaces move: onto its own workspace is refused", st === 400, [st, body])
    ;[st, body] = await api("POST", "workspaces/move", { to: 7, tab: "tx" })
    check("workspaces move: only 1 to 5", st === 400, [st, body])
    // A whole split tab: its panes, focus and name go with it, out of its tab group.
    writeWs(({ workspaces: [
      { layout: L([S("x", [P("a", "file:Notes/A.md"), P("b", "file:Notes/B.md")], "b", { name: "Pair", group: "g" }), T("c", "view:terminal/abc")], "tc", { groups: [{ id: "g", name: "G", color: "blue" }] }) },
      { name: "Two", layout: L([T("y", "file:Notes/X.md")]) },
    ] }))
    ;[st, body] = await api("POST", "workspaces/move", { from: 1, to: 2, tab: "tx" })
    w = wsNow().workspaces
    const moved = w[1].layout.tabs[1]
    check("workspaces move tab: a split tab goes whole (its panes, focus, name), out of its group, at the target's end, the target's tab still shown",
      st === 200 && desc(w[1].layout) === "y*,[a|b]" && moved.focus === "b" && moved.name === "Pair" && !("group" in moved) &&
      desc(w[0].layout) === "c*" && !w[0].layout.groups, [st, body, w])
    // Undo's move back (`at`, `group`): to its index there, in its group again when a neighbour still is.
    writeWs(({ workspaces: [
      { layout: L([T("a", "file:Notes/A.md"), { ...T("b", "file:Notes/B.md"), group: "g" }, { ...T("c", "file:Notes/C.md"), group: "g" }, T("d", "file:Notes/D.md")], "ta", { groups: [{ id: "g", name: "G", color: "blue" }] }) },
      { layout: L([T("y", "file:Notes/Y.md")]) },
    ] }))
    await api("POST", "workspaces/move", { from: 1, to: 2, tab: "tb" })
    ;[st] = await api("POST", "workspaces/move", { from: 2, to: 1, tab: "tb", at: 1, group: "g" })
    w = wsNow().workspaces
    check("workspaces move back (Undo): at its index, in its group", st === 200 && desc(w[0].layout) === "a*,b,c,d" && w[0].layout.tabs[1].group === "g" && desc(w[1].layout) === "y*", [st, w])
    await api("POST", "workspaces/move", { from: 1, to: 2, tab: "td" })
    ;[st] = await api("POST", "workspaces/move", { from: 2, to: 1, tab: "td", at: 9 })
    w = wsNow().workspaces
    check("workspaces move back: an index past the end is the end, out of the group beside it", st === 200 && desc(w[0].layout) === "a*,b,c,d" && !("group" in w[0].layout.tabs[3]), [st, w])
    writeWs(({ workspaces: [
      { layout: L([T("c", "view:terminal/abc")]) },
      { name: "Two", layout: L([T("y", "file:Notes/X.md"), S("x", [P("a", "file:Notes/A.md"), P("b", "file:Notes/B.md")], "b", { name: "Pair" })]) },
    ] }))
    ;[st, body] = await api("POST", "workspaces/move", { to: 2, tab: "tc" })
    w = wsNow().workspaces
    check("workspaces move tab: a workspace's last tab leaves it unused (null)", st === 200 && w[0] === null && desc(w[1].layout) === "y*,[a|b],c", [st, w])
    ;[st, body] = await api("POST", "workspaces/move", { from: 2, to: 4, pane: "b" })
    w = wsNow().workspaces
    check("workspaces move pane: into an unused workspace it's the whole layout; the split it left closes up", st === 200 && desc(w[3].layout) === "b*" &&
      desc(w[1].layout) === "y*,a,c" && w[1].layout.tabs[1].id === "tx", [st, w])
    ;[st] = await api("POST", "workspaces/move", { from: 2, to: 3, pane: "nope" })
    check("workspaces move pane: a pane that isn't there is a 404", st === 404)
    ;[st] = await api("POST", "workspaces/move", { from: 2, to: 3, pane: "a", tab: "ty" })
    check("workspaces move: one thing at a time", st === 400)

    // Files opened in another workspace (`open`: a file dragged from the tree onto a number): new tabs at the end of its
    // list, not shown; one already open there is left alone.
    write("Notes/Qa ws open.md", "Opened elsewhere.\n")
    ;[st, body] = await api("POST", "workspaces/move", { to: 4, open: ["Notes/Qa ws open.md"] })
    w = wsNow().workspaces
    check("workspaces open: a new tab at the end of its tabs, not shown", st === 200 && body.tabs.length === 1 &&
      tos(w[3].layout) === "file:Notes/B.md,file:Notes/Qa ws open.md" && w[3].layout.active === "tb", [body, w])
    ;[st, body] = await api("POST", "workspaces/move", { to: 4, open: "Notes/Qa ws open.md" })
    check("workspaces open: already open there: nothing changes", st === 200 && !body.tabs.length && wsNow().workspaces[3].layout.tabs.length === 2, [body, wsNow()])
    ;[st, body] = await api("POST", "workspaces/move", { to: 5, open: ["Notes/Qa ws open.md"] })
    check("workspaces open: an unused workspace gets it as its only tab", st === 200 && tos(wsNow().workspaces[4].layout) === "file:Notes/Qa ws open.md", wsNow())
    ;[st] = await api("POST", "workspaces/move", { to: 5, open: ["Notes/Nowhere.md"] })
    check("workspaces open: a file that isn't there is a 404", st === 404)
    let cm = await vau("workspace", "open", "Notes/Qa ws open.md", "1")
    check("vau workspace open", cm.code === 0 && cm.out.includes("Opened") && tos(wsNow().workspaces[0].layout) === "file:Notes/Qa ws open.md", [cm, wsNow()])
    cm = await vau("workspace")
    check("vau workspace: unused ones say so", cm.code === 0 && cm.out.includes("3. (unused)"), cm)
    fs.rmSync(path.join(VAULT, "Notes/Qa ws open.md"))

    // The same ids taken in the target (ids are made per device): the moved tab and its pane get new ones.
    writeWs(({ workspaces: [{ layout: L([T("t", "file:Notes/A.md"), T("u", "file:Notes/B.md")]) }, { layout: L([T("t", "file:Notes/Other.md")]) },
      { layout: L([S("w", [P("v", "file:Notes/A.md"), P("w2", "file:Notes/C.md"), P("w3", "file:Notes/D.md")], "v")]) }] }))
    ;[st, body] = await api("POST", "workspaces/move", { from: 1, to: 2, tab: "tt" })
    w = wsNow().workspaces
    check("workspaces move: ids taken in the target get new ones", st === 200 && body.tab.id !== "tt" && body.tab.root.id !== "t" && body.tab.focus === body.tab.root.id &&
      w[1].layout.tabs.map((x: Any) => x.id).join() === `tt,${body.tab.id}`, [st, body, w])
    cm = await vau("workspace", "tabs")
    check("vau workspace tabs: every workspace's tabs and their panes, a split's focused one starred", cm.code === 0 && cm.out.includes("1. Workspace 1") &&
      cm.out.includes("  tu  pane u  Notes/B.md") && cm.out.includes("  tw  split") && cm.out.includes("    * pane v  Notes/A.md") && cm.out.includes("      pane w2  Notes/C.md"), cm)
    cm = await vau("workspace", "tabs", "3", "--json")
    const tj = cm.code === 0 ? JSON.parse(cm.out)[0] : null
    check("vau workspace tabs <n> --json: {workspace, name, tabs: [{id, panes: [{id, to, path}]}], groups, windows}", tj?.workspace === 3 && tj.name === "Workspace 3" &&
      tj.tabs[0].id === "tw" && JSON.stringify(tj.tabs[0].panes[1]) === JSON.stringify({ id: "w2", to: "file:Notes/C.md", path: "Notes/C.md" }) && tj.tabs[0].panes[0].focused &&
      Array.isArray(tj.groups) && tj.windows === 0, cm)
    cm = await vau("workspace", "move", "Notes/A.md", "4")
    check("vau workspace move: a file open in several workspaces needs --from", cm.code === 1 && cm.err.includes("--from"), cm)
    cm = await vau("workspace", "move", "Notes/A.md", "4", "--from", "2")
    check("vau workspace move --from", cm.code === 0 && tos(wsNow().workspaces[3].layout) === "file:Notes/A.md" && !tos(wsNow().workspaces[1].layout).includes("Notes/A.md"), [cm, wsNow()])
    cm = await vau("workspace", "move", "Notes/C.md", "5")
    w = wsNow().workspaces
    check("vau workspace move: a file a split's pane shows moves that pane alone", cm.code === 0 && cm.out.includes("Moved pane w2 from workspace 3 to workspace 5") &&
      desc(w[4].layout) === "w2*" && desc(w[2].layout) === "[v|w3]*", [cm, w])
    cm = await vau("workspace", "move", "Notes/D.md", "4", "--whole")
    w = wsNow().workspaces
    check("vau workspace move --whole: its whole tab; a pane of what's open there already just leaves", cm.code === 0 && cm.out.includes("Moved tab tw") &&
      w[2] === null && tos(w[3].layout) === "file:Notes/A.md,file:Notes/D.md" && w[3].layout.tabs[1].id === "tw", [cm, w])
    cm = await vau("workspace", "move", "tu", "3")
    check("vau workspace move: by tab id", cm.code === 0 && cm.out.includes("from workspace 1 to workspace 3") && wsNow().workspaces[2].layout.tabs.some((x: Any) => x.id === "tu"), cm)
    cm = await vau("workspace", "move", "Nowhere.md", "3")
    check("vau workspace move: a file open nowhere", cm.code === 1 && cm.err.includes("isn't open"), cm)
    cm = await vau("workspace", "--help")
    check("vau workspace --help: tabs and move", cm.code === 0 && cm.out.includes("vau workspace tabs") && cm.out.includes("vau workspace move") && cm.out.includes("--whole"), cm)
    const before = "{\"layout\""
    write(`${WS_DIR}/1.json`, before)
    ;[st] = await api("POST", "workspaces/move", { from: 2, to: 4, tab: "tt" })
    check("workspaces move: an unreadable file (mid-sync) isn't overwritten", st === 409 && read(`${WS_DIR}/1.json`) === before, [st, read(`${WS_DIR}/1.json`)])

    // Closing (POST /api/workspaces/close): a tab or pane by its id, or every pane showing a path, in one workspace or in all.
    writeWs(({ workspaces: [
      { name: "Main", layout: L([S("x", [P("a", "file:Notes/A.md"), P("b", "view:terminal/claude-k3j2")], "b"), T("c", "view:terminal/claude-k3j2")]) },
      { name: "Other", layout: L([T("d", "view:terminal/claude-k3j2"), T("e", "file:Notes/A.md")]) },
    ] }))
    ;[st, body] = await api("POST", "workspaces/close", { path: "view:terminal/claude-k3j2" })
    w = wsNow().workspaces
    check("workspaces close: every pane showing a path, in every workspace; a tab left with none closes, the next shows",
      st === 200 && body.closed.map((x: Any) => `${x.workspace}${x.id}`).join() === "1b,1c,2d" && body.closed[0].tab === "tx" &&
      desc(w[0].layout) === "a*" && w[0].layout.tabs[0].id === "tx" && desc(w[1].layout) === "e*", [st, body, w])
    ;[st, body] = await api("POST", "workspaces/close", { path: "Notes/A.md", from: 2 })
    w = wsNow().workspaces
    check("workspaces close from: only that workspace's; its last tab leaves a blank one",
      st === 200 && tos(w[0].layout) === "file:Notes/A.md" && w[1].layout.tabs.length === 1 && tos(w[1].layout) === "new", [st, w])
    ;[st, body] = await api("POST", "workspaces/close", { tab: "zz" })
    check("workspaces close: a tab open nowhere is a 404", st === 404, [st, body])
    ;[st, body] = await api("POST", "workspaces/close", { tab: "a", path: "Notes/A.md" })
    check("workspaces close: a tab or a path, not both", st === 400, [st, body])
    cm = await vau("workspace", "close", "a")
    check("vau workspace close: by pane id", cm.code === 0 && cm.out.includes("Notes/A.md") && tos(wsNow().workspaces[0].layout) === "new", [cm, wsNow()])
    writeWs(({ workspaces: [{ layout: L([S("x", [P("a", "file:Notes/A.md"), P("b", "file:Notes/B.md")], "a"), T("c", "file:Notes/C.md")]) }] }))
    ;[st, body] = await api("POST", "workspaces/close", { tab: "tx" })
    check("workspaces close: a tab by its id, all its panes", st === 200 && body.closed.map((x: Any) => x.id).join() === "a,b" && desc(wsNow().workspaces[0].layout) === "c*", [st, body, wsNow()])
    writeWs(({ workspaces: [{ layout: L([T("t", "file:Notes/A.md"), T("u", "file:Notes/B.md")]) }, { layout: L([T("t", "file:Notes/B.md"), T("v", "file:Notes/A.md")]) }] }))
    ;[st, body] = await api("POST", "workspaces/close", { tab: "tt" })
    check("workspaces close: a tab id in several workspaces needs from", st === 409 && String(body.error).includes("from"), [st, body])
    cm = await vau("workspace", "close", "Notes/A.md")
    check("vau workspace close: a file closes everywhere", cm.code === 0 && cm.out.includes("2 panes") &&
      !wsNow().workspaces.some((x: Any) => tos(x.layout).includes("file:Notes/A.md")), [cm, wsNow()])

    // Unused is one definition (plugins/core/workspaces/blank.ts): no name, the default sidebars (none of its own, or the
    // same as sidebars.json's) and a lone blank tab. It reads as null, and a write that leaves a slot like that empties it.
    const side = { left: ["files:files"], right: [], collapsed: [], heights: {} }
    write(".vaultite/sidebars.json", JSON.stringify(side))
    writeWs(({ workspaces: [
      { layout: L([T("a", "file:Notes/A.md"), T("b", "file:Notes/B.md")], "tb") },
      { sidebars: side, layout: L([T("n", "new")]) },
      { name: "Named", layout: L([T("n", "new")]) },
      { sidebars: { left: ["terminal:sessions"] } },
    ] }))
    ;[st, body] = await api("GET", "workspaces")
    check("workspaces unused: a lone blank tab with the default sidebars reads as null; a name or its own sidebars is a workspace (read leniently)",
      body.workspaces[0]?.layout && body.workspaces[1] === null && body.workspaces[2]?.name === "Named" &&
      JSON.stringify(body.workspaces[3]?.sidebars) === JSON.stringify({ left: ["terminal:sessions"], right: [], collapsed: [], heights: {} }), body)
    ;[st, body] = await api("PUT", "workspaces/3", { name: null })
    check("workspaces unused: a write that leaves a slot unused empties it (and the others like it)",
      st === 200 && body === null && JSON.stringify(readWs().workspaces.map((x: Any) => !!x)) === "[true,false,false,true]", [body, readWs()])
    ;[st, body] = await api("PUT", "workspaces/5", { layout: L([T("y", "new")]) })
    check("workspaces unused: a blank tab written to an unused slot isn't kept", st === 200 && body === null && readWs().workspaces.length === 4, readWs())
    ;[st, body] = await api("PUT", "workspaces/2", { name: "Fresh" })
    check("workspaces unused: a slot made by a write has no sidebars of its own", st === 200 && body.name === "Fresh" && !("sidebars" in body), body)
    ;[st, body] = await api("PUT", "workspaces/5", { icon: "book-open", tint: "teal", container: "work" })
    const looked = st === 200 && body?.icon === "book-open" && body.tint === "teal" && body.container === "work"
    ;[st, body] = await api("PUT", "workspaces/5", { icon: null, tint: null, container: null })
    check("workspaces unused: an icon, tint or container makes a workspace; without them it's unused again", looked && st === 200 && body === null && readWs().workspaces.length === 4, readWs())
    fs.rmSync(path.join(VAULT, ".vaultite/sidebars.json"))
    clearWs()

    // A workspace's pinned pages (its own list once it changes one: a copy of pages.json's) and state (what the app
    // keeps per workspace). A home page is no longer a thing: an old `home` is dropped on the next write.
    write("Notes/Qa desk a.md", "A\n")
    write("Notes/Qa desk b.md", "B\n")
    const pagesWas = read(".vaultite/pages.json")
    const vaultPins: string[] = conf("pages").pinned
    ;[st, body] = await api("POST", "workspaces/2/pins", { path: "Notes/Qa desk a.md", pinned: true })
    check("workspace pins: the first pin copies the vault's list (pins make the workspace used)", st === 200 &&
      body.pinned.join() === [...vaultPins, "Notes/Qa desk a.md"].join() && readWs().workspaces[1].pinned.join() === body.pinned.join() &&
      read(".vaultite/pages.json") === pagesWas, [body, readWs()])
    ;[st, body] = await api("POST", "workspaces/2/pins", { path: "Notes/Qa desk b.md", pinned: true, before: "Notes/Qa desk a.md" })
    check("workspace pins: before another", st === 200 && body.pinned.slice(-2).join() === "Notes/Qa desk b.md,Notes/Qa desk a.md", body)
    ;[st] = await api("POST", "workspaces/2/pins", { path: "Notes/Nowhere.md", pinned: true })
    check("workspace pins: a file that isn't there is a 404", st === 404)
    ;[st, body] = await api("POST", "workspaces/3/pins", { path: vaultPins[0], pinned: false })
    check("workspace pins: an unpin copies the vault's list too, pages.json untouched", st === 200 && body.pinned.join() === vaultPins.slice(1).join() &&
      wsNow().workspaces[2].pinned.join() === vaultPins.slice(1).join() && read(".vaultite/pages.json") === pagesWas, [body, wsNow()])
    ;[st, body] = await api("POST", "workspaces/3/pins", { path: "Notes/Nowhere.md", pinned: false })
    check("workspace pins: unpinning what isn't there changes nothing", st === 200 && body.pinned.join() === vaultPins.slice(1).join(), body)
    ;[st, body] = await api("POST", "workspaces/3/pins/default", {})
    check("workspace pins: its list for new workspaces (pages.json's)", st === 200 && conf("pages").pinned.join() === vaultPins.slice(1).join(), [body, conf("pages")])
    write(".vaultite/pages.json", pagesWas)
    ;[st] = await api("PUT", "workspaces/3", { pinned: null })
    check("workspace pins: none of its own again (the vault's)", st === 200 && !wsNow().workspaces[2], wsNow())
    ;[st, body] = await api("PUT", "workspaces/2", { state: { "files:open": ["Notes"], "core:recent": ["Notes/Qa desk b.md"] } })
    check("workspaces: state saved", st === 200 && body.state["files:open"][0] === "Notes", body)
    ;[st, body] = await api("PUT", "workspaces/2", { state: { "files:open": null, "graph:depth": 2 } })
    check("workspaces: state merges key by key (null removes one)", st === 200 && !("files:open" in body.state) &&
      body.state["core:recent"][0] === "Notes/Qa desk b.md" && body.state["graph:depth"] === 2, body)
    ;[st, body] = await api("PUT", "workspaces/3", { state: { "files:open": ["Notes"] } })
    check("workspaces: state alone doesn't make a workspace used", st === 200 && body === null && !wsNow().workspaces[2], [body, wsNow()])
    await api("PUT", "workspaces/2", { layout: L([T("1", "file:Notes/Qa desk b.md"), T("2", "view:terminal/qadesk1")]) })
    const tabsOpen = (await import("../../../core/plugins.ts")).service(app.plugins, "tabs:open") as () => string[]
    check("workspaces: every workspace's tabs, for Terminal (tabs:open)", tabsOpen().includes("view:terminal/qadesk1") && tabsOpen().includes("file:Notes/Qa desk b.md"), tabsOpen())
    ;[st] = await api("POST", "file/move", { from: "Notes/Qa desk b.md", to: "Notes/Qa desk moved.md" })
    w = wsNow().workspaces
    check("workspaces: a moved file's pins and tabs follow it", st === 200 && w[1].pinned.slice(-2).join() === "Notes/Qa desk moved.md,Notes/Qa desk a.md" &&
      w[1].layout.tabs[0].root.to === "file:Notes/Qa desk moved.md", w)
    ;[st] = await api("DELETE", "file?path=Notes/Qa desk a.md")
    w = wsNow().workspaces
    check("workspaces: a trashed file's pin goes", st === 200 && w[1].pinned.join() === [...vaultPins, "Notes/Qa desk moved.md"].join(), w)
    cm = await vau("pin", "Notes/Qa desk moved.md", "--workspace", "4")
    check("vau pin --workspace: a copy of the vault's list, with it", cm.code === 0 && cm.out.includes("workspace 4") &&
      wsNow().workspaces[3].pinned.join() === [...vaultPins, "Notes/Qa desk moved.md"].join(), [cm, wsNow()])
    cm = await vau("unpin", "Notes/Qa desk moved.md", "--workspace", "4")
    check("vau unpin --workspace", cm.code === 0 && wsNow().workspaces[3].pinned.join() === vaultPins.join(), [cm, wsNow()])
    cm = await vau("pages", "--workspace", "2")
    check("vau pages --workspace", cm.code === 0 && cm.out.includes("Qa desk moved"), cm)
    const sidebarsWas = exists(".vaultite/sidebars.json") ? read(".vaultite/sidebars.json") : null
    cm = await vau("panels", "hide", "search", "--workspace", "2")
    check("vau panels --workspace: that workspace's panels (the service sidebars:of), sidebars.json untouched", cm.code === 0 && cm.out.startsWith("Workspace 2") &&
      Array.isArray(wsNow().workspaces[1].sidebars?.left) && !wsNow().workspaces[1].sidebars.left.includes("search:search") &&
      (exists(".vaultite/sidebars.json") ? read(".vaultite/sidebars.json") : null) === sidebarsWas, [cm, wsNow().workspaces[1]])
    cm = await vau("workspace", "2")
    check("vau workspace <n>: the window used last switches (the command workspace:<n>)", cm.code === 0 && cm.out === "Sent workspace:2." && uiOf(w2).at(-1)?.id === "workspace:2", [cm, uiOf(w2).at(-1)])
    cm = await vau("workspace", "list", "--json")
    check("vau workspace list", cm.code === 0 && JSON.parse(cm.out).workspaces[1].pinned.length > 0, cm)
    cm = await vau("workspace", "home", "none", "2")
    check("vau workspace home: gone", cm.code !== 0 || !cm.out.includes("blank"), cm)
    fs.rmSync(path.join(VAULT, "Notes/Qa desk moved.md"))
    clearWs()
  }
  // ---------- what's open in a workspace is kept by the server, never in its file ----------
  {
    const file = `${WS_DIR}/3.json`
    let [st] = await api("PUT", "workspaces/3", { name: "Desk", layout: L([T("1", "file:Notes/A.md")]), state: { "files:open": ["Notes"] } })
    const own = JSON.parse(read(file))
    check("workspaces: its file has what the user set, its tabs and state are kept (core/kept.ts)", st === 200 && own.name === "Desk" && !("layout" in own) && !("state" in own) &&
      tos(readWs().workspaces[2].layout) === "file:Notes/A.md" && readWs().workspaces[2].state["files:open"][0] === "Notes", [own, readWs().workspaces[2]])
    const mtime = fs.statSync(path.join(VAULT, file)).mtimeMs
    ;[st] = await api("PUT", "workspaces/3", { layout: L([T("2", "file:Notes/B.md")]) })
    check("workspaces: a tab changed writes nothing into the vault", st === 200 && fs.statSync(path.join(VAULT, file)).mtimeMs === mtime && readWs().workspaces[2].layout.tabs[0].id === "t2")
    // A file from before (or a machine still on the old app) with its tabs in it, in the old shape: taken in, migrated
    // (old tab ids are pane ids, a tab's id "t" and its pane's), and the file keeps the rest.
    write(file, JSON.stringify({ name: "Desk", layout: { root: { id: "g0", tabs: [{ id: "t3", to: "file:Notes/C.md" }], active: "t3" }, focus: "g0" } }))
    const [, got] = await api("GET", "workspaces")
    check("workspaces: a file with tabs in it has them taken in, newer than what was kept", got.workspaces[2]?.layout.tabs[0].id === "tt3" && got.workspaces[2].layout.tabs[0].root.id === "t3" &&
      readWs().workspaces[2].layout.tabs[0].id === "tt3" &&
      JSON.stringify(JSON.parse(read(file))) === JSON.stringify({ name: "Desk" }), [got.workspaces[2], read(file)])
    ;[st] = await api("PUT", "workspaces/3", { name: null })
    check("workspaces: one with only tabs has no file", st === 200 && !exists(file) && readWs().workspaces[2]?.layout.tabs[0].id === "tt3", readWs())
    await api("DELETE", "workspaces/3")
    check("workspaces: deleted, nothing's kept of it", !exists(file) && !readWs().workspaces[2])
    clearWs()
  }
}
