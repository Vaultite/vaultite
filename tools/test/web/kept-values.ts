import { check, section } from "../lib.ts"
import { isNumber, isObj, isText } from "../../../core/values.ts"
import { type Any, same, web } from "./lib.ts"

await section("live socket messages", async () => {
  const lm: Any = await web("core/liveMessage.ts")
  const hello = lm.liveMessageOf({ type: "hello", v: "v7", web: "abc123", at: "42", kept: "k1", state: 3, paths: ["Notes/A.md"] })
  check("live: a hello's fields read as they came", hello.type === "hello" && hello.v === "v7" && hello.web === "abc123" && hello.at === "42" &&
    hello.kept === "k1" && hello.state === 3 && same(hello.paths, ["Notes/A.md"]), hello)
  check("live: a change to everything (paths null) stays null, not missing", lm.liveMessageOf({ type: "change", v: "v8", paths: null }).paths === null)
  const moved = lm.liveMessageOf({ type: "moved", from: "A.md", to: null })
  check("live: a file trashed (to null) reads as trashed", moved.from === "A.md" && moved.to === null, moved)
  const wrong = lm.liveMessageOf({ type: 3, names: "x", state: "1" })
  check("live: fields of the wrong type read as missing", wrong.type === undefined && wrong.names === undefined && wrong.state === undefined, wrong)
  const action = "open"
  const open = { type: "ui", action, path: "Notes/A.md", split: "right", newTab: true, background: true, container: "work", in: "Home", rid: "r1" }
  const a = lm.uiActionOf(open, open.action)
  check("live: the server's open, as it sends it, reaches the app whole", a.action === "open" && a.path === "Notes/A.md" && a.split === "right" &&
    a.newTab === true && a.background === true && a.container === "work" && a.in === "Home" && a.rid === "r1", a)
  const n = lm.uiActionOf({ type: "ui", action: "notify", text: "Done", kind: null, button: { label: "Open", open: "Notes/A.md" } }, "notify")
  check("live: a notify with its button", n.text === "Done" && n.kind === null && same(n.button, { label: "Open", open: "Notes/A.md" }), n)
  check("live: a command by id", lm.uiActionOf({ type: "ui", action: "command", id: "workspace:2" }, "command").id === "workspace:2")
  const left = { action, path: "A.md", split: "left" }
  check("live: a split that isn't one is left out", lm.uiActionOf(left, left.action).split === undefined)
})

await section("kept values", async () => {
  const h: Any = await web("core/keptEntries.ts")
  const seen = (v: Any) => Array.isArray(v) && v.every((s) => isObj(s) && isNumber(s.w) && isNumber(s.h))
  const old = JSON.parse(JSON.stringify([["Notes/A.md\u0000p3", [{ w: 640, h: 88 }, { w: 320, h: 140 }]], ["Notes/B.md\u0000table", [{ w: 700, h: 24 }]]]))
  check("heights: what a page kept before is read back whole", same(h.keptEntries(old, seen), old))
  check("heights: an entry that isn't one is dropped, the rest kept",
    same(h.keptEntries([["a", [{ w: 1, h: 2 }]], ["b"], [3, []], "c", ["d", [{ w: "1" }]]], seen), [["a", [{ w: 1, h: 2 }]]]))
  check("heights: not a list (nothing kept, or something else) is nothing", same(h.keptEntries(null, seen), []) && same(h.keptEntries({ a: 1 }, seen), []))
  const counts = JSON.parse(JSON.stringify([["Notes/A.md", 12], ["Notes/B.md", 0]]))
  check("heights: kept line counts read back", same(h.keptEntries(counts, isNumber), counts))
  const answers = JSON.parse(JSON.stringify({ vault: "/Users/alice/Vault", answers: [["inbox/list", '{"items":[]}'], ["people/all?x=1", "[1,2]"]] }))
  check("live answers: those kept for a vault read back as [route, JSON]", same(h.keptEntries(answers.answers, isText), answers.answers))
})

await section("kept prefs", async () => {
  const p: Any = await web("core/prefs.ts")
  const old = JSON.parse(JSON.stringify({ theme: "dark", scheme: "nord", density: "comfortable", animation: "snappy", sidebar: false, sidebarWidth: 312,
    disabled: ["vim"], statusBar: null, statusBarLeft: ["core:words"], fileSort: "modified-old", folderView: "gallery", updates: "all", translucency: 35,
    sidebars: { left: ["files:files", "search:search"], right: ["outline:outline"], collapsed: ["search:search"], heights: { "files:files": 300 } },
    newTab: { sections: ["recent"], actions: null, icons: null, page: null, opens: null }, device: { "textSize:note": 110, workspace: 2 }, editor: { tabSize: 2 },
    panes: { old: true }, sidebarPanels: ["files"] }))
  const read = p.readPrefs(old)
  const kept = ["theme", "scheme", "density", "animation", "sidebar", "sidebarWidth", "disabled", "statusBar", "statusBarLeft", "fileSort", "folderView", "updates",
    "translucency", "sidebars", "newTab", "device", "editor"]
  check("prefs: what a device kept before reads back as it was", kept.every((k) => same(read[k], old[k])), kept.filter((k) => !same(read[k], old[k])))
  check("prefs: what's no longer a pref is left out, the rest are defaults", !("panes" in read) && !("sidebarPanels" in read) && read.ai === true && read.folderLimit === 0)
  const wrong = p.readPrefs({ theme: "sepia", sidebarWidth: "wide", disabled: [1], statusBar: "x", device: [], sidebars: [], fileSort: 3, ai: "yes", newTab: "recent" })
  check("prefs: a kept value that isn't one is the default", wrong.theme === "system" && wrong.sidebarWidth === 240 && same(wrong.disabled, []) && wrong.statusBar === null
    && same(wrong.device, {}) && wrong.sidebars === null && wrong.fileSort === "name" && wrong.ai === true && wrong.newTab.sections === null, wrong)
  check("prefs: nothing kept, or not an object, is the defaults", same(p.readPrefs(null), p.readPrefs({})) && p.readPrefs([]).theme === "system")
})

await section("prefs from the vault's settings", async () => {
  const p: Any = await web("core/prefs.ts")
  p.hydratePrefs({ appearance: { theme: "light", density: "nope" }, plugins: { ai: false, updates: "off" }, files: { folderLimit: 50 } }, { files: { showHidden: true } })
  const h = p.getPrefs()
  check("prefs: the vault's settings fill what they set (seeds under them), defaults what they don't or got wrong",
    h.theme === "light" && h.density === "compact" && h.ai === false && h.updates === "off" && h.folderLimit === 50 && h.showHidden === true, h)
})

await section("kept places", async () => {
  const g: Any = globalThis, was = g.localStorage, listen = g.addEventListener
  g.addEventListener = () => {}
  const places = [["file:a.md", { y: 120, props: true, at: [3, 4] }], ["file:b.md", { line: 7, into: 0.25 }], ["file:c.md", { y: "far" }], ["file:d.md", { at: [1] }]]
  g.localStorage = { getItem: (k: string) => (k === "vaultite.places" ? JSON.stringify({ vault: "", places }) : null), setItem() {}, removeItem() {} }
  const v: Any = await web("core/viewstate.ts")
  check("places: those kept read back", v.scrollOf("file:a.md") === 120 && v.propsOpen("a.md") === true && same(v.cursorOf("a.md"), [3, 4]))
  check("places: one that isn't is dropped", v.scrollOf("file:c.md") === 0 && v.cursorOf("d.md") === null)
  g.localStorage = was
  g.addEventListener = listen
})
