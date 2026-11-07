// Device sync's engine (plugins/core/sync): the merge rules, then simulated devices editing, renaming and deleting
// through partitions and reconnects, which must always converge with no line lost.
import "./test/isolate.ts"
import assert from "node:assert/strict"
import { mergeJson, mergeText } from "../plugins/core/sync/merge.ts"
import { type Entry, Replica } from "../plugins/core/sync/engine.ts"
import { MemFolder, MemStore } from "../plugins/core/sync/memory.ts"

let checks = 0
const check = (name: string, fn: () => void) => { try { fn(); checks++ } catch (e) { console.error(`FAIL ${name}`); throw e } }

// ---------- merges

check("text: both sides' changes kept", () => {
  const m = mergeText("a\nb\nc\nd\n", "A\nb\nc\nd\n", "a\nb\nc\nD\n", true)
  assert.equal(m.text, "A\nb\nc\nD\n"); assert.equal(m.clash, null)
})
check("text: the same change once", () => {
  const m = mergeText("a\nb\n", "a\nB\nx\n", "a\nB\nx\n", true)
  assert.equal(m.text, "a\nB\nx\n"); assert.equal(m.clash, null)
})
check("text: both append, both kept, earlier first", () => {
  const m = mergeText("log\n", "log\nlater\n", "log\nearlier\n", true, false)
  assert.equal(m.text, "log\nearlier\nlater\n"); assert.equal(m.clash, null)
})
check("text: same lines changed: winner stays, other handed back", () => {
  const m = mergeText("a\nb\nc\n", "a\nWIN\nc\nz\n", "a\nLOSE\nc\n", true)
  assert.equal(m.text, "a\nWIN\nc\nz\n")
  assert.ok(m.clash)
  assert.equal(m.clash!.base, "a\nb\nc\nz\n"); assert.equal(m.clash!.other, "a\nLOSE\nc\nz\n")
})
check("json: a list of plain values merges item by item", () => {
  const m = mergeJson('{"done": ["a", "b"]}', '{"done": ["a", "b", "c"]}', '{"done": ["a", "d"]}', true)!
  assert.deepEqual(JSON.parse(m.text).done, ["a", "d", "c"]); assert.equal(m.clash, null)
})
check("json: by key, clash per key", () => {
  const base = '{\n  "a": 1,\n  "b": 1,\n  "c": 1\n}\n'
  const m = mergeJson(base, '{\n  "a": 2,\n  "b": 1,\n  "c": 5\n}\n', '{\n  "a": 1,\n  "b": 3,\n  "c": 6\n}\n', true)!
  assert.deepEqual(JSON.parse(m.text), { a: 2, b: 3, c: 5 }); assert.deepEqual(m.keys, ["c"])
})

// ---------- devices

type Dev = { r: Replica; f: MemFolder; s: MemStore }
let clockNow = 1_700_000_000_000
const now = () => (clockNow += 1000)
function device(id: string): Dev {
  const f = new MemFolder(), s = new MemStore()
  return { f, s, r: new Replica({ device: id, store: s, folder: f, now }) }
}
/** Two devices trade what the other lacks, blobs too (as the routes do). */
function trade(a: Dev, b: Dev) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const es: Entry[] = x.r.missing(y.r.vector())
    y.r.receive(es)
  }
  for (const [x, y] of [[a, b], [b, a]]) for (const h of y.r.missingBlobs()) { const bl = x.s.blob(h); if (bl) y.s.putBlob(h, bl) }
  // (a merged blob made on one side, wanted on the other's next step: every blob the logs name)
  for (const [x, y] of [[a, b], [b, a]]) for (const [h, bl] of x.s.blobs) if (!y.s.hasBlob(h)) y.s.putBlob(h, bl)
}
const settle = (ds: Dev[]) => {
  for (let round = 0; round < 12; round++) {
    for (const d of ds) d.r.step()
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) trade(ds[i], ds[j])
  }
  for (const d of ds) d.r.step()
}
const snap = (d: Dev) => [...d.f.files.keys()].sort().map((p) => `${p}=${d.f.text(p)}`).join("\n---\n")

