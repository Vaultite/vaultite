import fs from "node:fs"
import path from "node:path"
import { fromBase64, toBase64 } from "lib0/buffer"
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness"
import * as Y from "yjs"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  // Typing together (plugins/core/companion/rooms.ts): a Y.Doc per open note, written back a person at a time.
  const { check, read, write, VAULT } = $
  const { LOADED } = await import("../../../core/plugins.ts")
  const { rooms } = await import("../../../plugins/core/companion/rooms.ts")
  const companion = LOADED.find((p) => p.id === "companion")!
  const co = rooms(companion)
  write("Co/N.md", "# N\n\nfirst line\n")
  await $.vault.sync()

  /** A window: its socket (what it was sent) and its own copy of the note. */
  function win(name: string, peer: Any) {
    const got: Any[] = [], on: Record<string, () => void> = {}
    const ws = { readyState: 1, OPEN: 1, send: (t: string) => { const m = JSON.parse(t); got.push(m); if (m.t === "y-state" || m.t === "y") Y.applyUpdate(doc, fromBase64(m.u), "server") }, on: (e: string, fn: () => void) => { on[e] = fn } } as Any
    const doc = new Y.Doc(), aw = new Awareness(doc)
    doc.on("update", (u: Uint8Array, origin: unknown) => { if (origin !== "server") co.heard(ws, { t: "y", path: "Co/N.md", u: toBase64(u) }, "Co/N.md") })
    co.add(ws, { name, tint: "blue", edits: true, see: (r: string) => r, ...peer })
    return { ws, got, doc, aw, text: doc.getText("md"), close: () => on.close?.() }
  }
  const you = { client: "app/web", agent: null, label: "You", source: "app" }, guestWho = { client: "guest", agent: "Ada", label: "Ada (guest)", source: "guest" }
  const owner = win("Lucas", { who: you })
  const ada = win("Ada", { who: guestWho, may: (_rel: string, _b: string, after: string) => (after.includes("![") ? "no images" : "") })
  const rex = win("Rex", { who: { ...guestWho, agent: "Rex" }, edits: false })
  for (const w of [owner, ada, rex]) co.heard(w.ws, { t: "y-open", path: "Co/N.md" }, "Co/N.md")
  await $.sleep(100)
  check("cotype: each window hears how many others are in the note", owner.got.filter((m) => m.t === "y-peers").at(-1)?.others === 2)
  check("cotype: each window gets the note as the file has it", [owner, ada, rex].every((w) => w.text.toString() === "# N\n\nfirst line\n"))

  owner.text.insert(owner.text.length, "owner's line\n")
  ada.text.insert(owner.text.toString().indexOf("first line") + 10, " (Ada)")
  await $.sleep(1200)
  const disk = read("Co/N.md")
  check("cotype: what each types reaches the others and the file", disk.includes("owner's line") && disk.includes("first line (Ada)") && rex.text.toString() === owner.text.toString() && ada.text.toString() === owner.text.toString(), [disk, rex.text.toString()])
  const blame = (await $.app.callOp("provenance.blame", { path: "Co/N.md" })).result as Any
  check("cotype: written a person at a time, so a guest's line is theirs", blame.runs.some((r: Any) => r.by === "Ada" && r.guest && r.text.includes("(Ada)")) && !blame.runs.some((r: Any) => r.text.includes("owner's line")), blame.runs)

  const before = read("Co/N.md")
  ada.text.insert(0, "![x](https://example.com/p.png)\n")
  rex.text.insert(0, "REX\n")
  await $.sleep(800)
  check("cotype: a guest's change the share's rules refuse, or a reader's, doesn't land (and is said back)", read("Co/N.md") === before && !owner.text.toString().includes("example.com") && !owner.text.toString().includes("REX")
    && ada.got.some((m) => m.t === "y-reject" && m.why === "no images") && rex.got.some((m) => m.t === "y-reject"), owner.text.toString())

  fs.writeFileSync(path.join(VAULT, "Co/N.md"), read("Co/N.md") + "an agent's line\n")
  co.changed(["Co/N.md"])
  await $.sleep(300)
  check("cotype: what changes on disk comes into the open note, for everyone", owner.text.toString().includes("an agent's line") && rex.text.toString().includes("an agent's line"))

  // Who's where: each one's caret, named and coloured by the server, never as someone else.
  ada.aw.setLocalState({ user: { name: "Lucas", color: "red" }, cursor: { anchor: 1, head: 1 } })
  co.heard(ada.ws, { t: "aw", path: "Co/N.md", u: toBase64(encodeAwarenessUpdate(ada.aw, [ada.doc.clientID])) }, "Co/N.md")
  const seen = new Awareness(new Y.Doc())
  for (const m of owner.got.filter((x) => x.t === "aw")) applyAwarenessUpdate(seen, fromBase64(m.u), "server")
  check("cotype: a caret is named as the server knows its window, whatever it says", (seen.getStates().get(ada.doc.clientID) as Any)?.user?.name === "Ada")
  const spoof = new Awareness(new Y.Doc())
  spoof.clientID = ada.doc.clientID
  spoof.setLocalState({ cursor: null })
  const n = rex.got.length
  co.heard(owner.ws, { t: "aw", path: "Co/N.md", u: toBase64(encodeAwarenessUpdate(spoof, [ada.doc.clientID])) }, "Co/N.md")
  check("cotype: nor can a window speak for another's caret", !rex.got.slice(n).some((m) => m.t === "aw"))

  {
    // A guest's change that waits on what isn't there yet (an item after the owner's next one) never lands: else the
    // owner's next keystroke would bring it in, written as theirs.
    const sneaky = new Y.Doc()
    Y.applyUpdate(sneaky, Y.encodeStateAsUpdate(owner.doc))
    const future = new Y.Doc()
    future.clientID = owner.doc.clientID
    Y.applyUpdate(future, Y.encodeStateAsUpdate(owner.doc))
    future.getText("md").insert(0, "x")
    Y.applyUpdate(sneaky, Y.encodeStateAsUpdate(future))
    const sv = Y.encodeStateVector(sneaky)
    sneaky.getText("md").insert(1, "<img src=https://example.com/p.png>")
    const theirs = Y.encodeStateAsUpdate(sneaky, sv)
    const n = ada.got.length
    co.heard(ada.ws, { t: "y", path: "Co/N.md", u: toBase64(theirs) }, "Co/N.md")
    const junk = new Y.Doc()
    Y.applyUpdate(junk, Y.encodeStateAsUpdate(owner.doc))
    const jsv = Y.encodeStateVector(junk)
    junk.getMap("junk").set("k", "v".repeat(1000))
    co.heard(ada.ws, { t: "y", path: "Co/N.md", u: toBase64(Y.encodeStateAsUpdate(junk, jsv)) }, "Co/N.md")
    await $.sleep(400)
    owner.text.insert(0, "y")
    await $.sleep(1000)
    check("cotype: a guest's change waiting on another's next, or beside the note's text, is refused, and stays out", !read("Co/N.md").includes("example.com") && !owner.text.toString().includes("example.com")
      && ada.got.slice(n).filter((m) => m.t === "y-reject").length >= 1, read("Co/N.md"))
  }
  {
    // Typing and a change on disk in the same line: the typing stays, the file comes to it, the windows hear so.
    const line = owner.text.toString().split("\n").find((l) => l.startsWith("first line"))!
    owner.text.insert(owner.text.toString().indexOf(line) + line.length, " typed")
    fs.writeFileSync(path.join(VAULT, "Co/N.md"), read("Co/N.md").replace(line, `${line} from disk`))
    co.changed(["Co/N.md"])
    await $.sleep(1200)
    check("cotype: where typing and the disk clash, the typing stays and is written", owner.text.toString().includes(`${line} typed`) && read("Co/N.md").includes(`${line} typed`)
      && owner.got.some((m) => m.t === "y-clash") && ada.got.some((m) => m.t === "y-clash"), read("Co/N.md"))
  }
  {
    // Carets: two at most per window, each as y-codemirror gives one; opens and carets a window may send are counted.
    const many = new Awareness(new Y.Doc()), more = new Awareness(new Y.Doc()), most = new Awareness(new Y.Doc())
    for (const a of [many, more, most]) a.setLocalState({ cursor: null })
    const all = Y.mergeUpdates([]) && encodeAwarenessUpdate(many, [many.clientID])
    const n = owner.got.length
    co.heard(ada.ws, { t: "aw", path: "Co/N.md", u: toBase64(all) }, "Co/N.md")
    co.heard(ada.ws, { t: "aw", path: "Co/N.md", u: toBase64(encodeAwarenessUpdate(more, [more.clientID])) }, "Co/N.md")
    co.heard(ada.ws, { t: "aw", path: "Co/N.md", u: toBase64(encodeAwarenessUpdate(most, [most.clientID])) }, "Co/N.md")
    check("cotype: a window has two carets at most", owner.got.slice(n).filter((m) => m.t === "aw").length === 1)
    ada.aw.setLocalState({ cursor: { anchor: {}, head: { evil: true } } })
    const m = owner.got.length
    co.heard(ada.ws, { t: "aw", path: "Co/N.md", u: toBase64(encodeAwarenessUpdate(ada.aw, [ada.doc.clientID])) }, "Co/N.md")
    const seen2 = new Awareness(new Y.Doc())
    for (const x of owner.got.slice(m).filter((x) => x.t === "aw")) applyAwarenessUpdate(seen2, fromBase64(x.u), "server")
    check("cotype: a caret that isn't one is passed on as none", (seen2.getStates().get(ada.doc.clientID) as Any)?.cursor === null, owner.got.slice(m))
    const k = ada.got.length
    for (let i = 0; i < 40; i++) co.heard(ada.ws, { t: "y-open", path: "Co/N.md" }, "Co/N.md")
    await $.sleep(200)
    check("cotype: a window opens a note again only so often", ada.got.slice(k).filter((x) => x.t === "y-state").length <= 30)
  }
  {
    // Only text in the note's text: an embed (which no editor shows) is refused, and so are another window's Yjs ids.
    const n = ada.got.length
    ada.text.insertEmbed(2, { big: "x".repeat(1000) })
    await $.sleep(400)
    check("cotype: a guest's embed in the text is refused", ada.got.slice(n).some((m) => m.t === "y-reject") && !owner.text.toDelta().some((d: Any) => typeof d.insert !== "string"))
    const twin = new Y.Doc()
    Y.applyUpdate(twin, Y.encodeStateAsUpdate(owner.doc))
    twin.clientID = owner.doc.clientID // (after: Yjs gives a doc a new id when it hears its own from elsewhere)
    const sv = Y.encodeStateVector(twin)
    twin.getText("md").insert(0, "as the owner ")
    const k = ada.got.length
    co.heard(ada.ws, { t: "y", path: "Co/N.md", u: toBase64(Y.encodeStateAsUpdate(twin, sv)) }, "Co/N.md")
    await $.sleep(400)
    check("cotype: nor writes under another window's Yjs id", ada.got.slice(k).some((m) => m.t === "y-reject") && !owner.text.toString().includes("as the owner"), [ada.got.slice(k).map((m) => m.t), owner.text.toString().slice(0, 40)])
  }
  {
    // Many Yjs ids at one spot (Yjs would take long to place them): refused before they're placed.
    const base = Y.encodeStateAsUpdate(owner.doc), parts: Uint8Array[] = []
    for (let i = 0; i < 50; i++) {
      const d = new Y.Doc()
      Y.applyUpdate(d, base)
      const sv = Y.encodeStateVector(d)
      d.getText("md").insert(1, "z")
      parts.push(Y.encodeStateAsUpdate(d, sv))
    }
    const k = ada.got.length, t0 = performance.now()
    co.heard(ada.ws, { t: "y", path: "Co/N.md", u: toBase64(Y.mergeUpdates(parts)) }, "Co/N.md")
    await $.sleep(400)
    check("cotype: a guest's change under many Yjs ids is refused", ada.got.slice(k).some((m) => m.t === "y-reject") && !owner.text.toString().includes("zz") && performance.now() - t0 < 2000)
  }
  {
    // An emoji changed on disk comes in whole (Yjs makes half a character a U+FFFD).
    const { span } = await import("../../../plugins/core/companion/text.ts")
    const [a, b] = span("mood 😀 ok", "mood 😁 ok")
    check("cotype: a change is never cut inside a character", a === 5 && b === 3, [a, b])
    fs.writeFileSync(path.join(VAULT, "Co/N.md"), read("Co/N.md") + "mood 😀 ok\n")
    co.changed(["Co/N.md"])
    await $.sleep(300)
    fs.writeFileSync(path.join(VAULT, "Co/N.md"), read("Co/N.md").replace("😀", "😁"))
    co.changed(["Co/N.md"])
    await $.sleep(300)
    check("cotype: ...so an emoji changed on disk comes in as itself", owner.text.toString().includes("mood 😁 ok") && !owner.text.toString().includes("\uFFFD"), owner.text.toString())
  }
  for (const w of [owner, ada, rex]) w.close()
  await $.sleep(100)
  check("cotype: the note's room goes with its last window", !co.list().some((r: Any) => r.path === "Co/N.md"))
  fs.rmSync(path.join(VAULT, "Co"), { recursive: true, force: true })
  await $.vault.sync()
}
