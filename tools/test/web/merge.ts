import { check, cpuMs } from "../lib.ts"
import { merge, same } from "./lib.ts"

// ---------- the editor's merge (the server's core/textedit.ts) ----------

{
  // A save's edit (core/texthash.ts): made on its base, it's the text, whatever the two share or don't.
  const { editOf, applyEdit } = await import("../../../core/texthash.ts")
  const pairs = [["", ""], ["", "abc"], ["abc", ""], ["aaa", "aa"], ["abcabc", "abc"], ["one two", "one 2 two"], ["x😀y", "x😃y"], ["same", "same"]]
  const bad = pairs.filter(([a, b]) => applyEdit(a, editOf(a, b)) !== b)
  check("save edits: an edit made on its base is the text", !bad.length && editOf("a long line", "a longer line").add === "er", bad)
  check("save edits: one that doesn't fit is none", applyEdit("abc", { at: 2, cut: 5, add: "" }) === null && applyEdit("abc", { at: 1 }) === null)
}

const base = "a\nb\nc\nd\n"
check("merge: changes on both sides in different lines are both kept", merge.merge3(base, "A\nb\nc\nd\n", "a\nb\nc\nD\n") === "A\nb\nc\nD\n",
  merge.merge3(base, "A\nb\nc\nd\n", "a\nb\nc\nD\n"))
check("merge: the same line changed on both sides is a conflict", merge.merge3(base, "a\nX\nc\nd\n", "a\nY\nc\nd\n") === null)
check("merge: the same change on both sides is kept once", merge.merge3(base, "a\nX\nc\nd\n", "a\nX\nc\nd\n") === "a\nX\nc\nd\n")
check("merge: nothing changed on disk gives mine", merge.merge3(base, "a\nb\nnew\nc\nd\n", base) === "a\nb\nnew\nc\nd\n")
// Past a conflict: the rest merged, the clashing lines kept as mine and listed with theirs.
{
  const base6 = "one\ntwo\nthree\nfour\nfive\nsix with a long line"
  const r = merge.mergeClashes(base6, "ONE\ntwo\nthree\nfour\nfive\nsix with a long line I kept typing", "one\ntwo\nthree\nFOUR\nfive\nsix with a lo")
  check("merge: clashes keep mine and merge the rest", r.text === "ONE\ntwo\nthree\nFOUR\nfive\nsix with a long line I kept typing"
    && same(r.clashes, [{ at: 5, mine: ["six with a long line I kept typing"], theirs: ["six with a lo"] }]), r)
  const ins = merge.mergeClashes("a\nb", "a\nmine\nb", "a\ntheirs\nb")
  check("merge: two insertions at one place clash", same(ins.clashes, [{ at: 1, mine: ["mine"], theirs: ["theirs"] }]) && ins.text === "a\nmine\nb", ins)
  const del = merge.mergeClashes("a\nb\nc", "a\nc", "a\nB\nc")
  check("merge: a line deleted here and changed there clashes", same(del.clashes, [{ at: 1, mine: [], theirs: ["B"] }]) && del.text === "a\nc", del)
  check("merge: no clash where merge3 merges", same(merge.mergeClashes(base, "A\nb\nc\nd\n", "a\nb\nc\nD\n"), { text: "A\nb\nc\nD\n", clashes: [] }))
}
check("merge: opcodes", same(merge.opcodes(["a", "b", "c"], ["a", "x", "c"]), [["equal", 0, 1, 0, 1], ["replace", 1, 2, 1, 2], ["equal", 2, 3, 2, 3]]),
  merge.opcodes(["a", "b", "c"], ["a", "x", "c"]))

// A line diff at any size (File history's): what it says equal is equal, and it rebuilds the other side exactly.
{
  const { diffLines } = await import("../../../core/linediff.ts")
  const rebuilds = (a: string[], b: string[]) => {
    const out: string[] = []
    let i = 0, j = 0
    for (const [tag, i1, i2, j1, j2] of diffLines(a, b)) {
      if (i1 !== i || j1 !== j) return false
      if (tag === "equal" && a.slice(i1, i2).join("\n") !== b.slice(j1, j2).join("\n")) return false
      for (let k = j1; k < j2; k++) out.push(b[k])
      i = i2; j = j2
    }
    return i === a.length && j === b.length && out.join("\n") === b.join("\n")
  }
  const rnd = (n: number) => Math.floor(Math.random() * n)
  let ok = true
  for (let k = 0; k < 500 && ok; k++) {
    const a = Array.from({ length: rnd(30) }, () => String(rnd(5))), b = a.slice()
    for (let e = rnd(6); e > 0; e--) { const p = rnd(b.length + 1); if (rnd(2)) b.splice(p, 1); else b.splice(p, 0, String(rnd(7))) }
    ok = rebuilds(a, b)
  }
  check("diff: random small edits are told right", ok)
  const big = Array.from({ length: 300_000 }, (_, k) => `line ${k}`), edited = big.slice()
  edited.splice(150_000, 1, "changed"); edited.splice(10, 0, "added")
  // (its CPU time, which a busy machine doesn't stretch: a quadratic diff takes minutes here)
  const { value: ops, ms: took } = cpuMs(() => diffLines(big, edited))
  check("diff: 300k lines, two edits, quickly and exactly", rebuilds(big, edited) && ops.filter((o) => o[0] !== "equal").length === 2 && took < 10_000,
    [ops.length, took])
  const x = Array.from({ length: 50_000 }, (_, k) => String(k % 3)), y = x.slice().reverse()
  check("diff: what's too tangled to compare is still right", rebuilds(x, y))
}

// A change on disk shown in the editor: one change per changed run, so a cursor between them stays put.
{
  const apply = (a: string, cs: { from: number; to: number; insert: string }[]) => {
    let out = "", at = 0
    for (const c of cs) { out += a.slice(at, c.from) + c.insert; at = c.to }
    return out + a.slice(at)
  }
  const cases: [string, string][] = [["", "x"], ["x", ""], ["x", "x\ny"], ["x\ny", "x"], ["x\n", "x"], ["a\nb\nc", "b\nc"],
    ["a\n\nb\n", "a\n\nb\nc\n"], ["one\ntwo\nthree\n", "ONE\ntwo\nTHREE\n"], ["a\nb", "a\nb\n\n"], ["\n\n", "\n"]]
  // and random ones
  let seed = 7
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  const words = ["a", "b", "", "c d", "e"]
  const text = () => Array.from({ length: rnd(7) }, () => words[rnd(words.length)]).join("\n")
  for (let i = 0; i < 300; i++) cases.push([text(), text()])
  const bad = cases.filter(([a, b]) => {
    const cs = merge.textChanges(a, b)
    const sorted = cs.every((c, k) => c.from <= c.to && (k === 0 || cs[k - 1].to <= c.from))
    return !sorted || apply(a, cs) !== b
  })
  check("merge: a change on disk as the editor's changes gives the new text", !bad.length, bad.slice(0, 3))
  const cs = merge.textChanges("one\ntwo\nthree\n", "ONE\ntwo\nTHREE\n")
  check("merge: two places changed are two changes, the line between untouched", cs.length === 2 && cs[0].to <= 4 && cs[1].from >= 8, cs)
}