check("two devices: an edit reaches the other", () => {
  const a = device("a"), b = device("b")
  a.f.put("Note.md", "one\n"); a.r.step()
  settle([a, b])
  assert.equal(b.f.text("Note.md"), "one\n")
  b.f.put("Note.md", "one\ntwo\n"); settle([a, b])
  assert.equal(a.f.text("Note.md"), "one\ntwo\n")
})
check("clash: later wins, other is an open conflict on every device, settled once", () => {
  const a = device("a"), b = device("b")
  a.f.put("N.md", "x\nshared\ny\n"); settle([a, b])
  a.f.put("N.md", "x\nfrom a\ny\n"); a.r.step()
  b.f.put("N.md", "x\nfrom b\ny\n"); b.r.step() // (later clock: b wins)
  settle([a, b])
  assert.equal(a.f.text("N.md"), b.f.text("N.md"))
  const ca = a.r.conflicts(), cb = b.r.conflicts()
  assert.equal(ca.length, 1); assert.equal(cb.length, 1); assert.equal(ca[0].conflict.id, cb[0].conflict.id)
  const winner = a.f.text("N.md")!, other = a.r.blobText(ca[0].conflict.other)!
  assert.ok([winner, other].some((t) => t.includes("from a")) && [winner, other].some((t) => t.includes("from b")))
  a.r.settle(ca[0].file, [ca[0].conflict.id]); settle([a, b])
  assert.equal(b.r.conflicts().length, 0)
})
check("delete vs edit: the edit wins", () => {
  const a = device("a"), b = device("b")
  a.f.put("D.md", "keep me\n"); settle([a, b])
  a.f.remove("D.md"); a.r.step()
  b.f.put("D.md", "keep me\nedited\n"); b.r.step()
  settle([a, b])
  assert.equal(a.f.text("D.md"), "keep me\nedited\n"); assert.equal(b.f.text("D.md"), "keep me\nedited\n")
})
check("move vs edit: both apply", () => {
  const a = device("a"), b = device("b")
  a.f.put("Old.md", "l1\nl2\n"); settle([a, b])
  a.f.move("Old.md", "Folder/New.md"); a.r.step()
  b.f.put("Old.md", "l1\nl2\nl3\n"); b.r.step()
  settle([a, b])
  for (const d of [a, b]) { assert.equal(d.f.text("Folder/New.md"), "l1\nl2\nl3\n"); assert.equal(d.f.text("Old.md"), null) }
})
check("binary clash: later wins, other kept beside it", () => {
  const a = device("a"), b = device("b")
  a.f.write("img.png", new Uint8Array([0, 1, 2])); settle([a, b])
  a.f.write("img.png", new Uint8Array([0, 9, 9])); a.r.step()
  b.f.write("img.png", new Uint8Array([0, 7, 7])); b.r.step()
  settle([a, b])
  assert.equal(snap(a), snap(b))
  assert.equal(a.f.files.size, 2)
  assert.deepEqual([...a.f.read("img.png")!], [0, 7, 7])
})
check("both create the same name: one file, both kept", () => {
  const a = device("a"), b = device("b")
  a.f.put("Daily/2026-11-07.md", "from a\n"); a.r.step()
  b.f.put("Daily/2026-11-07.md", "from b\n"); b.r.step()
  settle([a, b])
  assert.equal(snap(a), snap(b))
  const t = a.f.text("Daily/2026-11-07.md")!
  assert.ok(t.includes("from a") && t.includes("from b"), t)
})
check("many deletes at once are held, then let through", () => {
  const a = device("a"), b = device("b")
  for (let i = 0; i < 80; i++) a.f.put(`F${i}.md`, `${i}\n`)
  settle([a, b])
  for (let i = 0; i < 80; i++) a.f.remove(`F${i}.md`)
  const r = a.r.scan()
  assert.equal(r.held, 80); assert.equal(a.r.status().held?.deletes, 80)
  settle([a, b]); assert.equal(b.f.files.size, 80)
  a.r.releaseHeld(true); a.r.scan(); settle([a, b]); assert.equal(b.f.files.size, 0)
})
check("shadow: the live folder's changes copied into the copy, a stale one never undoes a newer", () => {
  const live1 = new MemFolder(), live2 = new MemFolder()
  const mk = (id: string, live: MemFolder) => { const f = new MemFolder(), s = new MemStore(); return { f, s, live, r: new Replica({ device: id, store: s, folder: f, input: live, now }) } }
  live1.put("N.md", "a\n"); live2.put("N.md", "a\n")
  const m1 = mk("m1", live1), m4 = mk("m4", live2)
  settle([m1, m4])
  live2.put("N.md", "a\nfrom m4\n"); settle([m1, m4]) // (iCloud hasn't brought it to m1's live folder yet)
  live1.put("N.md", "a\nfrom m1\n"); settle([m1, m4])
  for (const d of [m1, m4]) assert.equal(d.f.text("N.md"), "a\nfrom m4\nfrom m1\n")
  live1.put("N.md", "a\nfrom m4\nfrom m1\n"); live2.put("N.md", "a\nfrom m4\nfrom m1\n"); settle([m1, m4])
  for (const d of [m1, m4]) assert.equal(d.f.text("N.md"), "a\nfrom m4\nfrom m1\n")
  assert.equal(live1.text("N.md"), "a\nfrom m4\nfrom m1\n") // (the live folder is only read)
})
check("a device that restarts picks up where it was", () => {
  const a = device("a"), b = device("b")
  a.f.put("R.md", "1\n"); settle([a, b])
  const again = { f: a.f, s: a.s, r: new Replica({ device: "a", store: a.s, folder: a.f, now }) }
  again.f.put("R.md", "1\n2\n"); settle([again, b])
  assert.equal(b.f.text("R.md"), "1\n2\n"); assert.equal(again.r.status().heads, 1)
})

