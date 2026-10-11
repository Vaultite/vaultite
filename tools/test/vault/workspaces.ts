import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, WS_DIR, api, app, check, clearWs, exists, read, readWs, write, writeWs } = $
  const { vau, conf, w2, uiOf } = $.vars
  // ---------- workspaces (plugins/core/workspaces): a file per workspace ----------
  {
    let [st, body] = await api("GET", "workspaces")
    check("workspaces: none yet", st === 200 && Array.isArray(body.workspaces) && !body.workspaces.length, body)
    ;[st, body] = await api("PUT", "workspaces/2", { sidebars: { left: ["terminal:sessions"], right: [], collapsed: [], heights: {} }, name: "Shells" })
    check("workspaces: a slot is made, the ones before it empty", st === 200 && body.name === "Shells" &&
      JSON.stringify(readWs().workspaces.map((w: Any) => w && w.name)) === JSON.stringify([null, "Shells"]), readWs())
    ;[st, body] = await api("PUT", "workspaces/2", { layout: { root: { id: "g0", tabs: [{ id: "t1", to: "file:Mac.md" }], active: "t1" }, focus: "g0" }, name: null })
    check("workspaces: keys merge, null removes one", st === 200 && body.sidebars.left[0] === "terminal:sessions" && body.layout.focus === "g0" && !("name" in body), body)
    ;[st] = await api("PUT", "workspaces/6", { name: "Six" })
    check("workspaces: only 1 to 5", st === 400)
    const s2 = (await api("GET", "state"))[1]
    check("workspaces: in /api/state", s2.workspaces?.[1]?.sidebars?.left[0] === "terminal:sessions", s2.workspaces)
    ;[st] = await api("DELETE", "workspaces/2")
    check("workspaces: deleting empties the slot (trailing empties dropped)", st === 200 && readWs().workspaces.length === 0, readWs())
    // Two devices: a phone writes slot 1 while the file on disk already has another device's slot 2 (written behind the
    // server's back): the write goes into the file as it is then, and slot 2 stays.
    writeWs(({ workspaces: [null, { layout: { root: { id: "g0", tabs: [{ id: "t9", to: "file:Mac.md" }], active: "t9" }, focus: "g0" } }], other: 1 }))
    ;[st] = await api("PUT", "workspaces/1", { layout: { root: { id: "g0", tabs: [{ id: "t1", to: "file:Phone.md" }], active: "t1" }, focus: "g0" } })
    const both = readWs()
    check("workspaces: a write to one slot keeps another device's slot and other keys", st === 200 &&
      both.workspaces[0].layout.root.tabs[0].to === "file:Phone.md" && both.workspaces[1].layout.root.tabs[0].to === "file:Mac.md" && both.other === 1, both)
    write(`${WS_DIR}/1.json`, "{\"layout\": {")
    ;[st] = await api("PUT", "workspaces/1", { name: "Half" })
    check("workspaces: an unreadable file (mid-sync) isn't overwritten", st === 409 && read(`${WS_DIR}/1.json`) === "{\"layout\": {", [st, read(`${WS_DIR}/1.json`)])
    clearWs()
    const cw = await vau("workspace")
    check("vau workspace: lists them", cw.code === 0 && cw.out.includes("no workspaces yet"), cw)

    // Moving a tab to another workspace (POST /api/workspaces/move): out of its pane, onto the end of the target's
    // focused pane, applied to the file as it is.
    const g = (id: string, tabs: [string, string][], active = tabs[0]?.[0]) => ({ id, tabs: tabs.map(([i, to]) => ({ id: i, to })), active })
    writeWs(({ workspaces: [
      { name: "Main", layout: { root: { id: "s1", dir: "row", sizes: [0.5, 0.5], kids: [
        g("g0", [["a", "file:Notes/A.md"], ["b", "file:Notes/B.md"]], "b"), g("g1", [["c", "view:terminal/abc"]])] }, focus: "g1" } },
      { sidebars: { left: ["terminal:sessions"], right: [], collapsed: [], heights: {} }, layout: { root: { id: "s2", dir: "col", sizes: [0.5, 0.5], kids: [
        g("h0", [["x", "file:Notes/X.md"]]), g("h1", [["y", "file:Notes/Y.md"]])] }, focus: "h1" } },
      null,
      { layout: { root: g("k0", [["n", "new"]]), focus: "k0" } },
    ], other: 1 }))
    const wsNow = readWs
    ;[st, body] = await api("POST", "workspaces/move", { from: 1, to: 2, tab: "b" })
    let w = wsNow().workspaces
    check("workspaces move: the tab leaves its pane (the next one shown) and ends the target's focused pane, not shown there",
      st === 200 && body.from === 1 && body.to === 2 && body.tab.id === "b" &&
      JSON.stringify(w[0].layout.root.kids[0]) === JSON.stringify(g("g0", [["a", "file:Notes/A.md"]])) &&
      JSON.stringify(w[1].layout.root.kids[1]) === JSON.stringify(g("h1", [["y", "file:Notes/Y.md"], ["b", "file:Notes/B.md"]], "y")) &&
      w[1].layout.focus === "h1" && w[1].sidebars.left[0] === "terminal:sessions" && wsNow().other === 1 && body.workspaces[1].layout.root.kids[1].tabs.length === 2, [st, body, w])
    ;[st, body] = await api("POST", "workspaces/move", { to: 3, path: "view:terminal/abc" })
    w = wsNow().workspaces
    check("workspaces move: a pane's last tab closes the pane; an empty target is made with that tab (no sidebars of its own)",
      st === 200 && body.from === 1 && JSON.stringify(w[0].layout.root) === JSON.stringify(g("g0", [["a", "file:Notes/A.md"]])) && w[0].layout.focus === "g0" &&
      JSON.stringify(w[2].layout.root) === JSON.stringify(g("g0", [["c", "view:terminal/abc"]])) && !("sidebars" in w[2]), [st, body, w])
    ;[st, body] = await api("POST", "workspaces/move", { from: 1, to: 4, path: "Notes/A.md" })
    w = wsNow().workspaces
    check("workspaces move: a workspace's only tab leaves a blank one (kept: it's named); an unused target (a lone blank tab) gets the tab in its place",
      st === 200 && w[0].name === "Main" && w[0].layout.root.tabs.length === 1 && w[0].layout.root.tabs[0].to === "new" && w[0].layout.root.active === w[0].layout.root.tabs[0].id &&
      JSON.stringify(w[3].layout.root) === JSON.stringify(g("g0", [["a", "file:Notes/A.md"]])), [st, w])
    ;[st, body] = await api("POST", "workspaces/move", { to: 2, path: "Notes/A.md", from: 1 })
    check("workspaces move: a tab that isn't there is a 404", st === 404, [st, body])
    ;[st, body] = await api("POST", "workspaces/move", { to: 4, tab: "a" })
    check("workspaces move: onto its own workspace is refused", st === 400, [st, body])
    ;[st, body] = await api("POST", "workspaces/move", { to: 7, tab: "a" })
    check("workspaces move: only 1 to 5", st === 400, [st, body])
    // The same id taken in the target (ids are made per device): the moved tab gets a new one.
    writeWs(({ workspaces: [{ layout: { root: g("g0", [["t", "file:Notes/A.md"], ["u", "file:Notes/B.md"]]), focus: "g0" } },
      { layout: { root: g("g0", [["t", "file:Notes/Other.md"]]), focus: "g0" } }, { layout: { root: g("g0", [["v", "file:Notes/A.md"]]), focus: "g0" } }] }))
    ;[st, body] = await api("POST", "workspaces/move", { from: 1, to: 2, tab: "t" })
    w = wsNow().workspaces
    check("workspaces move: an id taken in the target gets a new one", st === 200 && body.tab.id !== "t" && w[1].layout.root.tabs.map((x: Any) => x.id).join() === `t,${body.tab.id}`, [st, body, w])
    let cm = await vau("workspace", "tabs")
    check("vau workspace tabs: every workspace's panes and tabs", cm.code === 0 && cm.out.includes("1. Workspace 1") && cm.out.includes("    u  Notes/B.md") && cm.out.includes("  pane 1 *"), cm)
    cm = await vau("workspace", "tabs", "3", "--json")
    check("vau workspace tabs <n> --json", cm.code === 0 && JSON.parse(cm.out)[0].panes[0].tabs[0].path === "Notes/A.md", cm)
    cm = await vau("workspace", "move", "Notes/A.md", "4")
    check("vau workspace move: a file open in several workspaces needs --from", cm.code === 1 && cm.err.includes("--from"), cm)
    cm = await vau("workspace", "move", "Notes/A.md", "4", "--from", "2")
    check("vau workspace move --from", cm.code === 0 && wsNow().workspaces[3].layout.root.tabs[0].to === "file:Notes/A.md" && !wsNow().workspaces[1].layout.root.tabs.some((x: Any) => x.to === "file:Notes/A.md"), [cm, wsNow()])
    cm = await vau("workspace", "move", "u", "3")
    check("vau workspace move: by tab id", cm.code === 0 && cm.out.includes("from workspace 1 to workspace 3") && wsNow().workspaces[2].layout.root.tabs.some((x: Any) => x.id === "u"), cm)
    cm = await vau("workspace", "move", "Nowhere.md", "3")
    check("vau workspace move: a file open nowhere", cm.code === 1 && cm.err.includes("isn't open"), cm)
    cm = await vau("workspace", "--help")
    check("vau workspace --help: tabs and move", cm.code === 0 && cm.out.includes("vau workspace tabs") && cm.out.includes("vau workspace move"), cm)
    const before = "{\"layout\""
    write(`${WS_DIR}/1.json`, before)
    ;[st] = await api("POST", "workspaces/move", { from: 1, to: 2, tab: "t" })
    check("workspaces move: an unreadable file (mid-sync) isn't overwritten", st === 409 && read(`${WS_DIR}/1.json`) === before, [st, read(`${WS_DIR}/1.json`)])

    // Closing tabs (POST /api/workspaces/close): one by its id, or every tab showing a path, in one workspace or in all.
    writeWs(({ workspaces: [
      { name: "Main", layout: { root: { id: "s1", dir: "row", sizes: [0.5, 0.5], kids: [
        g("g0", [["a", "file:Notes/A.md"], ["b", "view:terminal/claude-k3j2"]], "b"), g("g1", [["c", "view:terminal/claude-k3j2"]])] }, focus: "g1" } },
      { name: "Other", layout: { root: g("h0", [["d", "view:terminal/claude-k3j2"], ["e", "file:Notes/A.md"]]), focus: "h0" } },
    ] }))
    ;[st, body] = await api("POST", "workspaces/close", { path: "view:terminal/claude-k3j2" })
    w = wsNow().workspaces
    check("workspaces close: every tab showing a path, in every workspace; a pane left with none closes, the next tab shows",
      st === 200 && body.closed.map((x: Any) => `${x.workspace}${x.id}`).join() === "1b,1c,2d" &&
      JSON.stringify(w[0].layout.root) === JSON.stringify(g("g0", [["a", "file:Notes/A.md"]])) && w[0].layout.focus === "g0" &&
      JSON.stringify(w[1].layout.root) === JSON.stringify(g("h0", [["e", "file:Notes/A.md"]])), [st, body, w])
    ;[st, body] = await api("POST", "workspaces/close", { path: "Notes/A.md", from: 2 })
    w = wsNow().workspaces
    check("workspaces close from: only that workspace's; its last tab leaves a blank one",
      st === 200 && w[0].layout.root.tabs[0].to === "file:Notes/A.md" && w[1].layout.root.tabs.length === 1 && w[1].layout.root.tabs[0].to === "new", [st, w])
    ;[st, body] = await api("POST", "workspaces/close", { tab: "zz" })
    check("workspaces close: a tab open nowhere is a 404", st === 404, [st, body])
    ;[st, body] = await api("POST", "workspaces/close", { tab: "a", path: "Notes/A.md" })
    check("workspaces close: a tab or a path, not both", st === 400, [st, body])
    cm = await vau("workspace", "close", "a")
    check("vau workspace close: by tab id", cm.code === 0 && cm.out.includes("Notes/A.md") && wsNow().workspaces[0].layout.root.tabs[0].to === "new", [cm, wsNow()])
    writeWs(({ workspaces: [{ layout: { root: g("g0", [["t", "file:Notes/A.md"], ["u", "file:Notes/B.md"]]), focus: "g0" } },
      { layout: { root: g("g0", [["t", "file:Notes/B.md"], ["v", "file:Notes/A.md"]]), focus: "g0" } }] }))
    ;[st, body] = await api("POST", "workspaces/close", { tab: "t" })
    check("workspaces close: a tab id in several workspaces needs from", st === 409 && String(body.error).includes("from"), [st, body])
    cm = await vau("workspace", "close", "Notes/A.md")
    check("vau workspace close: a file closes everywhere", cm.code === 0 && cm.out.includes("2 tabs") &&
      !wsNow().workspaces.some((x: Any) => x.layout.root.tabs.some((t: Any) => t.to === "file:Notes/A.md")), [cm, wsNow()])

    // Unused is one definition (plugins/core/workspaces/blank.ts): no name, the default sidebars (none of its own, or the
    // same as sidebars.json's) and a lone blank tab. It reads as null, and a write that leaves a slot like that empties it.
    const side = { left: ["files:files"], right: [], collapsed: [], heights: {} }
    write(".vaultite/sidebars.json", JSON.stringify(side))
    writeWs(({ workspaces: [
      { layout: { root: g("g0", [["a", "file:Notes/A.md"], ["b", "file:Notes/B.md"]], "b"), focus: "g0" } },
      { sidebars: side, layout: { root: g("k0", [["n", "new"]]), focus: "k0" } },
      { name: "Named", layout: { root: g("k0", [["n", "new"]]), focus: "k0" } },
      { sidebars: { left: ["terminal:sessions"] } },
    ] }))
    ;[st, body] = await api("GET", "workspaces")
    check("workspaces unused: a lone blank tab with the default sidebars reads as null; a name or its own sidebars is a workspace (read leniently)",
      body.workspaces[0]?.layout && body.workspaces[1] === null && body.workspaces[2]?.name === "Named" &&
      JSON.stringify(body.workspaces[3]?.sidebars) === JSON.stringify({ left: ["terminal:sessions"], right: [], collapsed: [], heights: {} }), body)
    ;[st, body] = await api("PUT", "workspaces/3", { name: null })
    check("workspaces unused: a write that leaves a slot unused empties it (and the others like it)",
      st === 200 && body === null && JSON.stringify(readWs().workspaces.map((x: Any) => !!x)) === "[true,false,false,true]", [body, readWs()])
    ;[st, body] = await api("PUT", "workspaces/5", { layout: { root: g("x", [["y", "new"]]), focus: "x" } })
    check("workspaces unused: a blank tab written to an unused slot isn't kept", st === 200 && body === null && readWs().workspaces.length === 4, readWs())
    ;[st, body] = await api("PUT", "workspaces/2", { name: "Fresh" })
    check("workspaces unused: a slot made by a write has no sidebars of its own", st === 200 && body.name === "Fresh" && !("sidebars" in body), body)
    fs.rmSync(path.join(VAULT, ".vaultite/sidebars.json"))

    // A whole pane moved (`group`): it leaves as its tabs would, and becomes a pane of its own on the right of the target's.
    writeWs(({ workspaces: [
      { layout: { root: { id: "s1", dir: "row", sizes: [0.5, 0.5], kids: [g("g0", [["a", "file:Notes/A.md"], ["b", "file:Notes/B.md"]], "b"), g("g1", [["c", "view:terminal/abc"]])] }, focus: "g1" } },
      { name: "Two", layout: { root: g("g0", [["x", "file:Notes/X.md"]]), focus: "g0" } },
    ] }))
    ;[st, body] = await api("POST", "workspaces/move", { from: 1, to: 2, group: "g0" })
    w = wsNow().workspaces
    check("workspaces move pane: its tabs leave together (the pane closes; the focus stays on the other)",
      st === 200 && JSON.stringify(w[0].layout.root) === JSON.stringify(g("g1", [["c", "view:terminal/abc"]])) && w[0].layout.focus === "g1", [st, body, w])
    check("workspaces move pane: a pane of its own on the right of the target's (a new id where its own is taken), shown tab kept, focus unchanged",
      w[1].layout.root.dir === "row" && w[1].layout.root.kids.length === 2 && JSON.stringify(w[1].layout.root.sizes) === "[0.5,0.5]" &&
      w[1].layout.root.kids[0].id === "g0" && body.group !== "g0" && w[1].layout.root.kids[1].id === body.group &&
      w[1].layout.root.kids[1].tabs.map((x: Any) => x.id).join() === "a,b" && w[1].layout.root.kids[1].active === "b" && w[1].layout.focus === "g0" &&
      body.tabs.length === 2, [body, w])
    ;[st, body] = await api("POST", "workspaces/move", { to: 2, group: "g1" })
    w = wsNow().workspaces
    check("workspaces move pane: a workspace's last pane leaves it unused (null); the target's row gets a third, evenly",
      st === 200 && w[0] === null && w[1].layout.root.kids.length === 3 && w[1].layout.root.sizes.every((x: number) => Math.abs(x - 1 / 3) < 1e-9), [st, w])
    ;[st, body] = await api("POST", "workspaces/move", { from: 2, to: 4, group: "g1" })
    w = wsNow().workspaces
    check("workspaces move pane: into an unused workspace it's the whole layout", st === 200 && JSON.stringify(w[3].layout.root) === JSON.stringify(g("g1", [["c", "view:terminal/abc"]])) && w[3].layout.focus === "g1", [st, w])
    ;[st] = await api("POST", "workspaces/move", { from: 2, to: 3, group: "nope" })
    check("workspaces move pane: a pane that isn't there is a 404", st === 404)
    ;[st] = await api("POST", "workspaces/move", { from: 2, to: 3, group: "g0", tab: "x" })
    check("workspaces move: one thing at a time", st === 400)

    // Files opened in another workspace (`open`: a file dragged from the tree onto a number): new tabs at the end of its
    // pane focused last, not shown; one already open there is left alone.
    write("Notes/Qa ws open.md", "Opened elsewhere.\n")
    ;[st, body] = await api("POST", "workspaces/move", { to: 4, open: ["Notes/Qa ws open.md"] })
    w = wsNow().workspaces
    check("workspaces open: a new tab at the end of the focused pane, not shown", st === 200 && body.tabs.length === 1 &&
      w[3].layout.root.tabs.map((x: Any) => x.to).join() === "view:terminal/abc,file:Notes/Qa ws open.md" && w[3].layout.root.active === "c", [body, w])
    ;[st, body] = await api("POST", "workspaces/move", { to: 4, open: "Notes/Qa ws open.md" })
    check("workspaces open: already open there: nothing changes", st === 200 && !body.tabs.length && wsNow().workspaces[3].layout.root.tabs.length === 2, [body, wsNow()])
    ;[st, body] = await api("POST", "workspaces/move", { to: 5, open: ["Notes/Qa ws open.md"] })
    check("workspaces open: an unused workspace gets it as its only tab", st === 200 && wsNow().workspaces[4].layout.root.tabs.map((x: Any) => x.to).join() === "file:Notes/Qa ws open.md", wsNow())
    ;[st] = await api("POST", "workspaces/move", { to: 5, open: ["Notes/Nowhere.md"] })
    check("workspaces open: a file that isn't there is a 404", st === 404)
    cm = await vau("workspace", "open", "Notes/Qa ws open.md", "1")
    check("vau workspace open", cm.code === 0 && cm.out.includes("Opened") && wsNow().workspaces[0].layout.root.tabs[0].to === "file:Notes/Qa ws open.md", [cm, wsNow()])
    cm = await vau("workspace", "move", "Notes/Qa ws open.md", "3", "--from", "4", "--pane")
    check("vau workspace move --pane: the whole pane that has it", cm.code === 0 && cm.out.includes("2 tabs") &&
      wsNow().workspaces[3] === null && wsNow().workspaces[2].layout.root.tabs.length === 2, [cm, wsNow()])
    cm = await vau("workspace")
    check("vau workspace: unused ones say so", cm.code === 0 && cm.out.includes("4. (unused)"), cm)
    fs.rmSync(path.join(VAULT, "Notes/Qa ws open.md"))
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
    await api("PUT", "workspaces/2", { layout: { root: { id: "g0", tabs: [{ id: "t1", to: "file:Notes/Qa desk b.md" }, { id: "t2", to: "view:terminal/qadesk1" }], active: "t1" }, focus: "g0" } })
    const tabsOpen = (await import("../../../core/plugins.ts")).service(app.plugins, "tabs:open") as () => string[]
    check("workspaces: every workspace's tabs, for Terminal (tabs:open)", tabsOpen().includes("view:terminal/qadesk1") && tabsOpen().includes("file:Notes/Qa desk b.md"), tabsOpen())
    ;[st] = await api("POST", "file/move", { from: "Notes/Qa desk b.md", to: "Notes/Qa desk moved.md" })
    w = wsNow().workspaces
    check("workspaces: a moved file's pins and tabs follow it", st === 200 && w[1].pinned.slice(-2).join() === "Notes/Qa desk moved.md,Notes/Qa desk a.md" &&
      w[1].layout.root.tabs[0].to === "file:Notes/Qa desk moved.md", w)
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
}
