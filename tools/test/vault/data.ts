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

  // Birthdays: YYYY-MM-DD or MM-DD; the next ones soonest first, Feb 29 kept on Feb 28 in a common year.
  {
    const { nextBirthday, parseBirthday, upcoming } = await import("../../../plugins/core/people/birthdays.ts")
    const leap = parseBirthday("2000-02-29")!
    check("birthdays: Feb 29 falls on Feb 28 in a common year, on itself in a leap year",
      JSON.stringify(nextBirthday(leap, "2027-01-10")) === '{"date":"2027-02-28","days":49,"turns":27}' && nextBirthday(leap, "2028-02-29").days === 0, nextBirthday(leap, "2027-01-10"))
    check("birthdays: a past one is next year's, today's is today", nextBirthday(parseBirthday("10-16")!, "2026-10-17").date === "2027-10-16" &&
      nextBirthday(parseBirthday("1990-10-17")!, "2026-10-17").turns === 36)
    check("birthdays: only real dates", ["2001-02-29", "13-01", "10-32", "Oct 21", "1990-1-2"].every((v) => parseBirthday(v) === null) && parseBirthday("02-29") !== null)
    const order = upcoming([{ name: "B", birthday: "01-01" }, { name: "A", birthday: "12-31" }, { name: "C", birthday: "nope" }], "2026-12-30", 10)
    check("birthdays: soonest first, invalid ones left out", order.map((x) => x.person.name).join() === "A,B", order)
    check("birthdays: a YAML Date reads as its day", parseBirthday(new Date("2004-01-28T00:00:00Z"))?.year === 2004 && parseBirthday(new Date("2004-01-28"))?.day === 28)
    const { addDays, today } = await import("../../../core/plugins.ts")
    const soon = (n: number, year = "") => (year ? `${year}-` : "") + addDays(today(), n).slice(5)
    write("People/Bday Soon.md", `---\ntype: person\nbirthday: ${soon(2, "1990")}\n---\n\n\`\`\`block-person\n\`\`\`\n`)
    write("People/Bday Later.md", `---\ntype: person\nbirthday: ${soon(40)}\n---\n`)
    write("People/Bday Bad.md", "---\ntype: person\nbirthday: someday\n---\n")
    write("Notes/Birthdays.md", "```block-people-birthdays\ncount: 2\n```\n")
    const [, out] = await api("GET", "render?path=Notes/Birthdays.md")
    check("render: people-birthdays lists the next ones with how far and the age they turn", out.includes("## Birthdays") &&
      /- Bday Soon: \w{3} \d+, in 2 days, turns \d+\n- Bday Later: \w{3} \d+, in 40 days/.test(out) && !out.includes("Bday Bad"), out)
    const [, prof] = await api("GET", "render?path=People/Bday Soon.md")
    check("render: a profile says the birthday and age", /Birthday: \w{3} \d+, 1990 \(age \d+, turns \d+ in 2 days\)/.test(prof), prof)
    const [, st] = await api("GET", "state")
    check("a birthday that isn't a date is flagged on its file", st.vault.problems.some((x: Any) => x.file === "People/Bday Bad.md" && JSON.stringify(x).includes("birthday must be")), st.vault.problems)
    write("People/Bday Mix.md", "---\ntype: person\nbirthday: 03-06\n---\n")
    await api("POST", "interactions", { person: "Bday Mix", date: "2026-09-29", kind: "call", notes: "Hi" })
    await api("PUT", "people/Bday Mix", { birthday: "2004-01-28" })
    check("an API save writes a birthday unquoted, either form", read("People/Bday Mix.md").includes("\nbirthday: 2004-01-28\n"), read("People/Bday Mix.md"))
    write("People/Bday Mix.md", "---\ntype: person\nbirthday: 03-06\n---\n")
    await api("POST", "interactions", { person: "Bday Mix", date: "2026-09-29", kind: "call", notes: "Hi" })
    check("a save keeps MM-DD as written", read("People/Bday Mix.md").includes("\nbirthday: 03-06\n"), read("People/Bday Mix.md"))
    fs.rmSync(path.join(VAULT, "People/Bday Mix.md"))
    for (const f of ["People/Bday Soon.md", "People/Bday Later.md", "People/Bday Bad.md", "Notes/Birthdays.md"]) fs.rmSync(path.join(VAULT, f))
  }

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
  let [, logs] = await api("GET", "logs?area=nutrition")
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

}
