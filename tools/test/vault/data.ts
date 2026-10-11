import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, exists, read, sleep, vault, write } = $
  // People: API -> file
  let code: number
  let p: Any
  ;[code, p] = await api("POST", "people", { name: "Test Person", relation: "friend", every_days: 14, location: "Chicago, IL" })
  check("POST person creates the file", code === 201 && exists("People/Test Person.md"), p)
  check("a location's pin is never written to the person's file", !read("People/Test Person.md").includes("coordinates") && p.lat === null, p)
  let [, s] = await api("GET", "state")
  {
    const tp = s.people.find((x: Any) => x.name === "Test Person")
    check("its pin comes from the map's cache", tp.lat === 41.8781 && tp.lon === -87.6298, tp)
    ;[, p] = await api("PUT", "people/Test Person", { ...tp, context: "From work" })
    check("a pin the app showed, sent back whole, isn't written either", !read("People/Test Person.md").includes("coordinates") && read("People/Test Person.md").includes("context: From work"), read("People/Test Person.md"))
    const [, g] = await api("GET", "geocode?q=Nowhere at all")
    check("a place that wasn't found has no pin (no guess)", g.lat === null, g)
  }
  await api("POST", "interactions", { person: "Test Person", date: "2026-09-29", kind: "call", duration_min: 15, notes: "Hi" })
  check("interaction lands in the timeline", read("People/Test Person.md").includes("- 2026-09-29 · call · 15 min · Hi"))
  ;[code] = await api("POST", "interactions", { person: "Nobody", date: "2026-09-29", kind: "call" })
  check("unknown person is a 400", code === 400, code)
  // file -> API
  write("People/Test Person.md", read("People/Test Person.md") + "- 2026-09-01 · note · Moved to Chicago\n")
  ;[, s] = await api("GET", "state")
  let mine = s.interactions.filter((i: Any) => i.person_id === "People/Test Person")
  check("a line added to the file shows up", mine.length === 2 && mine[mine.length - 1].kind === "note", mine)
  // rename
  ;[, p] = await api("PUT", "people/Test Person", { name: "Tess Person" })
  check("rename moves the file", p.id === "People/Tess Person" && !exists("People/Test Person.md"), p)
  check("rename keeps the timeline", read("People/Tess Person.md").includes("Moved to Chicago"))
  await api("DELETE", "people/People/Tess Person")
  check("delete moves it to .trash", fs.readdirSync(path.join(VAULT, ".trash/People")).some((f) => f.startsWith("Tess Person")))

  // Notes: upsert by id, updated bumps only on content
  const n1 = (await api("POST", "notes", { ext_id: "idea-test", title: "Test: idea", body: "Hello [[Alice Park]]", kind: "idea", status: "seed" }))[1]
  check("note file name drops the colon", n1.id === "Notes/Test - idea" && read("Notes/Test - idea.md").includes("aliases: ['Test: idea']"), n1)
  await sleep(1100)
  const n2 = (await api("POST", "notes", { ext_id: "idea-test", title: "Test: idea", body: "Hello [[Alice Park]]", kind: "idea", status: "seed" }))[1]
  check("re-posting the same note is a no-op", n2.updated_at === n1.updated_at, [n1.updated_at, n2.updated_at])
  const n3 = (await api("PUT", "notes/idea-test", { status: "seed" }))[1]
  check("a no-op edit doesn't bump updated", n3.updated_at === n1.updated_at, n3)
  check("`pinned` isn't read any more", !("pinned" in n3), n3)
  const n4 = (await api("PUT", "notes/idea-test", { body: "Changed" }))[1]
  check("editing the body bumps updated", n4.updated_at > n1.updated_at, n4)
  write("Notes/Hand written.md", "Just a body.\n")
  ;[, s] = await api("GET", "state")
  check("plain Markdown in Notes is a plain file, not a note: kinds come from `type:` alone", !s.notes.some((n: Any) => n.title === "Hand written"))
  {
    const [, dry] = await api("POST", "ops/file.type", {})
    check("file.type: lists untyped files in a folder named like a kind's, writes nothing", dry.groups.some((g: Any) => g.folder === "Notes" && g.type === "note" && g.files.includes("Notes/Hand written.md")) &&
      read("Notes/Hand written.md") === "Just a body.\n", dry)
    const [, ctxt] = await api("POST", "ops/app.context?as=text", {})
    check("app.context says when files have no type", String(ctxt).includes("Without a type") && String(ctxt).includes("Notes/ "), ctxt)
    const [, done] = await api("POST", "ops/file.type", { folder: "Notes", apply: true })
    check("file.type: apply adds the line (then notes fills in its id and dates)", done.written >= 1 && read("Notes/Hand written.md").startsWith("---\ntype: note\n") && read("Notes/Hand written.md").endsWith("---\n\nJust a body.\n"), read("Notes/Hand written.md"))
    const [nk] = await api("POST", "ops/file.type", { folder: "Elsewhere" })
    check("file.type: a folder named like no kind's needs a kind", nk === 400, nk)
  }
  ;[, s] = await api("GET", "state")
  const hw = s.notes.find((n: Any) => n.title === "Hand written")
  check("typed, it's a note, its body as it was", hw && read("Notes/Hand written.md").endsWith("Just a body.\n"), hw)
  check("its id is its title's", (await api("GET", "notes/note-hand-written"))[1].title === "Hand written")
  write("Notes/Typed by hand.md", "---\ntype: note\n---\n\nA body.\n")
  await api("GET", "state")
  check("a note written outside the app stays as it was written (reading never writes)", read("Notes/Typed by hand.md") === "---\ntype: note\n---\n\nA body.\n", read("Notes/Typed by hand.md"))
  await api("PUT", "file", { path: "Notes/Typed by hand.md", text: "---\ntype: note\n---\n\nA body, edited.\n" })
  check("...edited in the app, it gets an id and times", /id: note-typed-by-hand\ncreated: '.+'\nupdated: '.+'/.test(read("Notes/Typed by hand.md")), read("Notes/Typed by hand.md"))
  const [, upd] = await api("POST", "notes", { ext_id: "note-hand-written", title: "Hand written", body: "Rewritten." })
  check("a write by its id updates the hand-written file, and only then gets the app's keys", upd.id === "Notes/Hand written" && read("Notes/Hand written.md").includes("id: note-hand-written") && read("Notes/Hand written.md").includes("Rewritten."), upd)

  // Logs: upsert on (source, ext_id), data merged
  const log = { area: "nutrition", date: "2026-09-29", source: "claude", ext_id: "meal-test", title: "Rice bowl", data: { meal: "Lunch", kcal: 650 } }
  await api("POST", "logs", [log])
  await api("POST", "logs", [{ ...log, data: { protein: 45 } }])
  let [, logs] = await api("GET", "logs?area=health")
  mine = logs.filter((l: Any) => l.ext_id === "meal-test")
  check("log upsert merges data into one file", mine.length === 1 && JSON.stringify(mine[0].data) === JSON.stringify({ meal: "Lunch", kcal: 650, protein: 45 }), mine)
  {
    const had = vault.config("plugins/logs/data")
    ;[code] = await api("POST", "logs", { area: "nope", date: "2026-09-29" })
    check("a log for a new area adds the area", code === 201 && vault.config("plugins/logs/data")?.areas?.some((a: Any) => a.slug === "nope"), [code, vault.config("plugins/logs/data")])
    if (had) vault.setConfig("plugins/logs/data", had); else vault.removeConfig("plugins/logs/data")
    fs.rmSync(path.join(VAULT, "Logs/Nope"), { recursive: true, force: true })
  }
  ;[code] = await api("POST", "logs", { area: "nutrition", date: "yesterday", title: "Lunch" })
  check("a date that isn't YYYY-MM-DD is a 400", code === 400 && !fs.readdirSync(path.join(VAULT, "Logs"), { recursive: true }).some((f) => String(f).includes("yesterday")), code)

  // Routines: ticks go to the daily note, an empty note is removed
  await api("POST", "routines", { name: "Stretch" })
  await api("POST", "checks", { routine: "Stretch", date: "2026-09-29", done: true })
  check("tick writes the daily note", read("Daily/2026-09-29.md").includes("done: [Stretch]"), read("Daily/2026-09-29.md"))
  ;[, s] = await api("GET", "state")
  check("tick shows in checks", s.checks.some((c: Any) => c.routine === "Routines/Stretch" && c.date === "2026-09-29"), s.checks)
  await api("POST", "checks", { routine: "Routines/Stretch", date: "2026-09-29", done: false })
  check("untick removes the empty note", !exists("Daily/2026-09-29.md"))
}
