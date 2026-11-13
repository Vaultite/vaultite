import { check, section } from "../lib.ts"
import { type Any, merge, plugin, web } from "./lib.ts"

// ---------- Autosave (web/src/core/autosave.ts): on a made-up server that merges as core/files.ts PUT does ----------
await section("autosave", async () => {
  const { textHash, applyEdit, editOf } = await import("../../../core/texthash.ts")
  const P = "Notes/Lighthouse.md"
  // The server: the file, its time, whether it answers, and a gate holding answers (a save on its way)
  const srv = { text: "", mtime: 1, down: false, gate: null as Promise<void> | null, puts: 0 }
  const file = () => ({ path: P, text: srv.text, mtime: srv.mtime, kind: null, problems: [] })
  const res = (status: number, body: unknown) => ({ status, ok: status < 300, statusText: "", json: async () => body })
  const handle = (b: Any) => {
    const cur = srv.text
    let text = b.text
    if (b.edit !== undefined) {
      if (textHash(cur) !== b.baseHash) return res(412, { error: "the file changed on disk: send its base to merge" })
      text = applyEdit(cur, b.edit)
    }
    const sent = text
    if (b.base != null && cur !== b.base && cur !== text) {
      const m = merge.merge3(b.base, text, cur)
      if (m === null) return res(409, { error: "the file changed on disk in the same place", ...file() })
      text = m
    }
    srv.puts++
    // (as Note dates does: a save stamps updated)
    srv.mtime++
    srv.text = text.replace(/^updated: \d+$/m, `updated: ${srv.mtime}`)
    const { text: _, ...rest } = file()
    return res(200, b.lean ? (srv.text === sent ? { ...rest, same: true } : { ...rest, edit: editOf(sent, srv.text) }) : file())
  }
  const fake: Any = (globalThis as Any).__autosave = {
    back: new Set<() => void>(), toasts: [] as string[], posts: [] as [string, Any][],
    async request(_m: string, _p: string, body: Any) {
      if (srv.down) throw new TypeError("Failed to fetch")
      const r = handle(body)
      fake.wrote?.()
      if (srv.gate) await srv.gate
      return r
    },
    async readFile() { return file() },
    async get(p: string) { return p.startsWith("activity") ? { events: [] } : { mtime: srv.mtime, size: srv.text.length } },
    async putJson(_p: string, b: Any) { srv.text = b.text; srv.mtime++; return file() },
  }
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { visibilityState: "visible" })
  const g = globalThis as Any
  g.addEventListener = win.addEventListener.bind(win); g.removeEventListener = win.removeEventListener.bind(win); g.document = doc
  const as: Any = await web("core/autosave.ts")
  const ticks = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }
  /** An editor on the file as it is now: its text, what autosave said, and how to close it; `inPlace`, it shows a
   *  conflict's clashes in its text (`shown`: them, and how it says how many are left), as editor/conflicts.ts does. */
  const open = (inPlace = false) => {
    let typed = srv.text, shown: Any = null
    const said: Any[] = []
    const conflict = inPlace ? (text: string, clashes: Any[], _who: unknown, left: Any) => { typed = text; shown = { clashes, left }; return true } : undefined
    const saver = as.makeAutosave(P, srv.text, { text: () => typed, apply: (t: string) => { typed = t }, onStatus: (s: Any) => said.push(s), onGone: () => {}, conflict })
    const close = saver.mount()
    return { saver, close, said, get text() { return typed }, get shown() { return shown }, type(t: string) { typed = t; saver.changed() }, set(t: string) { typed = t } }
  }

  {
    srv.text = "---\nupdated: 1\n---\na\nb\n"
    const ed = open()
    ed.type("---\nupdated: 1\n---\na\nb\nc\n")
    srv.text = "---\nupdated: 1\n---\nagent\na\nb\n" // (an agent's line, written as the save goes)
    let open_ = () => {}
    srv.gate = new Promise((r) => { open_ = r })
    void ed.saver.save()
    await ticks()
    ed.close() // (closed before the save's answer, which merged the agent's line in)
    srv.gate = null
    open_()
    await ticks()
    check("autosave: a note closed mid-save keeps the line an agent wrote, and what was typed", srv.text.includes("agent\n") && srv.text.includes("c\n"), srv.text)
    const puts = srv.puts
    ed.saver.changed(); ed.saver.save(); await ticks()
    check("autosave: closed, typing and saving do nothing", srv.puts === puts, srv.puts - puts)
  }
  {
    srv.text = "one\n"
    const ed = open()
    srv.down = true
    ed.type("one\ntwo\n")
    await ed.saver.save()
    check("autosave: a save that can't reach the server says so", ed.said.at(-1)?.kind === "error", ed.said.at(-1))
    srv.down = false
    for (const fn of fake.back) fn()
    await ticks()
    check("autosave: a failed save is sent again when the connection is back, with no keystroke", srv.text === "one\ntwo\n" && ed.said.at(-1)?.kind === "ok", { text: srv.text, said: ed.said.at(-1) })
    srv.down = true
    ed.type("one\ntwo\nthree\n")
    await ed.saver.save()
    srv.down = false
    doc.dispatchEvent(new Event("visibilitychange"))
    await ticks()
    check("autosave: and when the page is shown again", srv.text === "one\ntwo\nthree\n" && ed.said.at(-1)?.kind === "ok", srv.text)
    ed.close()
  }
  {
    srv.text = "v1\n"
    const stale = file()
    const ed = open()
    ed.type("v2\n")
    await ed.saver.save()
    await ed.saver.check(stale) // (the read made as it opened, landing after the save)
    await ticks()
    check("autosave: a read older than the last save doesn't take the note back", ed.text === "v2\n" && srv.text === "v2\n", { text: ed.text, disk: srv.text })
    ed.close()
  }
  {
    srv.text = "a\n"
    const ed = open()
    ed.type("a\nx\n")
    srv.text = "a\nagent\n"
    void ed.saver.check() // (heard while a save is pending: it waits for it)
    ed.type("a\n") // (typed away again: nothing left to save)
    await ed.saver.save()
    await ticks()
    check("autosave: a change heard while a save was pending is merged in even when there was nothing to save", ed.text === "a\nagent\n", ed.text)
    ed.close()
  }
  {
    srv.text = "a\n"
    const tab = open(), docked = open()
    const typeIn = (here: Any, there: Any, t: string) => { here.type(t); there.set(t); there.saver.follow() }
    typeIn(tab, docked, "a b\n")
    await tab.saver.save()
    typeIn(tab, docked, "a bc\n")
    const puts = srv.puts
    await docked.saver.check()
    await docked.saver.save()
    await ticks()
    check("autosave: an editor following another's typing takes its save without a conflict, and doesn't save it again",
      docked.text === "a bc\n" && srv.puts === puts && !docked.said.some((x: Any) => x.kind === "conflict"), { text: docked.text, puts: srv.puts - puts, said: docked.said.map((x: Any) => x.kind) })
    typeIn(docked, tab, "a bcd\n")
    await docked.saver.save()
    await tab.saver.check()
    await tab.saver.save()
    await ticks()
    check("autosave: typed in the other, it saves, and the first follows without a conflict",
      srv.text === "a bcd\n" && tab.text === "a bcd\n" && ![...tab.said, ...docked.said].some((x: Any) => x.kind === "conflict"), { disk: srv.text, tab: tab.text })
    tab.close(); docked.close()
  }
  {
    srv.text = "a\nb\n"
    const ed = open()
    ed.type("a\nb\nc\n")
    srv.text = "agent\na\nb\n"
    let open_ = () => {}
    srv.gate = new Promise((r) => { open_ = r })
    void ed.saver.save()
    await ticks()
    ed.type("a\nb\nc\nd\n") // (typed on as it saved, then closed)
    ed.close()
    srv.gate = null
    open_()
    await ticks()
    check("autosave: closed mid-save after typing on, the agent's line, what was sent and what came after are all kept", srv.text === "agent\na\nb\nc\nd\n", srv.text)
  }
  {
    // A conflict shown in place, then its editor goes (a plugin's page view): settled from the banner, with what was
    // done in that view (a task ticked) saved too, and no agent's edit taken meanwhile.
    srv.text = "a\nb\n- [ ] t\n"
    const ed = open(true)
    ed.type("a\nmine\n- [ ] t\n")
    srv.text = "a\ntheirs\n- [ ] t\n"
    await ed.saver.save()
    await ticks()
    const shown = ed.said.at(-1)
    check("autosave: a conflict in place holds the note against agents' edits", shown?.kind === "conflict" && shown.inline === true && !!as.heldByConflict?.(P), { said: shown, held: as.heldByConflict?.(P) })
    ed.shown.left(1, ed.shown.clashes) // (its editor went, handing back what's left)
    check("autosave: a conflict whose editor went is settled from the banner, not shown in place", ed.said.at(-1)?.kind === "conflict" && ed.said.at(-1).inline === false, ed.said.at(-1))
    ed.saver.reshow() // (an editor drawn again: in place again)
    const again = ed.said.at(-1)?.inline === true
    ed.shown.left(1, ed.shown.clashes)
    ed.type("a\nmine\n- [x] t\n")
    await ticks()
    const held = srv.text
    ed.saver.keep("theirs")
    await ticks()
    check("autosave: shown again by the next editor; without one, Keep theirs saves theirs and what was done meanwhile",
      again && held === "a\ntheirs\n- [ ] t\n" && srv.text === "a\ntheirs\n- [x] t\n" && ed.said.at(-1)?.kind === "ok" && !as.heldByConflict(P), { again, held, disk: srv.text })
    ed.close()
  }
  {
    // Another device's version iCloud kept apart (plugins/core/sync-conflicts), brought in: clean, merged and saved on
    // what's on disk; nothing missing, nothing written; clashing, shown in place, the file untouched till settled.
    const BASE = "one\ntwo\nthree\n", MINE = "one, here\ntwo\nthree\n"
    srv.text = MINE
    let ed = open(true)
    fake.posts.length = 0
    let r = await ed.saver.mergeIn(BASE, "one\ntwo\nthree, there\n", "Mini")
    check("autosave: another device's version that merges cleanly is merged and saved, its text kept in File history first",
      r === "merged" && srv.text === "one, here\ntwo\nthree, there\n" && fake.posts.some(([p, b]: Any) => p === "history/keep" && b.text === "one\ntwo\nthree, there\n"), { r, disk: srv.text, posts: fake.posts })
    let puts = srv.puts
    r = await ed.saver.mergeIn(BASE, BASE, "Mini")
    check("autosave: one with nothing missing here writes nothing", r === "same" && srv.puts === puts, { r, puts: srv.puts - puts })
    ed.close()

    srv.text = MINE
    ed = open(true)
    puts = srv.puts
    const settled = ed.saver.mergeIn(BASE, "one, there\ntwo\nthree\n", "Mini")
    await ticks()
    const held = ed.said.at(-1)
    check("autosave: one that clashes is shown in place as the other device's, nothing written meanwhile",
      held?.kind === "conflict" && held.version === true && held.inline === true && /Mini/.test(held.note ?? "") && ed.shown?.clashes.length === 1 && srv.puts === puts && as.conflictText(held) === "Line 1 differs in the version iCloud kept from Mini.",
      { held, shown: ed.shown, text: held && as.conflictText(held) })
    ed.set("one, there\ntwo\nthree\n") // (Keep theirs, in the editor)
    ed.shown.left(0)
    r = await settled
    check("autosave: settled in place, it's saved on what's on disk", r === "settled" && srv.text === "one, there\ntwo\nthree\n" && ed.said.at(-1)?.kind === "ok", { r, disk: srv.text })
    ed.close()

    srv.text = MINE
    ed = open(true)
    puts = srv.puts
    const kept = ed.saver.mergeIn(null, "one\ntwo, there\nthree\n", "Mini")
    await ticks()
    const each = ed.shown?.clashes.length
    ed.shown.left(1, ed.shown.clashes) // (its editor went)
    ed.saver.keep("mine")
    r = await kept
    check("autosave: with no common version each difference clashes; Keep yours from the banner leaves the file as it is",
      each === 1 && r === "settled" && srv.text === MINE && srv.puts === puts && ed.said.at(-1)?.kind === "ok", { each, r, disk: srv.text, puts: srv.puts - puts })
    ed.close()

    srv.text = MINE
    ed = open(false)
    r = await ed.saver.mergeIn(BASE, "one, there\ntwo\nthree\n", "Mini")
    check("autosave: where it can't be shown in place, it says so and holds nothing", r === "unsaved" && srv.text === MINE && !as.heldByConflict(P) && ed.said.at(-1)?.kind !== "conflict", { r, said: ed.said.at(-1) })
    ed.close()
  }
  {
    const step = as.step ?? (() => ({ to: null, do: [] }))
    const gone = step({ kind: "gone" }, { type: "typed" }, () => false), later = step({ kind: "error", tries: 2, retry: true }, { type: "retry" }, () => false)
    const closing = step({ kind: "saving", typed: false, again: false, recheck: false, tries: 0 }, { type: "close" }, () => false)
    const answered = step(closing.to ?? { kind: "idle" }, { type: "saved" }, () => false)
    check("autosave: gone stays gone; an error retried is a save; a close mid-save waits for its answer, then sends the rest",
      gone.to?.kind === "gone" && !gone.do.length && later.to?.kind === "saving" && later.to.tries === 2 && closing.to?.kind === "closing" && !closing.do.length
      && answered.to.kind === "gone" && answered.do.join() === "flush", { gone, later, closing, answered })
    const heard = step({ kind: "saving", typed: false, again: false, recheck: true, tries: 0 }, { type: "failed", retry: false }, () => false)
    check("autosave: a save failing with a change on disk heard meanwhile reads it (the file moved: its edits offered back)",
      heard.to.kind === "checking" && heard.do.join() === "read", heard)
  }

  // Typed together (plugins/core/companion/cotype.ts) on a made-up room: the server's doc, written to the file when the
  // test says (its turn, a pause after typing), and what's written on disk merged into it.
  const Y = await import("yjs"), { fromBase64, toBase64 } = await import("lib0/buffer")
  const { span } = await plugin("companion/text.ts")
  const co: Any = g.__cotype = { state: { connected: true }, subs: new Set(), rooms: null, settleFile: async () => {}, say: (m: Any) => co.state.connected && room.said(m) }
  const { cotype } = await plugin("companion/cotype.ts")
  const to = (m: Any) => setImmediate(() => co.rooms.heard(m))
  const into = (t: Any, text: string, origin: unknown) => {
    const now = t.toString(), [a, b] = span(now, text)
    t.doc.transact(() => { if (now.length - a - b) t.delete(a, now.length - a - b); if (text.length - a - b) t.insert(a, text.slice(a, text.length - b)) }, origin)
  }
  const room: Any = {
    doc: null, disk: "", others: 0, held: null, lost: false,
    /** On another machine's rooms (bridge.ts): that machine writes its own copy (`host`), never this server's. */
    remote: false, host: "",
    get text() { return room.doc.getText("md") },
    reset(text: string) {
      room.doc?.destroy()
      room.doc = new Y.Doc()
      room.text.insert(0, text)
      room.disk = text
      room.doc.on("update", (u: Uint8Array, origin: unknown) => { if (origin !== "client") to({ t: "y", path: P, u: toBase64(u) }) })
    },
    write() { if (room.remote) room.host = room.text.toString(); else { srv.text = room.text.toString(); srv.mtime++; room.disk = srv.text } },
    reread() { if (srv.text !== room.disk) { into(room.text, merge.merge3(room.disk, room.text.toString(), srv.text) ?? room.text.toString(), "disk"); room.disk = srv.text } },
    /** The other one types, and it's written. */
    other(text: string) { into(room.text, text, "other"); room.write() },
    peers(n: number) { room.others = n; to({ t: "y-peers", path: P, others: n }) },
    said(m: Any) {
      if (m.t === "y-open") {
        room.reread()
        const u = m.bare ? undefined : toBase64(Y.encodeStateAsUpdate(room.doc)), held = room.held
        void (async () => { if (!m.bare) await held; to({ t: "y-state", path: P, u, others: room.others, remote: room.remote || undefined }) })()
      } else if (m.t === "y" && !room.lost) Y.applyUpdate(room.doc, fromBase64(m.u), "client")
      return true
    },
  }
  /** An editor as cotype.ts sees one; bound (yCollab, stubbed), what's typed goes into the doc and it shows the doc. */
  const view = (ed: Any) => {
    let yt: Any = null
    const mirror = () => ed.set(yt.toString())
    const v = {
      dom: { isConnected: true },
      get state() { return { doc: { toString: () => ed.text, get length() { return ed.text.length } } } },
      dispatch(spec: Any) {
        if (spec.changes) {
          const { from, to, insert } = spec.changes, text = ed.text.slice(0, from) + insert + ed.text.slice(to)
          if (yt && !spec.annotations) into(yt, text, null); else ed.set(text)
        }
        const ext = spec.effects?.value?.extension
        if (Array.isArray(ext)) { yt?.unobserve(mirror); yt = ext.find((x: Any) => x?.ytext)?.ytext ?? null; yt?.observe(mirror) }
      },
      type(text: string) { if (yt) into(yt, text, null); else ed.type(text) },
    }
    return v
  }
  /** A note open in an editor that co-types: alone till someone comes. */
  const together = async (text: string) => {
    srv.text = text
    room.reset(text)
    Object.assign(room, { others: 0, remote: false })
    fake.wrote = () => room.reread()
    const ed = open(), v = view(ed), plug = cotype(P)[1].create(v)
    co.settleFile = async () => { await ed.saver.calm(); return ed.saver.disk }
    await ticks()
    return { ed, v, close: () => { plug.destroy(); ed.close() } }
  }

  {
    // Someone comes during a conflict: typed in together only once it's settled, on the text kept. (First: a room
    // closed hands its note back only a while later.)
    const { ed, close } = await together("a\nb\n")
    ed.type("a\nmine\n")
    srv.text = "a\ntheirs\n"
    await ed.saver.save()
    await ticks()
    room.peers(1)
    await ticks()
    const during = ed.text
    ed.saver.keep("mine")
    await ticks()
    room.write()
    check("cotype: someone joining during a conflict waits for it: the text isn't taken over, then what was kept is typed in together",
      during === "a\nmine\n" && ed.text === "a\nmine\n" && srv.text === "a\nmine\n", { during, editor: ed.text, disk: srv.text })
    room.peers(0)
    await ticks()
    close()
  }
  {
    const { ed, v, close } = await together("a\n")
    room.peers(1)
    await ticks()
    v.type("a\nmine\n")
    await ticks()
    room.write()
    room.other("a\nmine\ntheirs\n")
    await ticks()
    v.type("a\nmine\ntheirs\nlast\n") // (still to be written as the other one leaves)
    await ticks()
    room.peers(0)
    await ticks()
    room.write()
    v.type("a\nmine\ntheirs\nlast\nalone\n")
    await ed.saver.save()
    await ticks()
    check("cotype: typed together, then alone, typing on saves on what the server has: no conflict, both sides' text kept",
      srv.text === "a\nmine\ntheirs\nlast\nalone\n" && !ed.said.some((x: Any) => x.kind === "conflict"), { text: srv.text, said: ed.said.map((x: Any) => x.kind) })
    close()
  }
  {
    const { ed, v, close } = await together("a\n")
    v.type("a\nb\n")
    let saved = () => {}, answer = () => {}
    srv.gate = new Promise((r) => { saved = r })
    void ed.saver.save()
    await ticks()
    room.held = new Promise<void>((r) => { answer = r })
    room.peers(1) // (someone came as it saved)
    await ticks()
    srv.gate = null
    saved()
    await ticks()
    v.type("a\nb\nc\n") // (typed as the doc is on its way)
    await ed.saver.save()
    await ticks()
    answer()
    room.held = null
    await ticks()
    room.write()
    check("cotype: joined mid-save, what's typed as the doc comes is in it once", srv.text === "a\nb\nc\n" && ed.text === "a\nb\nc\n", { disk: srv.text, editor: ed.text })
    room.peers(0)
    await ticks()
    close()
  }
  {
    const { ed, v, close } = await together("a\n")
    room.peers(1)
    await ticks()
    v.type("a\nmine\n")
    await ticks()
    room.write()
    room.other("a\nmine\ntheirs\n")
    await ticks()
    room.lost = true // (a phone's stuck tunnel: what's sent from here never gets there)
    v.type("a\nmine\ntheirs\nlost\n")
    await ticks()
    co.state.connected = false
    for (const fn of co.subs) fn()
    await ed.saver.settle()
    await ticks()
    check("cotype: the socket gone, what the server never got is saved, the rest kept, no conflict",
      srv.text === "a\nmine\ntheirs\nlost\n" && !ed.said.some((x: Any) => x.kind === "conflict"), { text: srv.text, said: ed.said.map((x: Any) => x.kind) })
    close()
    room.lost = false
    co.state.connected = true
  }
  {
    // On another machine's rooms: it goes (typed on here alone, saved on this machine), and comes back.
    const { ed, v, close } = await together("a\n")
    fake.wrote = undefined
    room.remote = true
    room.peers(1)
    await ticks()
    v.type("a\nmine\n")
    await ticks()
    room.other("a\nmine\ntheirs\n")
    await ticks()
    room.remote = false // (this server's own room, asked again: no one else in it)
    room.others = 0
    to({ t: "y-gone", path: P })
    await ticks()
    v.type("a\nmine\ntheirs\naway\n")
    await ed.saver.save()
    await ticks()
    const here = srv.text
    room.remote = true
    room.others = 1
    to({ t: "y-state", path: P, u: toBase64(Y.encodeStateAsUpdate(room.doc)), others: 1, remote: true }) // (back)
    await ticks()
    room.write()
    check("cotype: another machine's rooms gone and back, what was typed here meanwhile is saved here, then reaches it once",
      here === "a\nmine\ntheirs\naway\n" && room.host === "a\nmine\ntheirs\naway\n" && !ed.said.some((x: Any) => x.kind === "conflict"),
      { here, there: room.host, said: ed.said.map((x: Any) => x.kind) })
    room.remote = false
    room.peers(0)
    await ticks()
    close()
  }
  delete fake.wrote
  delete g.addEventListener; delete g.removeEventListener; delete g.document; delete g.__autosave; delete g.__cotype
})
