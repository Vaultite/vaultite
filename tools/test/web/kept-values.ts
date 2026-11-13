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
