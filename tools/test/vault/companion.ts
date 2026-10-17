import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, read, write } = $
  // Companion (plugins/core/companion): moments in, ops out; the windows' socket is QA's (web/qa/companion.mjs).
  const c = await import("../../../plugins/core/companion/plugin.ts")
  check("companion: text found nearest the line it was said to be on", c.nearest("a\nx\nb\nx\n", "x", 4) === 6 && c.nearest("a\nx\nb\nx\n", "x") === 2 && c.nearest("abc", "z") === -1)
  check("companion: an edit replaces found text, or adds lines after a line, at the top or at the end",
    c.editText("a\nb\n", { find: "b", text: "B" }) === "a\nB\n" && c.editText("a\nb\n", { line: 1, text: "x" }) === "a\nx\nb\n" &&
    c.editText("a\nb\n", { line: 0, text: "x" }) === "x\na\nb\n" && c.editText("a\nb\n", { append: true, text: "x" }) === "a\nb\nx\n" &&
    c.editText("a\nb", { append: true, text: "x" }) === "a\nb\nx")

  {
    // Note text sent with moments: a short note whole for an ask, a few lines around an edit.
    const text = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n") + "\n"
    const ask = c.excerpt("N.md", "a\nb\n", [{ seq: 1, t: 0, kind: "ask", line: 2 }]), long = c.excerpt("N.md", text, [{ seq: 1, t: 0, kind: "ask", line: 150 }])
    const edit = c.excerpt("N.md", text, [{ seq: 1, t: 0, kind: "edit", line: 50, hunks: [{ line: 50, added: ["x", "y"], removed: [] }] }])
    check("companion: an ask comes with its note, whole when short, else the lines around it",
      ask?.from === 1 && ask.to === 2 && ask.lines.join() === "a,b" && long?.from === 110 && long.to === 190 && long.lines[0] === "line 110", [ask, long])
    check("companion: an edit comes with a few lines around what changed", edit?.from === 44 && edit.to === 57, edit)
    check("companion: and reads as numbered lines", c.momentsText([], "pair", null, []).includes("Nothing yet") &&
      c.momentsText([{ seq: 1, t: 0, kind: "ask", path: "N.md", line: 2, text: "hi" }], "pair", null, [ask!]).endsWith("N.md, lines 1-2 of 2:\n   1  a\n   2  b"))
    // Timings: handed, first action, back to next; seqs restart with the server.
    const ms = [{ seq: 1, t: 1000, kind: "ask" }, { seq: 2, t: 1500, kind: "edit" }, { seq: 1, t: 9000, kind: "ask" }] as Any[]
    const acts = [{ t: 0, as: "C", op: "next" }, { t: 1100, as: "C", op: "handed", seqs: [1] }, { t: 3100, as: "C", op: "say" }, { t: 3200, as: "C", op: "next" },
      { t: 3200, as: "C", op: "handed", seqs: [2] }, { t: 4000, as: "C", op: "next" }, { t: 9000, as: "C", op: "handed", seqs: [1] }]
    const [a, e, b] = c.timings(ms, acts)
    check("companion timings: per moment, its handoff, think to the first action and total", a.handoff === 100 && a.think === 2000 && a.op === "say" && a.total === 2200 &&
      e.handoff === 1700 && e.think === undefined && e.total === 2500 && b.handoff === 0 && b.total === undefined, [a, e, b])
    check("companion timings: read as a table and a summary", /asks and replies \(2\): handoff 0\.0\/0\.1, think 2\.0\/2\.0/.test(c.timingsText("2026-10-16", [a, e, b])), c.timingsText("2026-10-16", [a, e, b]))
  }

  await api("PATCH", "config/plugin/companion", { mode: "quiet" })
  check("companion: quiet hears asks, not what the user writes", c.addMoment({ kind: "edit", path: "Notes/A.md", hunks: [] }) === null &&
    c.addMoment({ kind: "ask", path: "Notes/A.md", line: 3, text: "what's this?" })?.kind === "ask")
  let [st, r] = await api("POST", "ops/companion.next", { timeout: 0 })
  check("companion: next answers the ask waiting, as the companion (Claude)", st === 200 && r.moments.length === 1 && r.moments[0].text === "what's this?" && r.mode === "quiet", [st, r])
  ;[, r] = await api("POST", "ops/companion.timings", {})
  check("companion: next and what it handed are logged, for timings", r.rows.some((x: Any) => x.kind === "ask" && x.handoff !== undefined), r)
  ;[st, r] = await api("POST", "ops/companion.next", { timeout: 0 })
  check("companion: and not again", st === 200 && r.moments.length === 0, r)

  await api("PATCH", "config/plugin/companion", { mode: "notice" })
  write("Notes/A.md", "# A\n\nCall Alice friday\n")
  const waiting = api("POST", "ops/companion.next", { timeout: 5 })
  await $.sleep(50)
  c.addMoment({ kind: "edit", path: "Notes/A.md", line: 2, hunks: [{ line: 2, added: ["Call Alice friday"], removed: [] }] })
  ;[st, r] = await waiting
  check("companion: a waiting next wakes on what the user writes (notice)", st === 200 && r.moments[0]?.kind === "edit" && r.moments[0].hunks[0].added[0] === "Call Alice friday", r)
  check("companion: with the note's lines around what they wrote", r.notes[0]?.path === "Notes/A.md" && r.notes[0].lines.includes("Call Alice friday"), r.notes)
  check("companion: moments read as lines for an agent", c.momentsText(r.moments, "notice", { path: "Notes/A.md", line: 2 }).includes("+ Call Alice friday"))

  ;[st, r] = await api("POST", "ops/companion.suggest", { path: "Notes/A.md", find: "friday", replace: "Friday", why: "A day's name" })
  const id = r.id
  ;[, r] = await api("POST", "ops/companion.status", {})
  check("companion: a suggestion is kept, by its agent, Claude in orange", st === 200 && r.notes.some((n: Any) => n.id === id && n.kind === "suggestion" && n.agent === "Claude") &&
    r.agents.some((a: Any) => a.name === "Claude" && a.tint === "orange"), r)
  c.answer(id, "accept")
  ;[, r] = await api("POST", "ops/companion.next", { timeout: 0 })
  check("companion: taking it is a moment for the agent, and it's gone", r.moments.some((m: Any) => m.kind === "accept" && m.item === id && m.to === "Friday") &&
    !(await api("POST", "ops/companion.status", {}))[1].notes.some((n: Any) => n.id === id), r)

  ;[st, r] = await api("POST", "ops/companion.comment", { path: "Notes/A.md", find: "Alice", text: "Alice is away until Monday." })
  c.answer(r.id, "reply", "Then Tuesday")
  ;[, r] = await api("POST", "ops/companion.next", { timeout: 0 })
  check("companion: a reply to a comment comes back with its words", r.moments.some((m: Any) => m.kind === "reply" && m.text === "Then Tuesday"), r)

  ;[st, r] = await api("POST", "ops/companion.edit", { path: "Notes/A.md", find: "friday", text: "Tuesday" })
  check("companion: with no window showing the note, an edit is written to the file", st === 200 && r.how === "written" && read("Notes/A.md") === "# A\n\nCall Alice Tuesday\n", [st, r])
  ;[st, r] = await api("POST", "ops/companion.highlight", { path: "Notes/A.md", find: "Tuesday", keep: true })
  check("companion: a kept highlight is in the file in its colour", st === 200 && read("Notes/A.md").includes("==🟠Tuesday=="), [st, read("Notes/A.md")])
  ;[st, r] = await api("POST", "ops/companion.edit", { path: "Notes/A.md", find: "Wednesday", text: "x" })
  check("companion: an edit of text that isn't there says so", st >= 400 && /isn't in the file/.test(JSON.stringify(r)), [st, r])

  {
    // The harness: recorded moments sent again, spaced as they came (faster with speed).
    const fs = await import("node:fs"), file = `${$.tmp}/moments.jsonl`
    fs.writeFileSync(file, [{ kind: "ask", text: "first", t: 1000 }, { kind: "ask", text: "second", t: 1400 }].map((m) => JSON.stringify(m)).join("\n"))
    ;[st, r] = await api("POST", "ops/companion.replay", { file, speed: 10 })
    await $.sleep(200)
    const [, got] = await api("POST", "ops/companion.next", { timeout: 2 })
    check("companion replay: recorded moments come again, in order", st === 200 && r.replaying === 2 && got.moments.map((m: Any) => m.text).join() === "first,second", [r, got])
  }
  await api("PATCH", "config/plugin/companion", { mode: "off" })
  check("companion: off hears nothing", c.addMoment({ kind: "ask", text: "hello?" }) === null)
}
