import assert from "node:assert"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { check } from "../lib.ts"
import { ROOT, same } from "./lib.ts"

// ---------- the store refreshed as a patch (core/statepatch.ts: the server makes it, the app applies it) ----------

const sp = await import("../../../core/statepatch.ts")
const deep = (a: unknown, b: unknown) => { try { assert.deepStrictEqual(a, b); return true } catch { return false } }
/** now, made from old through a patch as the server sends it: [the result, the patch's JSON]. */
function through(old: unknown, now: unknown): [unknown, string | null] {
  const a = sp.snapshot(old), b = sp.snapshot(now, a)
  const patch = sp.patchOf(a, b)
  return [patch === null ? old : sp.applyPatch(old, JSON.parse(patch)), patch]
}
const st0 = {
  notes: Array.from({ length: 50 }, (_, i) => ({ id: `Notes/N${i}`, title: `N${i}`, body: "x".repeat(40), tags: [] })),
  files: { files: [{ path: "a.md", links: [["b", "line"]] }, { path: "b.md", links: [] }], folders: ["Notes"] },
  config: { plugins: { panels: ["search:search", "files:files"], disabled: [] }, hotkeys: {} },
  workspaces: [{ name: "One", layout: { root: { id: "g0", tabs: [{ id: "t1", to: "new" }], active: "t1" } } }, null],
  me: null, n: 3,
}
{
  const next = structuredClone(st0)
  next.notes[7].body = "changed"
  next.notes.splice(20, 1)
  next.notes.unshift({ id: "Notes/New", title: "New", body: "", tags: [] })
  const [got, patch] = through(st0, next)
  check("state patch: items changed, removed, added come out the same", deep(got, next), got)
  check("state patch: only the changed items travel", !!patch && patch.length < 600 && !patch.includes("N30"), patch)
  const g = got as typeof st0
  check("state patch: what didn't change is the same objects", g.notes[1] === st0.notes[0] && g.files === st0.files && g.config === st0.config
    && g.workspaces === st0.workspaces && g.notes[8] !== st0.notes[7])
}
check("state patch: nothing changed is null", through(st0, structuredClone(st0))[1] === null)
{
  // A note typed in (its body long): only the edit of its body travels, the rest of it the same objects.
  const long = structuredClone(st0)
  for (const n of long.notes) n.body = `${n.title}: ${"words of a long note body. ".repeat(80)}`
  const next = structuredClone(long)
  next.notes[3].body = next.notes[3].body.replace("words of", "words typed into")
  next.notes[9] = { ...next.notes[9], id: "Notes/Other", body: next.notes[9].body + "!" }
  const [got, patch] = through(long, next), g = got as typeof long
  check("state patch: a long body edited travels as its edit, another item with its id changed whole", deep(got, next) && !!patch &&
    patch.length < 3000 && patch.includes('"edit":') && patch.includes("Notes/Other") && g.notes[3].tags === long.notes[3].tags, patch?.slice(0, 300))
  let ok = true, cur: unknown = long, seed = 3
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n
  for (let round = 0; round < 100 && ok; round++) {
    const nx = structuredClone(cur) as typeof long, n = nx.notes[rnd(nx.notes.length)], at = rnd(n.body.length)
    n.body = n.body.slice(0, at) + "é😀x".slice(0, rnd(4)) + n.body.slice(at + rnd(5))
    const [g2] = through(cur, nx)
    ok = deep(g2, nx)
    cur = g2
  }
  check("state patch: 100 rounds of random edits to long bodies", ok)
  check("state patch: an edit that doesn't fit what the app has throws", (() => { try { sp.applyPatch("abc", { edit: [5, 1, ""] }); return false } catch { return true } })())
}
{
  // A long list (frozen items, as the tree's rows): one changed, one gone, one added, one moved far, exact all the same.
  const old: Readonly<{ path: string; n: number }>[] = Array.from({ length: 6000 }, (_, i) => Object.freeze({ path: `f${i}.md`, n: i }))
  const next = [...old]
  next[100] = Object.freeze({ path: "f100.md", n: -1 })
  next.splice(2000, 1)
  next.splice(3000, 0, Object.freeze({ path: "new.md", n: 0 }))
  next.push(next.splice(10, 1)[0])
  const [got, patch] = through(old, next)
  check("state patch: a long list's changes come out the same, small", deep(got, next) && !!patch && patch.length < 400, patch?.slice(0, 400))
}
{
  const next = structuredClone(st0)
  next.workspaces[0]!.layout.root.tabs.push({ id: "t2", to: "file:a.md" })
  const [got, patch] = through(st0, next)
  check("state patch: a workspace's tabs, and nothing else", deep(got, next) && !!patch && patch.startsWith('{"keys":{"workspaces":') && (got as typeof st0).notes === st0.notes, patch)
}
{
  const next: Record<string, unknown> = structuredClone(st0)
  delete next.me
  next.added = { x: 1 }
  ;(next.config as typeof st0.config).plugins.panels.reverse()
  const [got, patch] = through(st0, next)
  check("state patch: keys dropped and added, key order kept", deep(got, next) && same(Object.keys(got as object), Object.keys(next)), [patch, Object.keys(got as object)])
}
{
  // Keys in another order than before, keys that are integers, a key named __proto__: exact all the same.
  const old = { a: 1, b: { c: 2 }, "10": "x" }, now = JSON.parse('{"b": {"c": 3}, "a": 1, "2": "y", "__proto__": {"p": 1}}')
  const [got] = through(old, now)
  check("state patch: reordered keys, integer keys and __proto__", deep(got, now) && same(Object.keys(got as object), Object.keys(now)) && Object.getPrototypeOf(got) === Object.prototype, got)
}
{
  // Whole values where a piece changed its kind, and random edits to lists.
  let ok = true
  let seed = 7
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n
  let cur: unknown[] = Array.from({ length: 30 }, (_, i) => ({ i }))
  for (let round = 0; round < 200 && ok; round++) {
    const next = [...cur]
    for (let k = rnd(4); k >= 0; k--) {
      const op = rnd(4), at = rnd(next.length + 1)
      if (op === 0) next.splice(at, 0, { i: 1000 + round * 10 + k })
      else if (op === 1 && next.length) next.splice(at % next.length, 1)
      else if (op === 2 && next.length) next[at % next.length] = { i: -round }
      else next.push(next[rnd(next.length)] ?? null)
    }
    const [got] = through(cur, next)
    ok = deep(got, next)
    cur = got as unknown[]
  }
  check("state patch: 200 rounds of random list edits (duplicates too)", ok)
  check("state patch: a list that became an object, and back", deep(through([1, 2], { a: 1 })[0], { a: 1 }) && deep(through({ a: 1 }, [1, 2])[0], [1, 2]))
}
check("state patch: one that doesn't fit what the app has throws (it then loads it all)", (() => {
  try { sp.applyPatch([1, 2], { items: [[0, 5]] }); return false } catch { /* the right answer */ }
  try { sp.applyPatch(null, { keys: { a: { set: 1 } } }); return false } catch { return true }
})())
check("state patch: the JSON from pieces is the value's", deep(JSON.parse(sp.jsonOf(sp.snapshot(st0))), st0))

const tl = await import(pathToFileURL(path.join(ROOT, "core", "timeline.ts")).href)
const lines = "- 2026-09-28 · call · Talked\n  more about it\n\nA line typed here\n- no date · note · x\n- 2026-09-01 · note · Fact"
check("timeline: lines that aren't entries are kept to show (continuation lines aren't)", same(tl.strayLines(lines), ["A line typed here", "- no date · note · x"])
  && tl.parseTimeline(lines).length === 2, tl.strayLines(lines))
