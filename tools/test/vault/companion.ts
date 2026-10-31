import fs from "node:fs"
import type { Any, VaultTest } from "./harness.ts"
import { fileURLToPath } from "node:url"

export default async ($: VaultTest) => {
  const { api, check, exists, read, write } = $
  // Companion (plugins/core/companion): moments in, ops out; the windows' socket is QA's (web/qa/companion.mjs).
  const c = await import("../../../plugins/core/companion/plugin.ts")
  check("companion: text found nearest the line it was said to be on", c.nearest("a\nx\nb\nx\n", "x", 4) === 6 && c.nearest("a\nx\nb\nx\n", "x") === 2 && c.nearest("abc", "z") === -1)
  check("companion: an edit replaces found text, or adds lines after a line, at the top or at the end",
    c.editText("a\nb\n", { find: "b", text: "B" }) === "a\nB\n" && c.editText("a\nb\n", { line: 1, text: "x" }) === "a\nx\nb\n" &&
    c.editText("a\nb\n", { line: 0, text: "x" }) === "x\na\nb\n" && c.editText("a\nb\n", { append: true, text: "x" }) === "a\nb\nx\n" &&
    c.editText("a\nb", { append: true, text: "x" }) === "a\nb\nx")

  {
    // @name in a line: at its start any agent's name; anywhere after, only the companion's and the agents around.
    const l = await import("../../../plugins/core/companion/live.ts")
    const names = ["companion", "claude", "ada"], mid = ["claude"], ask = (s: string) => l.mentionIn(s, names, mid)
    check("companion: a line starting @name asks it what follows", ask("- [ ] @ada: fix this")?.name === "ada" && ask("- [ ] @ada: fix this")?.text === "fix this" &&
      ask("@claude")?.text === "(no words: look at this)")
    check("companion: @name mid-line asks it the whole line", JSON.stringify(ask("Alright, hey how is it going @claude?")) === JSON.stringify({ name: "claude", text: "Alright, hey how is it going @claude?" }))
    check("companion: mid-line, only the agents around count, and never an email or a link", !ask("ask @ada later") && !ask("mail bob@claude.com") && !ask("x.com/@claude") && !ask("@bob hi"))
    check("companion: every @name of a line is found, where it is", JSON.stringify(l.mentionsOf("@ada and @claude, a@claude", names, mid)) === JSON.stringify([{ from: 0, to: 4, name: "ada" }, { from: 9, to: 16, name: "claude" }]))
    check("companion: a line opening with @name is an ask line (a thread), one with it mid-line stays prose", l.asksAtStart("- [ ] @ada: fix this", names, mid) &&
      l.asksAtStart("@claude how far?", names, mid) && !l.asksAtStart("how is it going @claude?", names, mid) && !l.asksAtStart("@bob hi", names, mid))
    check("companion: an @name in a person's comment asks that agent; an email or a stranger doesn't",
      c.mentioned("is this right @claude?") === "Claude" && c.mentioned("@Claude look") === "Claude" && !c.mentioned("mail bob@claude.com") && !c.mentioned("@nobody here"))
    check("companion: an @ can start a mention after a space or a line's start, not in a word", l.canMention("") && l.canMention("hey ") && l.canMention("(") && !l.canMention("bob") && !l.canMention("x.com/"))
    check("companion: an ask is sent at a pause only with words besides its @names", !l.asksSomething("@claude?", l.mentionsOf("@claude?", names, mid)) &&
      !l.asksSomething("- @claude ", l.mentionsOf("- @claude ", names, mid)) && l.asksSomething("how is it @claude?", l.mentionsOf("how is it @claude?", names, mid)))
  }
  {
    // Its threads are the Conversations panel's, in the right sidebar from the start (vau panels reads the source).
    const { panelsOf } = await import("../../../core/appsource.ts")
    const { defaultSidebars } = await import("../../../core/sidebars.ts")
    const ps = panelsOf({ id: "companion", tier: "core", dir: fileURLToPath(new URL("../../../plugins/core/companion", import.meta.url)) })
    check("companion: the Conversations panel starts in the right sidebar", ps.some((x) => x.key === "companion:conversations" && x.side === "right") &&
      defaultSidebars(ps).right.includes("companion:conversations"), ps)
  }
  {
    // Note text sent with moments: a short note whole for an ask, a few lines around an edit.
    const text = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n") + "\n"
    const ask = c.excerpt("N.md", "a\nb\n", [{ seq: 1, t: 0, kind: "ask", line: 2 }]), long = c.excerpt("N.md", text, [{ seq: 1, t: 0, kind: "ask", line: 150 }])
    const edit = c.excerpt("N.md", text, [{ seq: 1, t: 0, kind: "edit", line: 50, hunks: [{ line: 50, added: ["x", "y"], removed: [] }] }])
    check("companion: an ask comes with its note, whole when short, else the lines around it",
      ask?.from === 1 && ask.to === 2 && ask.lines.join() === "a,b" && long?.from === 110 && long.to === 190 && long.lines[0] === "line 110", [ask, long])
    check("companion: an edit comes with a few lines around what changed", edit?.from === 44 && edit.to === 57, edit)
    const para = (k: string) => `${k} ${"word ".repeat(120)}end`
    const talk = [para("p1"), "", para("p2"), "", para("p3"), "", para("p4"), "", para("p5"), "", `${para("ask")} @claude read these`, "", para("after")].join("\n")
    const told = c.excerpt("Talk.md", talk, [{ seq: 1, t: 0, kind: "ask", line: 11 }])!
    check("companion: the ask's paragraph and the three above come whole, other long lines cut",
      told.lines[10].endsWith("@claude read these") && [4, 6, 8].every((i) => told.lines[i].endsWith("end")) && [0, 2, 12].every((i) => told.lines[i].endsWith("…")), told.lines.map((l) => l.slice(-12)))
    check("companion: and reads as numbered lines", c.momentsText([], "pair", null, []).includes("Nothing yet") &&
      c.momentsText([{ seq: 1, t: 0, kind: "ask", path: "N.md", line: 2, text: "hi" }], "pair", null, [ask!]).endsWith("N.md, lines 1-2 of 2:\n   1  a\n   2  b"))
    // Timings: handed, first action, back to next; seqs restart with the server.
    const ms = [{ seq: 1, t: 1000, kind: "ask" }, { seq: 2, t: 1500, kind: "edit" }, { seq: 1, t: 9000, kind: "ask" }] as Any[]
    const acts = [{ t: 0, as: "C", op: "next" }, { t: 1100, as: "C", op: "handed", seqs: [1] }, { t: 3100, as: "C", op: "say" }, { t: 3200, as: "C", op: "next" },
      { t: 3200, as: "C", op: "handed", seqs: [2] }, { t: 4000, as: "C", op: "next" }, { t: 9000, as: "C", op: "handed", seqs: [1] }]
    const [a, e, b] = c.timings(ms, acts)
    check("companion timings: per moment, its handoff, think to the first action and total", a.handoff === 100 && a.think === 2000 && a.op === "say" && a.total === 2200 &&
      e.handoff === 1700 && e.think === undefined && e.total === 2500 && b.handoff === 0 && b.total === undefined, [a, e, b])
    const two = c.timings([{ seq: 5, t: 0, kind: "edit" }] as Any[], [{ t: 100, as: "C", op: "handed", seqs: [5] }, { t: 300, as: "Q", op: "handed", seqs: [5] },
      { t: 900, as: "Q", op: "say" }, { t: 2000, as: "C", op: "say" }])
    check("companion timings: a moment handed to two agents, a row each, and a summary each", two.length === 2 && two[0].as === "C" && two[0].think === 1900 &&
      two[1].as === "Q" && two[1].think === 600 && /\nQ \(1\): pause -, handoff 0\.3/.test(c.timingsText("2026-10-16", two)), [two, c.timingsText("2026-10-16", two)])
    check("companion timings: read as a table and a summary", /asks and replies \(2\): pause -, handoff 0\.0\/0\.1, think 2\.0\/2\.0/.test(c.timingsText("2026-10-16", [a, e, b])), c.timingsText("2026-10-16", [a, e, b]))
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
  {
    // An ask they go on writing after it went (a pause mid-dictation): before it's handed, the same ask as it reads now;
    // after, a new one with the whole line, that says so.
    const said = "One more thing, on the margin comments, color the agent's name. The \""
    const one = c.addMoment({ kind: "ask", path: "Notes/A.md", line: 7, text: said, waited: 2000 })
    const two = c.addMoment({ kind: "ask", path: "Notes/A.md", line: 7, text: `${said}You" can stay gray` })
    ;[, r] = await api("POST", "ops/companion.next", { timeout: 0 })
    check("companion: an ask written on before it's handed is one ask, as it reads now", one === two && r.moments.length === 1 && r.moments[0].text.endsWith("stay gray") && r.moments[0].waited === 2000, r.moments)
    c.addMoment({ kind: "ask", path: "Notes/A.md", line: 7, text: `${said}You" can stay gray, and the dots too` })
    c.addMoment({ kind: "ask", path: "Notes/A.md", line: 7, text: "Something else entirely" })
    ;[, r] = await api("POST", "ops/companion.next", { timeout: 0 })
    check("companion: the same ask again (Enter on its line after a restart) isn't asked twice", c.addMoment({ kind: "ask", path: "Notes/A.md", line: 7, text: "Something else entirely" }) === null)
    check("companion: once handed, a new ask with the whole line, that says it goes on; another ask is its own", r.moments.length === 2 && r.moments[0].more === one!.seq &&
      !r.moments[1].more && c.momentsText(r.moments, "quiet", null).includes("went on writing it"), r.moments)
    // Busy on an ask: its cursor keeps thinking after a first word, until it's back for more (no seen tick: it acted).
    await api("POST", "ops/companion.say", { text: "On it", path: "Notes/A.md" })
    ;[, r] = await api("POST", "ops/companion.status", {})
    check("companion: a word while it works on an ask, and it still shows thinking", r.agents.some((a: Any) => a.name === "Claude" && a.state === "thinking"), r.agents)
    await api("POST", "ops/companion.next", { timeout: 0 })
    ;[, r] = await api("POST", "ops/companion.status", {})
    check("companion: back for more, it's done: watching, no seen tick", r.agents.some((a: Any) => a.name === "Claude" && a.state === "watching" && !a.seen), r.agents)
  }

  await api("PATCH", "config/plugin/companion", { mode: "notice" })
  write("Notes/A.md", "# A\n\nCall Alice friday\n")
  const waiting = api("POST", "ops/companion.next", { timeout: 5 })
  await $.sleep(50)
  c.addMoment({ kind: "edit", path: "Notes/A.md", line: 2, hunks: [{ line: 2, added: ["Call Alice friday"], removed: [] }] })
  ;[st, r] = await waiting
  check("companion: a waiting next wakes on what the user writes (notice)", st === 200 && r.moments[0]?.kind === "edit" && r.moments[0].hunks[0].added[0] === "Call Alice friday", r)
  check("companion: with the note's lines around what they wrote", r.notes[0]?.path === "Notes/A.md" && r.notes[0].lines.includes("Call Alice friday"), r.notes)
  const edited = r.moments
  ;[, r] = await api("POST", "ops/companion.status", {})
  check("companion: handed an edit, its cursor reads it there", r.agents.some((a: Any) => a.name === "Claude" && a.state === "reading" && a.path === "Notes/A.md" && a.line === 2), r.agents)
  ;[, r] = await api("POST", "ops/companion.next", { timeout: 0 })
  const seen = r.moments
  ;[, r] = await api("POST", "ops/companion.status", {})
  check("companion: back for more without acting, it let it pass: seen, there", !seen.length && r.agents.some((a: Any) => a.name === "Claude" && a.state === "watching" && a.seen && a.path === "Notes/A.md"), r.agents)
  c.addMoment({ kind: "open", path: "Notes/A.md", line: 1 })
  await api("POST", "ops/companion.next", { timeout: 0 })
  await api("POST", "ops/companion.look", { path: "Notes/A.md", line: 1 })
  await api("POST", "ops/companion.next", { timeout: 0 })
  ;[, r] = await api("POST", "ops/companion.status", {})
  check("companion: after acting, next is no seen tick", r.agents.some((a: Any) => a.name === "Claude" && a.state === "watching" && !a.seen), r.agents)
  {
    // Going to another note wakes no one: the cursor follows there at once, and the open comes with the next moment.
    const waiting = api("POST", "ops/companion.next", { timeout: 1 })
    await $.sleep(50)
    c.addMoment({ kind: "open", path: "Notes/B.md", line: 1 })
    c.addMoment({ kind: "open", path: "Notes/C.md", line: 4 })
    ;[, r] = await api("POST", "ops/companion.status", {})
    check("companion: an open moves the cursor there, no turn needed", r.agents.some((a: Any) => a.name === "Claude" && a.path === "Notes/C.md" && a.line === 4 && a.state === "watching"), r.agents)
    ;[, r] = await waiting
    check("companion: an open alone wakes no one", r.moments.length === 0, r.moments)
    const next = api("POST", "ops/companion.next", { timeout: 3 })
    await $.sleep(50)
    c.addMoment({ kind: "edit", path: "Notes/C.md", line: 4, hunks: [{ line: 4, removed: [], added: ["New thought"] }] })
    ;[, r] = await next
    check("companion: it comes with the next moment, the last note they went to only", r.moments.map((m: Any) => `${m.kind} ${m.path}`).join() === "open Notes/C.md,edit Notes/C.md", r.moments)
  }
  {
    // Typing on, before the agent saw it: one moment, from what the line was to what it is.
    const one = c.addMoment({ kind: "edit", path: "Notes/A.md", line: 3, hunks: [{ line: 3, removed: ["Hi"], added: ["Hi or a"] }] })
    const two = c.addMoment({ kind: "edit", path: "Notes/A.md", line: 3, hunks: [{ line: 3, removed: ["Hi or a"], added: ["Hi or an", "x"] }] })
    c.addMoment({ kind: "edit", path: "Notes/A.md", line: 5, hunks: [{ line: 5, removed: [], added: ["y"] }] })
    const [, got] = await api("POST", "ops/companion.next", { timeout: 0 })
    check("companion: edits of the same lines before the agent saw them are one moment", one === two && got.moments.length === 1 &&
      JSON.stringify(got.moments[0].hunks) === JSON.stringify([{ line: 3, removed: ["Hi"], added: ["Hi or an", "x", "y"] }]), got.moments)
    check("companion: an edit of spaces alone isn't a moment", c.addMoment({ kind: "edit", path: "Notes/A.md", line: 4, hunks: [{ line: 4, removed: ["Hi."], added: ["Hi. ", ""] }] }) === null)
    check("companion: an edit elsewhere stays its own", c.mergeHunks([{ line: 3, removed: [], added: ["a"] }], [{ line: 9, removed: ["b"], added: ["c"] }]) === null)
  }
  check("companion: moments read as lines for an agent", c.momentsText(edited, "notice", { path: "Notes/A.md", line: 2 }).includes("+ Call Alice friday"))
  {
    // A drawing's moments: what changed, the scene as its window saw it (the last one), the user's pointer.
    const ms = [{ seq: 1, t: 0, kind: "edit", path: "D.excalidraw", x: 5, y: 9, changes: ["+ r1 rectangle at 0,0"], scene: "old" },
      { seq: 2, t: 1, kind: "ask", path: "D.excalidraw", find: "t1", text: "why?", scene: "1 items:\n- t1 text \"@claude why?\"" }] as Any[]
    const ex = await c.excerpts(null as Any, ms), text = c.momentsText(ms, "pair", { path: "D.excalidraw", x: 5, y: 9 }, ex)
    check("companion: a drawing's moments read with what changed and its scene, at the user's pointer", ex.length === 1 && !!ex[0].scene?.startsWith("1 items") &&
      text.includes("The user is in D.excalidraw at 5,9.") && text.includes("  + r1 rectangle at 0,0") && text.includes('- ask D.excalidraw (in t1): "why?"') && text.endsWith('- t1 text "@claude why?"'), text)
    ;[st, r] = await api("POST", "ops/companion.draw", { path: "Notes/A.md", actions: [{ op: "delete", id: "x" }] })
    check("companion: draw is for drawings", st === 400 && /isn't a drawing/.test(r.error), [st, r])
  }

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
  {
    // Three at once: one at a time, none lost or mixed.
    write("Notes/B.md", "# B\n\nOne\n")
    const all = await Promise.all(["Two", "Three", "Four"].map((t, i) => api("POST", "ops/companion.edit", { path: "Notes/B.md", after: ["One", "Two", "Three"][i], text: t })))
    check("companion: quick edits of a note go one at a time, each where the last left it", all.every(([s]) => s === 200) && read("Notes/B.md") === "# B\n\nOne\nTwo\nThree\nFour\n", [all, read("Notes/B.md")])
    check("companion: after anchors new lines to a line's text, wherever it moved", c.editText("a\nb\nc", { after: "b", line: 1, text: "x" }) === "a\nb\nx\nc")
  }
  ;[st, r] = await api("POST", "ops/companion.highlight", { path: "Notes/A.md", find: "Tuesday", keep: true })
  check("companion: a kept highlight is in the file in its colour", st === 200 && read("Notes/A.md").includes("==🟠Tuesday=="), [st, read("Notes/A.md")])
  ;[st, r] = await api("POST", "ops/companion.edit", { path: "Notes/A.md", find: "Wednesday", text: "x" })
  check("companion: an edit of text that isn't there says so", st >= 400 && /isn't in the file/.test(JSON.stringify(r)), [st, r])

  {
    // Comments and suggestions kept: a sidecar per note, read again when the server starts or another machine writes it.
    const side = (p: string) => `.vaultite/plugins/companion/comments/${p}.json`
    const kept = (p: string) => (exists(side(p)) ? JSON.parse(read(side(p))).comments : null)
    const status = async () => (await api("POST", "ops/companion.status", {}))[1].notes as Any[]
    check("companion: an item's line follows its text, or its line's text; gone, null",
      c.anchorLine("x\na\nb\n", { find: "b", line: 2 }) === 3 && c.anchorLine("x\ny\na\n", { anchor: "a", line: 1 }) === 3 &&
      c.anchorLine("x\n", { find: "b", line: 1 }) === null && c.anchorLine("x\ny\n", { line: 9 }) === 2)
    write("Kept/K.md", "# K\n\nMeet Bob\nPlan the trip\n")
    let [, cm] = await api("POST", "ops/companion.comment", { path: "Kept/K.md", find: "Bob", text: "Bob is in Lisbon." })
    const [, ln] = await api("POST", "ops/companion.comment", { path: "Kept/K.md", line: 4, text: "Which trip?" })
    const [, sg] = await api("POST", "ops/companion.suggest", { path: "Kept/K.md", find: "Plan", replace: "Book" })
    await api("POST", "ops/companion.comment", { id: cm.id, text: "Back on Friday." })
    c.answer(cm.id, "reply", "Thanks")
    let k = kept("Kept/K.md")
    check("companion: comments and suggestions are kept in the note's sidecar, replies too", k?.length === 3 && !("path" in k[0]) &&
      k.find((n: Any) => n.id === cm.id)?.replies?.map((r: Any) => r.text).join() === "Back on Friday.,Thanks" && k.find((n: Any) => n.id === ln.id)?.anchor === "Plan the trip", k)
    c.loadAll(true)
    check("companion: and read again as the server starts", (await status()).filter((n) => n.path === "Kept/K.md").map((n) => n.id).sort().join() === [cm.id, ln.id, sg.id].sort().join())
    write("Kept/K.md", "# K\n\nNew line\nAnother\nMeet Bob\nPlan the trip\n")
    c.loadAll()
    k = kept("Kept/K.md")
    check("companion: lines written above move them with their text", k.find((n: Any) => n.id === cm.id).line === 5 && k.find((n: Any) => n.id === ln.id).line === 6, k)
    write("Kept/K.md", "# K\n\nNew line\nAnother\nMeet\n")
    c.loadAll()
    k = kept("Kept/K.md")
    check("companion: their text gone, a comment stays by its last line, orphaned, a suggestion goes", k.length === 2 && k.find((n: Any) => n.id === cm.id).line === 5 &&
      k.find((n: Any) => n.id === cm.id).orphaned && k.find((n: Any) => n.id === ln.id).line === 5 && !(await status()).some((n) => n.id === sg.id), k)
    write("Kept/K.md", "# K\n\nNew line\nMeet Bob\n")
    c.loadAll()
    k = kept("Kept/K.md")
    check("companion: its text back (an undo), it's found again", k.find((n: Any) => n.id === cm.id).line === 4 && !k.find((n: Any) => n.id === cm.id).orphaned, k)
    write("Kept/K.md", "# K\n\nNew line\nAnother\nMeet\n")
    c.loadAll()
    k = kept("Kept/K.md")

    write(side("Kept/K.md"), JSON.stringify({ comments: [...k, { id: "nzz1", kind: "comment", agent: "Claude", t: 1, text: "From the phone", line: 1 }] }))
    $.app.changed([side("Kept/K.md")])
    check("companion: a sidecar another machine wrote is read again", (await status()).some((n) => n.id === "nzz1" && n.path === "Kept/K.md"))

    await api("POST", "ops/file.move", { from: "Kept/K.md", to: "Kept/Sub/L.md" })
    check("companion: moved or renamed, the sidecar follows its note", !exists(side("Kept/K.md")) && kept("Kept/Sub/L.md")?.length === 3 &&
      (await status()).filter((n) => n.path === "Kept/Sub/L.md").length === 3)
    await api("POST", "ops/file.move", { from: "Kept/Sub", to: "Kept/Moved" })
    check("companion: and with its folder", kept("Kept/Moved/L.md")?.length === 3 && !exists(side("Kept/Sub/L.md")))
    const [, del] = await api("DELETE", "file", { path: "Kept/Moved/L.md" })
    check("companion: deleted, it goes into the trash with it", kept(del.trashed)?.length === 3 && !exists(side("Kept/Moved/L.md")), del)
    await api("POST", "file/restore", { path: del.trashed })
    check("companion: and comes back with it", kept("Kept/Moved/L.md")?.length === 3 && !exists(side(del.trashed)))
    for (const n of await status()) if (n.path === "Kept/Moved/L.md") c.answer(n.id, "dismiss")
    const sc = JSON.parse(read(side("Kept/Moved/L.md")))
    check("companion: dismissed comments stay in the note's history, in its sidecar", sc.comments.length === 0 && sc.past.length === 3 && sc.past.every((n: Any) => n.dismissed), sc)
    let [, h] = await api("POST", "ops/companion.history", { path: "Kept/Moved/L.md" })
    check("companion: history lists them", h.open.length === 0 && h.past.length === 3 && h.past.some((n: Any) => n.id === cm.id && n.replies?.length === 2), h)
    c.reopen(cm.id)
    ;[, h] = await api("POST", "ops/companion.history", { path: "Kept/Moved/L.md" })
    check("companion: one reopened is back in the margin, as it was", h.open.some((n: Any) => n.id === cm.id && n.replies?.length === 2 && !n.dismissed) && h.past.length === 2, h)
    c.loadAll(true)
    ;[, h] = await api("POST", "ops/companion.history", { path: "Kept/Moved/L.md" })
    check("companion: history is read again as the server starts", h.open.length === 1 && h.past.length === 2, h)
    const back = h.past[0].id
    await api("POST", "ops/companion.comment", { id: back, text: "One more thing" })
    ;[, h] = await api("POST", "ops/companion.history", { path: "Kept/Moved/L.md" })
    check("companion: its agent's word in a dismissed thread brings it back", h.open.some((n: Any) => n.id === back && n.replies?.at(-1)?.text === "One more thing") && h.past.length === 1, h)
    await api("POST", "ops/companion.clear", {})
    await api("DELETE", "file", { path: "Kept/Moved/L.md" })
    const trashed = (await status()).length === 0
    check("companion: a note deleted takes its history to the trash", trashed && !exists(side("Kept/Moved/L.md")))
    await api("POST", "ops/companion.next", { timeout: 0 }) // (its replies and dismissals, for the replay's below)
  }

  {
    // The harness: recorded moments sent again, spaced as they came (faster with speed).
    const fs = await import("node:fs"), file = `${$.tmp}/moments.jsonl`
    fs.writeFileSync(file, [{ kind: "ask", text: "first", t: 1000 }, { kind: "ask", text: "second", t: 1400 }].map((m) => JSON.stringify(m)).join("\n"))
    ;[st, r] = await api("POST", "ops/companion.replay", { file, speed: 10 })
    await $.sleep(200)
    const [, got] = await api("POST", "ops/companion.next", { timeout: 2 })
    check("companion replay: recorded moments come again, in order", st === 200 && r.replaying === 2 && got.moments.map((m: Any) => m.text).join() === "first,second", [r, got])
  }
  {
    // Several agents: an ask goes to the one named after @, an answer to its item's agent, edit and open to the companion.
    await api("POST", "ops/companion.next", { timeout: 0 })
    await api("POST", "ops/companion.look", { path: "Notes/A.md", line: 1 })
    await api("POST", "ops/companion.next", { timeout: 0, as: "Ada" })
    const ada = api("POST", "ops/companion.next", { timeout: 5, as: "ada" })
    await $.sleep(50)
    c.addMoment({ kind: "ask", for: "ADA", path: "Notes/A.md", line: 3, text: "for Ada" })
    let [, got] = await ada
    ;[, r] = await api("POST", "ops/companion.status", {})
    check("companion: @ada is an ask for Ada alone, who shows thinking (any case)", got.moments.length === 1 && got.moments[0].text === "for Ada" &&
      r.agents.find((a: Any) => a.name === "Ada")?.state === "thinking" && r.agents.find((a: Any) => a.name === "Claude")?.state !== "thinking", [got, r.agents])
    ;[, got] = await api("POST", "ops/companion.next", { timeout: 0 })
    check("companion: and the companion doesn't get it", !got.moments.some((m: Any) => m.text === "for Ada"), got)
    c.addMoment({ kind: "ask", for: "bob", text: "who?" })
    c.addMoment({ kind: "ask", text: "plain" })
    c.addMoment({ kind: "edit", path: "Notes/A.md", hunks: [] })
    ;[, got] = await api("POST", "ops/companion.next", { timeout: 0 })
    const [, adaGot] = await api("POST", "ops/companion.next", { timeout: 0, as: "Ada" })
    check("companion: an unknown name and no name go to the companion, edits too; Ada gets none", got.moments.map((m: Any) => m.text ?? m.kind).join() === "who?,plain,edit" &&
      adaGot.moments.length === 0, [got, adaGot])
    await api("POST", "ops/companion.next", { timeout: 0, as: "Ada", watch: true })
    c.addMoment({ kind: "edit", path: "Notes/A.md", hunks: [] })
    ;[, got] = await api("POST", "ops/companion.next", { timeout: 0, as: "Ada", watch: true })
    check("companion: an agent with watch gets edits too", got.moments.some((m: Any) => m.kind === "edit"), got)
    ;[, r] = await api("POST", "ops/companion.comment", { path: "Notes/A.md", find: "Alice", text: "From Ada", as: "Ada" })
    c.answer(r.id, "reply", "Thanks Ada")
    ;[, got] = await api("POST", "ops/companion.next", { timeout: 0, as: "Ada" })
    const [, mainGot] = await api("POST", "ops/companion.next", { timeout: 0 })
    check("companion: a reply goes to the agent whose comment it is", got.moments.some((m: Any) => m.kind === "reply" && m.text === "Thanks Ada") &&
      !mainGot.moments.some((m: Any) => m.kind === "reply"), [got, mainGot])
    ;[, r] = await api("POST", "ops/companion.status", {})
    check("companion: status lists Ada, joined, in a colour of its own", r.agents.some((a: Any) => a.name === "Ada" && a.live && a.tint !== "orange") &&
      (await api("POST", "ops/companion.status", {}))[1].agents.length === 2, r.agents)
    const kept = JSON.parse(fs.readFileSync(`${c.plugin.localDir()}/tints.json`, "utf8"))
    check("companion: each agent's colour is kept, for after a restart", kept.ada === r.agents.find((a: Any) => a.name === "Ada")?.tint && kept.claude === "orange", kept)
    check("companion: an agent's name is one word", (await api("POST", "ops/companion.start", { as: "two words" }))[0] >= 400)
    // Started from the @ picker: Claude Code runs Sonnet at medium unless told; an ask while it boots waits for its first next.
    check("companion: a new Claude Code session runs Sonnet at medium, Codex its own, either what it's given",
      JSON.stringify([c.howOf("claude"), c.howOf("claude_work"), c.howOf("codex"), c.howOf("codex", "gpt-5", "high"), c.howOf("claude", "opus")]) ===
      JSON.stringify([{ model: "sonnet", effort: "medium" }, { model: "sonnet", effort: "medium" }, { model: "", effort: "" }, { model: "gpt-5", effort: "high" }, { model: "opus", effort: "medium" }]))
    await api("POST", "ops/companion.next", { timeout: 0 })
    c.starting("Bob", { path: "Notes/A.md", line: 3, model: "opus", effort: "high" })
    c.addMoment({ kind: "ask", for: "bob", path: "Notes/A.md", line: 3, text: "for Bob" })
    ;[, r] = await api("POST", "ops/companion.status", {})
    const bob = r.agents.find((a: Any) => a.name === "Bob")
    check("companion: an agent starting shows so, where it was called, with its model, and an ask to it is its own", bob?.state === "starting" && bob.path === "Notes/A.md" &&
      bob.model === "opus" && bob.effort === "high" && r.moments.some((m: Any) => m.text === "for Bob" && m.for === "Bob"), [bob, r.moments])
    ;[, got] = await api("POST", "ops/companion.next", { timeout: 0 })
    check("companion: the companion doesn't get it meanwhile", !got.moments.some((m: Any) => m.text === "for Bob"), got)
    ;[, got] = await api("POST", "ops/companion.next", { timeout: 0, as: "Bob" })
    ;[, r] = await api("POST", "ops/companion.status", {})
    check("companion: up, its first next gets the ask that waited, and it thinks on it", got.moments.length === 1 && got.moments[0].text === "for Bob" &&
      r.agents.find((a: Any) => a.name === "Bob")?.state === "thinking", [got, r.agents])
    // A name's first part picks what it runs (the setting profiles, the user's lines on the defaults); an ask to one not
    // around is its own, to start it; @claude stays the companion's while it runs Claude Code.
    const { parseProfiles, profileOf } = await import("../../../plugins/core/companion/profiles.ts")
    const table = parseProfiles(["opus: claude opus", "sol: codex gpt-6.1-sol medium", "nonsense", "opus: claude opus high"])
    check("companion: profiles are name: agent model effort, a later line replacing a name, a name's first part picking one",
      JSON.stringify([profileOf("Opus-review", table), profileOf("sol", table), profileOf("bob", table), profileOf("opus2", table)]) ===
      JSON.stringify([{ agent: "claude", model: "opus", effort: "high" }, { agent: "codex", model: "gpt-6.1-sol", effort: "medium" }, null, null]), table)
    check("companion: a new agent runs its name's profile, else the settings; an agent given drops the profile's model",
      JSON.stringify([c.howFor("Opus-review"), c.howFor("Luna"), c.howFor("Bob"), c.howFor("Opus-x", "codex"), c.howFor("Claude")]) ===
      JSON.stringify([{ agent: "claude", model: "opus", effort: "medium" }, { agent: "codex", model: "gpt-6-luna", effort: "medium" }, { agent: "claude", model: "sonnet", effort: "medium" },
        { agent: "codex", model: "", effort: "" }, { agent: "claude", model: "sonnet", effort: "medium" }]))
    await api("POST", "ops/companion.next", { timeout: 0 })
    c.addMoment({ kind: "ask", for: "opus-review", path: "Notes/A.md", line: 3, text: "for Opus" })
    c.addMoment({ kind: "ask", for: "claude", path: "Notes/A.md", line: 3, text: "for the companion" })
    ;[, got] = await api("POST", "ops/companion.next", { timeout: 0 })
    ;[, r] = await api("POST", "ops/companion.status", {})
    const opus = r.agents.find((a: Any) => a.name === "Opus-review")
    check("companion: @opus-review, not around, is its own (Claude Code, in Claude Code's colour unless taken), @claude the companion's",
      got.moments.map((m: Any) => m.text).join() === "for the companion" && opus?.state === "thinking" && opus.runs === "claude" && opus.tint !== "orange" &&
      r.moments.some((m: Any) => m.text === "for Opus" && m.for === "Opus-review"), [got, opus])
    // An ask that finds the companion's session not running starts it: the ask waits for its first next.
    await api("POST", "ops/companion.next", { timeout: 0 })
    const woke = c.addMoment({ kind: "ask", path: "Notes/A.md", line: 3, text: "are you there" })!
    c.starting("Claude", { path: "Notes/A.md", line: 3 }, woke.seq - 1)
    ;[, got] = await api("POST", "ops/companion.next", { timeout: 0 })
    check("companion: started by an ask, its first next gets that ask", got.moments.some((m: Any) => m.text === "are you there"), got)
  }
  {
    // The cursor: dropped on a line, a point (an ask without words); its says kept, a few per agent; one pinned, a comment.
    await api("POST", "ops/companion.next", { timeout: 0 })
    write("Notes/P.md", "# P\n\nPlant the basil\nWater it\n")
    c.addMoment({ kind: "point", path: "Notes/P.md", line: 3, find: "basil", selection: "the basil" })
    let [, got] = await api("POST", "ops/companion.next", { timeout: 0 })
    ;[, r] = await api("POST", "ops/companion.status", {})
    check("companion: a dropped cursor is a point for it, with the note's lines, and it thinks there", got.moments.some((m: Any) => m.kind === "point" && m.line === 3 && m.selection === "the basil") &&
      got.notes[0]?.lines.includes("Plant the basil") && r.agents.some((a: Any) => a.name === "Claude" && a.state === "thinking" && a.find === "basil"), [got, r.agents])
    check("companion: and reads as look at this", /- point Notes\/P\.md:3: .*look at this[^\n]*\n  on the selection: "the basil"/.test(c.momentsText(got.moments, "pair", null)), c.momentsText(got.moments, "pair", null))
    for (let i = 1; i <= 12; i++) await api("POST", "ops/companion.say", { text: `Say ${i}`, path: "Notes/P.md", find: "Water" })
    const mine = c.recentSays().filter((n: Any) => n.agent === "Claude")
    check("companion: an agent's last ten says are kept", mine.length === 10 && mine[0].text === "Say 3" && mine[9].text === "Say 12", mine.map((n: Any) => n.text))
    const pinned = c.pin(mine[9].id)
    ;[, r] = await api("POST", "ops/companion.status", {})
    check("companion: a say pinned is a comment, same words, same line, and no longer a bubble", pinned?.kind === "comment" && pinned.text === "Say 12" && pinned.line === 4 &&
      !r.notes.some((n: Any) => n.id === mine[9].id) && c.recentSays().find((n: Any) => n.id === mine[9].id)?.pinned === pinned.id && c.pin(mine[9].id) === null, [pinned, r.notes])
    const old = c.pin(mine[0].id)
    check("companion: an old say, gone from the screen, can be pinned too", old?.kind === "comment" && old.text === "Say 3", old)
    await api("POST", "ops/companion.clear", {})
  }
  {
    // Its edits are its own in Activity, History and Review (by its name, not Claude Code's), and the user reverts them.
    const { whoOf } = await import("../../../core/ops.ts")
    const { service } = await import("../../../core/plugins.ts")
    const code = whoOf("cli", "claude-code"), user = whoOf("app/desktop", null)
    const call = async (id: string, params: Any, who = code) => { await $.sleep(3); return (await $.app.callOp(id, params, who, { report: `cli ${id}` })).result as Any }
    const R = "Rev/Companion.md"
    await api("PUT", "file", { path: R, text: "# Plans\n\nCall Alice friday\n" })
    await $.sleep(20)
    await call("companion.edit", { path: R, find: "friday", text: "on Friday", as: "Ada" })
    const f = (await call("review.list", {}, user)).files.find((x: Any) => x.path === R)
    check("companion: its edit is in Review by its name, against the text just before", f?.by.join() === "Ada" && f.added === 1 && f.removed === 1, f)
    const [, acts] = await api("GET", "activity?actor=agent&limit=10")
    check("companion: and in Activity as Ada", acts.events.some((e: Any) => e.actor.name === "Ada" && e.paths?.includes(R)), acts.events.slice(0, 3))
    await $.sleep(20)
    await call("companion.edit", { path: R, find: "Alice", text: "Alice Park", as: "Ada" })
    const [, h] = await api("GET", `history?path=${R}`)
    check("companion: a version it wrote names it in History", h.versions.some((v: Any) => v.by === "Ada"), h.versions)
    await call("review.revert", { path: R }, user)
    check("companion: the user reverts its edits like any AI's", read(R) === "# Plans\n\nCall Alice friday\n", read(R))
    // Typed into a window: the app's save of that note is the agent's while it types, and the user's again after.
    const typing = service($.app.plugins, "activity:typing") as (p: string, name: string, ms: number) => boolean
    const save = async (text: string) => {
      await $.sleep(3)
      const end = $.app.requestStarted({ t: Date.now(), method: "PUT", route: "file", query: {}, client: "app/desktop", agent: null, command: null, ua: "", remote: "", port: 1, forwarded: false })
      const r = await api("PUT", "file", { path: R, text, base: read(R) }, $.sentBy("app/desktop"))
      end({ status: r[0], ms: 1, body: { path: R } })
    }
    typing(R, "Ada", 3000)
    await save("# Plans\n\nCall Alice Friday\n")
    typing(R, "Ada", 0)
    await save("# Plans\n\nCall Alice Friday!\n")
    const [, ev] = await api("GET", `activity?path=${R}&limit=5`)
    check("companion: the app's save of what it typed is Ada's, the user's next one theirs",
      ev.events[0]?.actor.name === "You" && ev.events.find((e: Any) => e.actor.kind === "agent")?.actor.name === "Ada", ev.events.slice(0, 3).map((e: Any) => [e.actor.name, e.text]))
  }
  {
    // A fresh session: past fresh_after moments, an idle next asks the session to hand over (once a minute), and the
    // new one is told its summary, its open threads and the last asks. (Starting one is the QA's: it runs an agent.)
    const fs = await import("node:fs")
    const file = `${c.plugin.localDir()}/session.json`
    await api("POST", "ops/companion.next", { timeout: 0 })
    fs.writeFileSync(file, JSON.stringify({ id: "claude-test0001", name: "Claude", t: Date.now(), handed: 5 }))
    c.addMoment({ kind: "ask", path: "Notes/A.md", line: 3, text: "one" })
    let [, got] = await api("POST", "ops/companion.next", { timeout: 0 })
    check("companion: moments handed are counted on its session", got.moments.length === 1 && JSON.parse(fs.readFileSync(file, "utf8")).handed === 6, got)
    let [st, txt] = await api("POST", "ops/companion.next?as=text", { timeout: 0 })
    check("companion: under fresh_after, next is as ever", st === 200 && !/fresh session/.test(String(txt)), txt)
    fs.writeFileSync(file, JSON.stringify({ id: "claude-test0001", name: "Claude", t: Date.now(), handed: 150 }))
    ;[st, txt] = await api("POST", "ops/companion.next?as=text", { timeout: 0 })
    check("companion: past it, an idle next asks for a handover", st === 200 && /Time for a fresh session/.test(String(txt)) && /vau companion handover "/.test(String(txt)), txt)
    ;[, got] = await api("POST", "ops/companion.next", { timeout: 0 })
    check("companion: and only once a minute", !got.handover, got)
    check("companion: Start fresh needs a running session", (await api("POST", "ops/companion.fresh", {}))[0] === 404)
    // A permission its session asks (Claude Code's folder trust, a tool's) shows by its cursor, until its terminal no
    // longer waits (here none runs, so at the first look).
    const t = await import("../../../plugins/core/terminal/plugin.ts")
    const ib = await import("../../../plugins/core/inbox/plugin.ts")
    ib.plugin.emit("inbox.event", { id: "e-trust", kind: "session", state: "open", source: "claude", title: "Claude Code is waiting for you", terminal: "claude-test0001",
      ask: "permission", body: "Trust this folder? It can read, edit and run files in it" })
    let [, s1] = await api("POST", "ops/companion.status", {})
    const asks = s1.agents.find((a: Any) => a.name === "Claude")?.asks
    check("companion: a permission its session asks is on its cursor", asks?.event === "e-trust" && asks.text.startsWith("Trust this folder?"), s1.agents)
    ib.plugin.emit("inbox.event", { id: "e-other", kind: "waiting", source: "claude", title: "x", terminal: "claude-elsewhere", ask: "permission", body: "x" })
    await $.sleep(2300)
    ;[, s1] = await api("POST", "ops/companion.status", {})
    check("companion: another terminal's isn't, and it goes once its terminal doesn't wait", !s1.agents.some((a: Any) => a.asks), s1.agents)
    // Its terminal ended (closed, killed): its cursor goes, the companion's too.
    await api("POST", "ops/companion.next", { timeout: 0 })
    t.plugin.emit("terminal.ended", { id: "claude-test0001", code: 0, signal: 1 })
    let [, s2] = await api("POST", "ops/companion.status", {})
    check("companion: a session that ended takes its cursor away", s2.agents.find((a: Any) => a.name === "Claude")?.state === "away", s2.agents)
    await api("POST", "ops/companion.next", { timeout: 0 })
    ;[, s2] = await api("POST", "ops/companion.status", {})
    check("companion: and it's back at its next", s2.agents.find((a: Any) => a.name === "Claude")?.state === "watching", s2.agents)
    // Stopped while its next waits (the bug: an edit then woke the dead session's next, and the cursor came back for good).
    const claude = () => api("POST", "ops/companion.status", {}).then(([, r]) => r.agents.find((a: Any) => a.name === "Claude"))
    fs.writeFileSync(file, JSON.stringify({ id: "claude-test0002", name: "Claude", t: Date.now() }))
    const dying = api("POST", "ops/companion.next", { timeout: 5, terminal: "claude-test0002" })
    await $.sleep(50)
    const t0 = Date.now()
    await api("POST", "ops/companion.stop", {})
    c.addMoment({ kind: "edit", path: "Notes/A.md", line: 8, hunks: [{ line: 8, removed: [], added: ["More on this"] }] })
    c.addMoment({ kind: "open", path: "Notes/B.md", line: 1 })
    ;[, got] = await dying
    check("companion: stopped, its waiting next is answered at once, as ended", got.ended && !got.moments.length && Date.now() - t0 < 2000, got)
    check("companion: and no edit or open brings its cursor back", (await claude())?.state === "away", await claude())
    ;[, got] = await api("POST", "ops/companion.next", { timeout: 0, terminal: "claude-test0002" })
    check("companion: a next still on its way from the ended session brings no one back", got.ended && (await claude())?.state === "away", [got, await claude()])
    // Back by any other way (a word sent before it ended): not live, no session, the watchdog takes it away, companion or not.
    await api("POST", "ops/companion.say", { text: "Late" })
    await api("POST", "ops/companion.say", { text: "Late", as: "Zed" })
    await c.tend()
    ;[, s2] = await api("POST", "ops/companion.status", {})
    check("companion: the watchdog takes a cursor with no session away, the companion's too", ["Claude", "Zed"].every((n) => s2.agents.find((a: Any) => a.name === n)?.state === "away"), s2.agents)
    await api("POST", "ops/companion.next", { timeout: 0, terminal: "claude-hand0001" })
    await c.tend()
    check("companion: one started by hand (another terminal, or none) is back at its next, and stays", (await claude())?.state === "watching", await claude())
    await api("POST", "ops/companion.next", { timeout: 0 })
    fs.rmSync(file, { force: true })
    check("companion: no session, no handover", (await api("POST", "ops/companion.handover", { summary: "x", as: "Nobody" }))[0] === 404)
    const items = [{ id: "n1", kind: "comment", agent: "Claude", t: 0, path: "A.md", line: 3, text: "Alice is away", replies: [{ by: "user", text: "Then Tuesday" }] },
      { id: "n2", kind: "say", agent: "Claude", t: 0, path: "A.md", line: 4, text: "Done" },
      { id: "n3", kind: "suggestion", agent: "Ada", t: 0, path: "A.md", find: "x", replace: "y" }] as Any[]
    const h = c.handoverText("Claude", "Working on the Lisbon trip.", items, [{ seq: 1, t: 0, kind: "ask", path: "A.md", line: 2, text: "budget?" }])
    check("companion: the fresh one is told the summary, its own open threads and the last asks", h.includes("Working on the Lisbon trip.") &&
      h.includes("- n1 comment in A.md:3") && h.includes("the user: \"Then Tuesday\"") && !h.includes("n2") && !h.includes("n3") && h.includes("budget?") && /don't greet/.test(h), h)
  }
  await api("PATCH", "config/plugin/companion", { mode: "off" })
  check("companion: off hears nothing", c.addMoment({ kind: "ask", text: "hello?" }) === null)
}
