import type { Any, VaultTest } from "./harness.ts"

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
    check("companion: an @ can start a mention after a space or a line's start, not in a word", l.canMention("") && l.canMention("hey ") && l.canMention("(") && !l.canMention("bob") && !l.canMention("x.com/"))
    check("companion: an ask is sent at a pause only with words besides its @names", !l.asksSomething("@claude?", l.mentionsOf("@claude?", names, mid)) &&
      !l.asksSomething("- @claude ", l.mentionsOf("- @claude ", names, mid)) && l.asksSomething("how is it @claude?", l.mentionsOf("how is it @claude?", names, mid)))
  }
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
    // Typing on, before the agent saw it: one moment, from what the line was to what it is.
    const one = c.addMoment({ kind: "edit", path: "Notes/A.md", line: 3, hunks: [{ line: 3, removed: ["Hi"], added: ["Hi or a"] }] })
    const two = c.addMoment({ kind: "edit", path: "Notes/A.md", line: 3, hunks: [{ line: 3, removed: ["Hi or a"], added: ["Hi or an", "x"] }] })
    c.addMoment({ kind: "edit", path: "Notes/A.md", line: 5, hunks: [{ line: 5, removed: [], added: ["y"] }] })
    const [, got] = await api("POST", "ops/companion.next", { timeout: 0 })
    check("companion: edits of the same lines before the agent saw them are one moment", one === two && got.moments.length === 1 &&
      JSON.stringify(got.moments[0].hunks) === JSON.stringify([{ line: 3, removed: ["Hi"], added: ["Hi or an", "x", "y"] }]), got.moments)
    check("companion: an edit elsewhere stays its own", c.mergeHunks([{ line: 3, removed: [], added: ["a"] }], [{ line: 9, removed: ["b"], added: ["c"] }]) === null)
  }
  check("companion: moments read as lines for an agent", c.momentsText(edited, "notice", { path: "Notes/A.md", line: 2 }).includes("+ Call Alice friday"))

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
    check("companion: their text gone, a comment stays by its last line, a suggestion goes", k.length === 2 && k.find((n: Any) => n.id === cm.id).line === 5 &&
      k.find((n: Any) => n.id === ln.id).line === 5 && !(await status()).some((n) => n.id === sg.id), k)

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
    check("companion: all dismissed, the sidecar and its empty folders go", !exists(side("Kept/Moved/L.md")) && !exists(".vaultite/plugins/companion/comments/Kept"))
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
    check("companion: an agent's name is one word", (await api("POST", "ops/companion.start", { as: "two words" }))[0] >= 400)
  }
  await api("PATCH", "config/plugin/companion", { mode: "off" })
  check("companion: off hears nothing", c.addMoment({ kind: "ask", text: "hello?" }) === null)
}