// ---------- fuzz: 4 devices, random edits through partitions, then everyone reconnects

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

function fuzz(seed: number, steps = 120) {
  const rand = rng(seed), pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
  const ds = ["a", "b", "c", "d"].map(device)
  let token = 0
  const made = new Set<string>(), removed = new Set<string>()
  const names = ["A.md", "B.md", "C.md", "Sub/D.md", "Sub/E.md", "F.json", "G.md"]
  for (let s = 0; s < steps; s++) {
    const d = pick(ds), files = [...d.f.files.keys()], op = rand()
    if (op < 0.45 && files.length) {
      const p = pick(files)
      if (p.endsWith(".json")) {
        const t = `t${seed}-${token++}`, o = JSON.parse(d.f.text(p) || "{}"), k = pick(["k0", "k1", "k2", "k3"])
        if (typeof o[k] === "string") removed.add(o[k])
        made.add(t); d.f.put(p, JSON.stringify({ ...o, [k]: t }, null, 2) + "\n")
      }
      else {
        const lines = d.f.text(p)!.split("\n")
        const r = rand()
        if (r < 0.5) { const t = `t${seed}-${token++}`; made.add(t); lines.splice(Math.floor(rand() * lines.length), 0, t) }
        else if (r < 0.75 && lines.length > 1) { const i = Math.floor(rand() * (lines.length - 1)); if (lines[i]) removed.add(lines[i]); lines.splice(i, 1) }
        else if (lines.length > 1) { const i = Math.floor(rand() * (lines.length - 1)), t = `t${seed}-${token++}`; if (lines[i]) removed.add(lines[i]); made.add(t); lines[i] = t }
        d.f.put(p, lines.join("\n"))
      }
    } else if (op < 0.6) {
      const p = pick(names)
      if (!d.f.files.has(p)) { const t = `t${seed}-${token++}`; made.add(t); d.f.put(p, p.endsWith(".json") ? JSON.stringify({ k0: t }, null, 2) + "\n" : `${t}\n`) }
    } else if (op < 0.68 && files.length) {
      const p = pick(files), to = pick(names)
      if (!d.f.files.has(to) && p.endsWith(".json") === to.endsWith(".json")) d.f.move(p, to)
    } else if (op < 0.73 && files.length) {
      const p = pick(files)
      for (const l of d.f.text(p)!.split(/[\n"]/)) if (l.startsWith("t")) removed.add(l.trim())
      d.f.remove(p)
    }
    d.r.step()
    // (a partition: only some pairs talk this round)
    if (rand() < 0.5) { const x = pick(ds), y = pick(ds); if (x !== y) trade(x, y) }
    if (rand() < 0.1) { const i = ds.indexOf(d); ds[i] = { ...d, r: new Replica({ device: d.r.device, store: d.s, folder: d.f, now }) } } // (a restart)
  }
  settle(ds)
  const first = snap(ds[0])
  if (process.env.SYNC_DEBUG) for (const d of ds) if (snap(d) !== first) {
    const files = [...ds[0].f.files.keys(), ...d.f.files.keys()]
    for (const p of new Set(files)) if (ds[0].f.text(p) !== d.f.text(p)) {
      console.log(`differs ${p}: ${ds[0].r.device}=${JSON.stringify(ds[0].f.text(p))} ${d.r.device}=${JSON.stringify(d.f.text(p))}`)
      for (const x of [ds[0], d]) {
        const heads = [...x.r.byFile.keys()].map((f) => x.r.heads(f)).filter((hs) => hs.some((h) => h.path === p))
        console.log(`  ${x.r.device} heads at ${p}:`, heads.map((hs) => hs.map((h) => `${h.id.slice(0, 6)} ${h.blob ? "live" : "deleted"} ${h.path}`)), "wrote:", JSON.stringify(x.r.wrote.get(p)?.node.slice(0, 6)))
        const w = x.r.wrote.get(p); if (w) { const n = x.r.nodes.get(w.node)!; console.log("   its file's heads:", x.r.heads(n.file).map((h) => `${h.id.slice(0, 6)} ${h.blob ? "live" : "deleted"} ${h.path}`), "same file as f3c?", x.r.heads(n.file).some((h)=>h.id.startsWith("f3c09c")), "disk hash==", x.f.hash(p) === w.hash)
          const tp = x.r.heads(n.file)[0].path, o = x.r.wrote.get(tp); if (o) { const on = x.r.nodes.get(o.node)!; console.log("   occupant of", tp, on.id.slice(0,6), "file heads:", x.r.heads(on.file).map((h) => `${h.id.slice(0, 6)} ${h.blob ? "live" : "deleted"} ${h.path}`), "disk ok", x.f.hash(tp) === o.hash) } }
      }
    }
  }
  for (const d of ds) assert.equal(snap(d), first, `seed ${seed}: devices differ`)
  for (const d of ds) assert.equal(d.r.status().heads, d.r.byFile.size, `seed ${seed}: a file still has several heads`)
  // No line lost: every token made and never removed by a device that saw it is in a file or an open conflict.
  const kept = new Set<string>()
  const add = (t: string | null) => { for (const l of (t ?? "").split(/[\n"]/)) kept.add(l.trim()) }
  for (const p of ds[0].f.files.keys()) add(ds[0].f.text(p))
  for (const c of ds[0].r.conflicts()) add(ds[0].r.blobText(c.conflict.other))
  const lost = [...made].filter((t) => !removed.has(t) && !kept.has(t))
  if (lost.length && process.env.SYNC_DEBUG) debug(ds, lost)
  assert.deepEqual(lost, [], `seed ${seed}: lines lost`)
  ;(globalThis as any).lastDs = ds
  return ds[0].r.conflicts().length
}
let conflicts = 0
const SEEDS = Number(process.env.SYNC_FUZZ_SEEDS || 150)
for (let seed = Number(process.env.SYNC_FUZZ_FROM || 1); seed <= SEEDS; seed++) check(`fuzz ${seed}`, () => { conflicts += fuzz(seed, Number(process.env.SYNC_FUZZ_STEPS || 120)) })
console.log(`sync: ${checks} checks passed (${SEEDS} fuzz runs, ${conflicts} clashes kept as conflicts)`)
function debug(ds: Dev[], lost: string[]) {
  const r = ds[0].r, dec = new TextDecoder()
  for (const t of lost.slice(0, 1)) {
    console.log(`--- ${t}`)
    const has = (n: { blob: string | null }) => !!n.blob && dec.decode(ds[0].s.blob(n.blob) ?? new Uint8Array()).includes(t)
    const withIt = [...r.nodes.values()].filter(has)
    for (const n of withIt) {
      for (const k of r.kids.get(n.id) ?? []) {
        const c = r.nodes.get(k)!
        if (!has(c)) console.log(`lost at ${c.id.slice(0, 6)} dev=${c.device || "merge"} path=${c.path} parents=${c.parents.map((p) => p.slice(0, 6) + (has(r.nodes.get(p)!) ? "+" : "-")).join(",")} blob=${c.blob ? JSON.stringify(dec.decode(ds[0].s.blob(c.blob)!)) : "deleted"} conflict=${JSON.stringify(c.conflict ?? null)}`)
      }
      console.log(`  has: ${n.id.slice(0, 6)} dev=${n.device || "merge"} path=${n.path} ${JSON.stringify(dec.decode(ds[0].s.blob(n.blob!)!))}`)
    }
  }
}
