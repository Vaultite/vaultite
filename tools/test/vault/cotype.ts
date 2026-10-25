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
  function win(name: string, peer: Any, note = "Co/N.md") {
    const got: Any[] = [], on: Record<string, () => void> = {}
    const ws = { readyState: 1, OPEN: 1, send: (t: string) => { const m = JSON.parse(t); got.push(m); if (m.t === "y-state" || m.t === "y") Y.applyUpdate(doc, fromBase64(m.u), "server") }, on: (e: string, fn: () => void) => { on[e] = fn } } as Any
    const doc = new Y.Doc(), aw = new Awareness(doc)
    doc.on("update", (u: Uint8Array, origin: unknown) => { if (origin !== "server") co.heard(ws, { t: "y", path: note, u: toBase64(u) }, note) })
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

  const before = read("Co/N.md"), heardRex = rex.got.length
  ada.text.insert(0, "![x](https://example.com/p.png)\n")
  for (let i = 0; i < 5; i++) rex.text.insert(0, "REX\n")
  await $.sleep(800)
  check("cotype: a guest's change the share's rules refuse, or a reader's, doesn't land", read("Co/N.md") === before && !owner.text.toString().includes("example.com") && !owner.text.toString().includes("REX"), owner.text.toString())
  check("cotype: ...the guest's is said back, and a reader isn't sent the note for each", ada.got.some((m) => m.t === "y-reject" && m.why === "no images") && !rex.got.slice(heardRex).some((m) => m.t === "y-reject" || m.t === "y-state"), rex.got.slice(heardRex).map((m) => m.t))

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
    const { versions } = await (companion.service("history:versions") as Any)("Co/N.md")
    const texts = await Promise.all(versions.map((v: Any) => (companion.service("history:text") as Any)("Co/N.md", v.t)))
    check("cotype: ...and the file's clashing version is kept in its history", texts.some((t: Any) => String(t).includes("from disk")), versions)
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
    // (nor under one whose window hasn't typed yet, only shown its caret)
    const lu = win("Lucas", { who: you })
    co.heard(lu.ws, { t: "y-open", path: "Co/N.md" }, "Co/N.md")
    await $.sleep(100)
    lu.aw.setLocalState({ cursor: null })
    co.heard(lu.ws, { t: "aw", path: "Co/N.md", u: toBase64(encodeAwarenessUpdate(lu.aw, [lu.doc.clientID])) }, "Co/N.md")
    const early = new Y.Doc()
    Y.applyUpdate(early, Y.encodeStateAsUpdate(owner.doc))
    early.clientID = lu.doc.clientID
    const esv = Y.encodeStateVector(early)
    early.getText("md").insert(0, "before them ")
    const j = ada.got.length
    co.heard(ada.ws, { t: "y", path: "Co/N.md", u: toBase64(Y.encodeStateAsUpdate(early, esv)) }, "Co/N.md")
    await $.sleep(400)
    check("cotype: nor under the Yjs id of a window that has only shown its caret", ada.got.slice(j).some((m) => m.t === "y-reject") && !owner.text.toString().includes("before them"))
    const as = new Awareness(new Y.Doc())
    as.clientID = owner.doc.clientID
    as.setLocalState({ cursor: null })
    const ivy = win("Ivy", { who: { ...guestWho, agent: "Ivy" }, may: () => "" })
    co.heard(ivy.ws, { t: "y-open", path: "Co/N.md" }, "Co/N.md")
    await $.sleep(100)
    const h = lu.got.length
    co.heard(ivy.ws, { t: "aw", path: "Co/N.md", u: toBase64(encodeAwarenessUpdate(as, [owner.doc.clientID])) }, "Co/N.md")
    ivy.aw.setLocalState({ cursor: null })
    co.heard(ivy.ws, { t: "aw", path: "Co/N.md", u: toBase64(encodeAwarenessUpdate(ivy.aw, [ivy.doc.clientID])) }, "Co/N.md")
    const shown = lu.got.slice(h).filter((m) => m.t === "aw").length
    check("cotype: nor shows a caret under the id another window types under (its own, yes)", shown === 1, shown)
    ivy.close()
    lu.close()
  }
  {
    // Sent the note back for a change that didn't land only so often (it can be a big one).
    const eve = win("Eve", { who: { ...guestWho, agent: "Eve" }, may: () => "" })
    co.heard(eve.ws, { t: "y-open", path: "Co/N.md" }, "Co/N.md")
    await $.sleep(100)
    const k = eve.got.length, big = "A".repeat(400_001)
    for (let i = 0; i < 40; i++) co.heard(eve.ws, { t: "y", path: "Co/N.md", u: big }, "Co/N.md")
    const states = eve.got.slice(k).filter((m) => m.t === "y-state").length
    check("cotype: a window is sent the note back so often a minute", states > 0 && states <= 30, states)
    eve.close()
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
  {
    // Only guests in a note when the disk clashes with their typing: theirs stays only if they could have written it
    // over the file's version (here, the owner took out a line the guest may not add).
    write("Co/G.md", "a line\nSECRET\n")
    await $.vault.sync()
    const may = (_rel: string, b: string, after: string) => (after.includes("SECRET") && !b.includes("SECRET") ? "no secrets" : "")
    const gina = win("Gina", { who: { ...guestWho, agent: "Gina" }, may }, "Co/G.md")
    co.heard(gina.ws, { t: "y-open", path: "Co/G.md" }, "Co/G.md")
    await $.sleep(100)
    gina.text.insert(6, " typed")
    await $.sleep(300)
    fs.writeFileSync(path.join(VAULT, "Co/G.md"), "a line from disk\n")
    co.changed(["Co/G.md"])
    await $.sleep(900)
    check("cotype: guests alone don't write over a clashing file what they couldn't write", read("Co/G.md") === "a line from disk\n" && gina.text.toString() === "a line from disk\n"
      && gina.got.some((m) => m.t === "y-clash" && m.kept === "file"), [read("Co/G.md"), gina.text.toString()])
    gina.close()
    // A guest in a note too long to type in together is refused before their change is tried.
    write("Co/L.md", "x".repeat(70_000) + "\n")
    await $.vault.sync()
    const lena = win("Lena", { who: { ...guestWho, agent: "Lena" }, may: () => "" }, "Co/L.md")
    co.heard(lena.ws, { t: "y-open", path: "Co/L.md" }, "Co/L.md")
    await $.sleep(100)
    lena.text.insert(0, "hi")
    await $.sleep(400)
    check("cotype: a guest's change in a note too long to type in together is refused", lena.got.some((m) => m.t === "y-reject" && /too long/.test(m.why)) && !read("Co/L.md").startsWith("hi"))
    lena.close()
  }
  {
    // A guest's waiting changes are capped as they come (many small ones, or bytes), before they're merged; ones that
    // aren't Yjs updates are refused, not thrown where nothing catches them.
    const kit = win("Kit", { who: { ...guestWho, agent: "Kit" }, may: () => "" })
    co.heard(kit.ws, { t: "y-open", path: "Co/N.md" }, "Co/N.md")
    await $.sleep(100)
    const d = new Y.Doc(), many: Uint8Array[] = []
    Y.applyUpdate(d, Y.encodeStateAsUpdate(owner.doc))
    d.on("update", (u: Uint8Array) => many.push(u))
    for (let i = 0; i < 600; i++) d.getText("md").insert(0, "q")
    const k = kit.got.length, t0 = performance.now()
    for (const u of many) co.heard(kit.ws, { t: "y", path: "Co/N.md", u: toBase64(u) }, "Co/N.md")
    const big = new Y.Doc()
    Y.applyUpdate(big, Y.encodeStateAsUpdate(owner.doc))
    const bytes: Uint8Array[] = []
    for (let i = 0; i < 3; i++) { const sv = Y.encodeStateVector(big); big.getText("md").insert(0, "w".repeat(150_000)); bytes.push(Y.encodeStateAsUpdate(big, sv)) }
    for (const u of bytes) co.heard(kit.ws, { t: "y", path: "Co/N.md", u: toBase64(u) }, "Co/N.md")
    const capped = kit.got.slice(k).filter((m) => m.t === "y-reject").length, ms = performance.now() - t0
    co.heard(kit.ws, { t: "y", path: "Co/N.md", u: toBase64(new Uint8Array([1, 2, 3, 250, 250])) }, "Co/N.md")
    co.heard(kit.ws, { t: "y", path: "Co/N.md", u: toBase64(new Uint8Array([9, 9, 9, 9])) }, "Co/N.md")
    await $.sleep(400)
    check("cotype: a guest's waiting changes stop at so many, or so many bytes, refused as they come", capped >= 2 && ms < 1000 && !owner.text.toString().includes("qqq") && !owner.text.toString().includes("www"), [capped, ms])
    check("cotype: ...and what isn't an update is refused", kit.got.slice(k).filter((m) => m.t === "y-reject").length > capped)
    kit.close()
  }
  {
    // A guest who leaves just after typing: what they typed is written as theirs before the owner's window hears it's
    // alone (alone, it saves the doc as the user's).
    write("Co/P.md", "# P\n")
    await $.vault.sync()
    const me = win("Lucas", { who: you }, "Co/P.md"), bea = win("Bea", { who: { ...guestWho, agent: "Bea" }, may: () => "" }, "Co/P.md")
    for (const w of [me, bea]) co.heard(w.ws, { t: "y-open", path: "Co/P.md" }, "Co/P.md")
    await $.sleep(100)
    let onDisk: string | null = null
    const sent = me.ws.send
    me.ws.send = (t: string) => { const m = JSON.parse(t); if (m.t === "y-peers" && m.others === 0) onDisk ??= read("Co/P.md"); sent(t) }
    bea.text.insert(bea.text.length, "Bea's words\n")
    await $.sleep(50)
    bea.close()
    await $.sleep(800)
    const blame = (await $.app.callOp("provenance.blame", { path: "Co/P.md" })).result as Any
    check("cotype: a guest who leaves right after typing has it written as theirs before the owner's window is alone", String(onDisk).includes("Bea's words")
      && blame.runs.some((r: Any) => r.by === "Bea" && r.guest && r.text.includes("Bea's words")), [onDisk, blame.runs])
    // A guest's change the file won't take (the share's rules, as the write checks them) goes from the doc, said back to
    // them, so the owner's next save doesn't write it as the user's.
    const cy = win("Cy", { who: { ...guestWho, agent: "Cy" }, may: () => "" }, "Co/P.md")
    co.heard(cy.ws, { t: "y-open", path: "Co/P.md" }, "Co/P.md")
    await $.sleep(100)
    cy.text.insert(cy.text.length, "<script>alert(1)</script>\n")
    await $.sleep(1200)
    me.text.insert(0, "Owner ")
    await $.sleep(1000)
    check("cotype: a guest's change the file won't take goes from the doc and is said back, never saved as the owner's", !me.text.toString().includes("<script>") && !read("Co/P.md").includes("<script>")
      && read("Co/P.md").includes("Owner ") && cy.got.some((m) => m.t === "y-reject" && m.why === "it couldn't be saved"), [read("Co/P.md"), me.text.toString()])
    for (const w of [me, cy]) w.close()
  }
  {
    // A note in a folder another machine of the vault shares (bridge.ts): this machine's windows type in that machine's
    // room, with its guests, through a socket per window; that machine writes it, this one never does meanwhile.
    const { EventEmitter } = await import("node:events")
    const { bridges } = await import("../../../plugins/core/companion/bridge.ts")
    const HOST = fs.mkdtempSync(path.join(VAULT, "..", "host-")), hostWrites: Any[] = []
    fs.mkdirSync(path.join(HOST, "Shared"))
    fs.writeFileSync(path.join(HOST, "Shared/S.md"), "# S\n\nhost line\n")
    write("Shared/S.md", "# S\n\nhost line\n")
    await $.vault.sync()
    const hostPlugin = { vault: { abs: (p: string) => path.join(HOST, p) }, service: () => undefined,
      host: { api: async (_m: string, _r: string, b: Any, who: Any) => { hostWrites.push({ who, text: b.text }); fs.writeFileSync(path.join(HOST, b.path), b.text); return { text: b.text } } } } as Any
    const hostCo = rooms(hostPlugin)
    /** A socket's two ends: what one sends, the other hears. */
    const pair = () => {
      const a = new EventEmitter() as Any, b = new EventEmitter() as Any
      for (const [me, other] of [[a, b], [b, a]]) Object.assign(me, { readyState: 1, OPEN: 1, CONNECTING: 0, send: (t: string) => { if (me.readyState === 1) other.emit("message", t) },
        close: () => { if (me.readyState !== 1) return; a.readyState = b.readyState = 3; a.emit("close"); b.emit("close") }, terminate: () => me.close(), ping: () => {} })
      return [a, b]
    }
    let ups = 0
    const upstreams: Any[] = []
    const connect = () => {
      const [mine, theirs] = pair()
      ups++
      upstreams.push(mine)
      hostCo.add(theirs, { who: you, name: "Owner", tint: "red", edits: true, see: (r: string) => r })
      theirs.on("message", (t: string) => { const m = JSON.parse(t); hostCo.heard(theirs, m, m.path) })
      return mine
    }
    let shared = ["Shared"]
    const localCalls: Any[] = []
    const m1 = { id: "m1", label: "M1", url: "http://m1", online: true, self: false }
    const there = bridges(companion, (ws, m, p) => { localCalls.push([m.t, p]); co.heard(ws, m, p) }, { hosts: async () => shared.length ? [{ m: m1, folders: shared }] : [], connect, downMs: 50 })
    await there.refresh()
    /** A window of this machine's app, as cotype.ts: what it types goes out, through the bridge first. */
    function here() {
      const got: Any[] = [], [ws] = pair()
      const say = (m: Any) => { if (!there.heard(ws, m, m.path)) co.heard(ws, m, m.path) }
      const w = { ws, got, say } as Any
      // (a fresh doc for each state sent, as the app's)
      const fresh = () => {
        w.doc = new Y.Doc(); w.aw = new Awareness(w.doc); w.text = w.doc.getText("md")
        w.doc.on("update", (u: Uint8Array, origin: unknown) => { if (origin !== "server") say({ t: "y", path: "Shared/S.md", u: toBase64(u) }) })
      }
      fresh()
      ws.send = (t: string) => { const m = JSON.parse(t); got.push(m); if (m.t === "y-state") fresh(); if ((m.t === "y-state" || m.t === "y") && m.u) Y.applyUpdate(w.doc, fromBase64(m.u), "server") }
      co.add(ws, { who: you, name: "Owner", tint: "red", edits: true, see: (r: string) => r })
      there.add(ws)
      return w as { ws: Any; got: Any[]; say: (m: Any) => void; doc: Y.Doc; aw: Awareness; text: Y.Text }
    }
    const me = here()
    me.say({ t: "y-open", path: "Shared/S.md" })
    const eve = (() => {
      const got: Any[] = [], [ws] = pair(), doc = new Y.Doc(), aw = new Awareness(doc)
      ws.send = (t: string) => { const m = JSON.parse(t); got.push(m); if ((m.t === "y-state" || m.t === "y") && m.u) Y.applyUpdate(doc, fromBase64(m.u), "server") }
      doc.on("update", (u: Uint8Array, origin: unknown) => { if (origin !== "server") hostCo.heard(ws, { t: "y", path: "Shared/S.md", u: toBase64(u) }, "Shared/S.md") })
      hostCo.add(ws, { who: { ...guestWho, agent: "Eve" }, name: "Eve", tint: "blue", edits: true, see: (r: string) => r, may: () => "" })
      hostCo.heard(ws, { t: "y-open", path: "Shared/S.md" }, "Shared/S.md")
      return { ws, got, doc, aw, text: doc.getText("md") }
    })()
    await $.sleep(100)
    const state = me.got.find((m) => m.t === "y-state")
    check("bridge: a note another machine shares opens in its room, said to be there", state?.remote === true && me.text.toString() === "# S\n\nhost line\n" && ups === 1, me.got.map((m) => m.t))
    check("bridge: ...not in this machine's", !co.list().some((r: Any) => r.path === "Shared/S.md") && hostCo.list().find((r: Any) => r.path === "Shared/S.md")?.peers === 2)

    me.text.insert(me.text.length, "typed on this machine\n")
    await $.sleep(100)
    eve.text.insert(eve.text.length, "typed by the guest\n")
    await $.sleep(1200)
    const hostText = fs.readFileSync(path.join(HOST, "Shared/S.md"), "utf8")
    check("bridge: typed both ways, and written there", hostText.includes("typed on this machine") && hostText.includes("typed by the guest") && me.text.toString() === eve.text.toString(), [hostText, me.text.toString()])
    check("bridge: each one's lines written as theirs: this machine's as the user's", hostWrites.some((w) => w.who.client === "app/web" && w.text.includes("typed on this machine") && !w.text.includes("typed by the guest"))
      && hostWrites.some((w) => w.who.agent === "Eve" && w.text.includes("typed by the guest")), hostWrites.map((w) => [w.who.label, w.text]))
    check("bridge: this machine never writes it meanwhile", read("Shared/S.md") === "# S\n\nhost line\n")

    me.aw.setLocalState({ user: { name: "x" }, cursor: null })
    me.say({ t: "aw", path: "Shared/S.md", u: toBase64(encodeAwarenessUpdate(me.aw, [me.doc.clientID])) })
    eve.aw.setLocalState({ user: { name: "x" }, cursor: null })
    hostCo.heard(eve.ws, { t: "aw", path: "Shared/S.md", u: toBase64(encodeAwarenessUpdate(eve.aw, [eve.doc.clientID])) }, "Shared/S.md")
    await $.sleep(50)
    const names = (got: Any[]) => { const a = new Awareness(new Y.Doc()); for (const m of got.filter((x) => x.t === "aw")) applyAwarenessUpdate(a, fromBase64(m.u), "server"); return [...a.getStates().values()].map((x: Any) => x.user?.name) }
    check("bridge: carets both ways, named there", names(eve.got).includes("Owner") && names(me.got).includes("Eve"), [names(eve.got), names(me.got)])

    // Closed and opened again; no longer shared there, shared again.
    const before = me.got.length
    me.say({ t: "y-close", path: "Shared/S.md" })
    await $.sleep(50)
    check("bridge: closed here, it leaves there", hostCo.list().find((r: Any) => r.path === "Shared/S.md")?.peers === 1 && me.got.length === before)
    me.say({ t: "y-open", path: "Shared/S.md" })
    await $.sleep(100)
    check("bridge: opened again, there again", me.got.slice(before).some((m) => m.t === "y-state" && m.remote) && ups === 2)

    shared = []
    const n = me.got.length
    await there.refresh()
    check("bridge: a folder no longer shared there comes back here", me.got.slice(n).some((m) => m.t === "y-gone" && m.path === "Shared/S.md"), me.got.slice(n).map((m) => m.t))
    me.say({ t: "y-open", path: "Shared/S.md" })
    await $.sleep(100)
    check("bridge: ...opened in this machine's room", co.list().some((r: Any) => r.path === "Shared/S.md") && me.got.slice(n).some((m) => m.t === "y-state" && !m.remote))

    shared = ["Shared"]
    const k = me.got.length
    await there.refresh()
    await $.sleep(100)
    check("bridge: shared again, it moves there (out of this machine's room)", me.got.slice(k).some((m) => m.t === "y-state" && m.remote) && !co.list().some((r: Any) => r.path === "Shared/S.md"), me.got.slice(k).map((m) => m.t))

    // The connection dropping: said gone, opened here meanwhile (that machine let be a while), there again after.
    const j = me.got.length
    upstreams.at(-1)!.close()
    await $.sleep(20)
    check("bridge: a dropped connection is said, and the note's typed in here meanwhile", me.got.slice(j).some((m) => m.t === "y-gone") && hostCo.list().find((r: Any) => r.path === "Shared/S.md")?.peers === 1)
    me.say({ t: "y-open", path: "Shared/S.md" })
    await $.sleep(20)
    check("bridge: ...here", co.list().some((r: Any) => r.path === "Shared/S.md") && !me.got.slice(j).some((m) => m.t === "y-state" && m.remote))
    eve.text.insert(0, "while it was away\n")
    await $.sleep(400)
    await there.refresh()
    await $.sleep(100)
    check("bridge: back, there again with what was typed there meanwhile", me.got.slice(j).some((m) => m.t === "y-state" && m.remote) && me.text.toString().startsWith("while it was away")
      && !co.list().some((r: Any) => r.path === "Shared/S.md"), me.text.toString())
    me.text.insert(me.text.length, "after it came back\n")
    await $.sleep(1000)
    check("bridge: ...and typed there", fs.readFileSync(path.join(HOST, "Shared/S.md"), "utf8").includes("after it came back") && read("Shared/S.md") === "# S\n\nhost line\n")
    eve.ws.close()
    me.ws.close()
    await $.sleep(100)
    check("bridge: a window gone leaves the room there", !hostCo.list().some((r: Any) => r.path === "Shared/S.md" && r.peers > 0))
    there.stop()
    fs.rmSync(HOST, { recursive: true, force: true })
    fs.rmSync(path.join(VAULT, "Shared"), { recursive: true, force: true })
  }
  for (const w of [owner, ada, rex]) w.close()
  await $.sleep(100)
  check("cotype: the note's room goes with its last window", !co.list().some((r: Any) => r.path === "Co/N.md"))
  fs.rmSync(path.join(VAULT, "Co"), { recursive: true, force: true })
  await $.vault.sync()
}
