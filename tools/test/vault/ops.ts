import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, exists, read, vault, write } = $
  const { vau, same } = $.vars
  // The data plugins' operations (core/ops.ts), in-process as an agent would call them (MCP's tools have the same names and
  // parameters): defaults made once on the server (ids, the date, the source: who asked), the same answers as the tools'.
  {
    const { whoOf } = await import("../../../core/ops.ts")
    const claude = whoOf("mcp", "claude-code")
    const run = async (id: string, params: Record<string, unknown>) => {
      const hit = app.opNamed(id)!
      const go = () => app.runOp(id, params, { who: claude })
      try {
        const r = hit.op.kind === "read" || hit.op.lock === false ? await vault.synced().then(go) : await app.hold(go)
        return { error: false, text: r.op.text ? r.op.text(r.result, r.params) : JSON.stringify(r.result), result: r.result as Any }
      } catch (e) {
        return { error: true, text: (e as Error).message, result: null }
      }
    }
    await api("GET", "state") // (the plugins turned back on above)
    const tools = app.catalog().filter((e) => e.mcp).map((e) => e.mcp)
    check("ops: the MCP tools the data plugins bring", ["write_note", "write_log", "add_timeline", "remember", "clip", "inbox_add"].every((t) => tools.includes(t)), tools)
    let t = await run("note.create", { title: "Op idea: one list", body: "Every surface from it.", kind: "idea", status: "seed", tags: ["Product"] })
    const opIdea = "Notes/Op idea - one list.md"
    check("note.create: a note, its id from the title, said like write_note", !t.error && t.text === `Saved ${opIdea} (id: idea-op-idea-one-list).` && read(opIdea).includes("id: idea-op-idea-one-list") && read(opIdea).includes("tags: [Product]"), t)
    t = await run("note.create", { title: "Op idea: one list", body: "Changed.", kind: "idea" })
    check("note.create: the same title and kind again updates it", !t.error && read(opIdea).includes("Changed.") && !exists("Notes/Op idea - one list 2.md"), read(opIdea))
    t = await run("note.create", { title: "Op day", body: "Fine.", journal: true })
    check("note.create: a journal entry", !t.error && read("Notes/Op day.md").includes("tags: [Journal]"), t)
    t = await run("note.create", { title: '{"title": "Op from JSON", "body": "Given whole.", "kind": "idea"}' })
    check("note.create: the API's JSON as its one argument (vau note '<json>')", !t.error && read("Notes/Op from JSON.md").includes("Given whole.") && read("Notes/Op from JSON.md").includes("id: idea-op-from-json"), t)
    t = await run("log.create", { area: "nutrition", date: "2026-09-29", title: "Op bowl", kcal: 500 })
    const opBowl = "Logs/Nutrition/2026-09-29 Op bowl.md"
    check("log.create: its id from the area, date and title, the source who asked, a field given on its own", !t.error && t.text === `Logged ${opBowl} (id: nutrition-2026-09-29-op-bowl).` &&
      read(opBowl).includes("kcal: 500") && read(opBowl).includes("source: claude"), [t, exists(opBowl) && read(opBowl)])
    t = await run("log.create", { area: "nutrition", date: "2026-09-29", title: "Op bowl", data: { protein: 30 } })
    check("log.create: again corrects it, data merged", !t.error && read(opBowl).includes("kcal: 500") && read(opBowl).includes("protein: 30"), read(opBowl))
    t = await run("log.create", { date: "2026-09-29", title: "No area" })
    check("log.create: an area is needed", t.error && t.text.includes("area is missing"), t)
    t = await run("log.create", { title: JSON.stringify([{ area: "nutrition", date: "2026-09-29", title: "Op snack" }, { area: "nutrition", date: "2026-09-29", title: "Op tea" }]) })
    check("log.create: a list of logs as JSON", !t.error && t.text.startsWith("Logged 2: ") && exists("Logs/Nutrition/2026-09-29 Op tea.md"), t)
    t = await run("person.timeline-add", { person: "Sammy", kind: "call", text: "Talked about ops", date: "2026-09-27", duration_min: 15 })
    check("person.timeline-add: by an alias, placed by date, said like add_timeline", !t.error && t.text === "Added to Sam Reyes's timeline: 2026-09-27 · call · Talked about ops" &&
      read("People/Sam Reyes.md").includes("- 2026-09-27 · call · 15 min · Talked about ops"), [t, read("People/Sam Reyes.md")])
    // A profile with only its card: what's added goes under the card, never above it.
    write("People/Card Only.md", "---\ntype: person\n---\n\n```block-person\n```\n")
    t = await run("person.timeline-add", { person: "Card Only", kind: "call", text: "First call", date: "2026-09-27" })
    const cardTl = read("People/Card Only.md")
    check("person.timeline-add: a card-only profile keeps its card first", !t.error && cardTl.indexOf("```block-person") >= 0 && cardTl.indexOf("```block-person") < cardTl.indexOf("## Timeline"), cardTl)
    write("People/Card Two.md", "---\ntype: person\n---\n\n```block-person\n```\n")
    t = await run("people.remember", { fact: "Plays chess.", about: "Card Two" })
    t = await run("person.timeline-add", { person: "Card Two", kind: "call", text: "Hi", date: "2026-09-27" })
    const cardFact = read("People/Card Two.md")
    check("people.remember, then a timeline: card, fact, timeline, in that order", !t.error && cardFact.indexOf("```block-person") < cardFact.indexOf("Plays chess.") && cardFact.indexOf("Plays chess.") < cardFact.indexOf("## Timeline"), cardFact)
    t = await run("person.timeline-add", { person: "Sam", kind: "call", text: "x" })
    check("person.timeline-add: a first name two people have is asked about", t.error && t.text.includes("Sam Park") && t.text.includes("Sam Reyes"), t)
    t = await run("person.timeline-add", { person: "Sam Park", kind: "chat", text: "x" })
    check("person.timeline-add: an alias is written as its kind", !t.error && t.result.kind === "message" && read("People/Sam Park.md").includes("· message · x"), t)
    t = await run("person.timeline-add", { person: "Sam Park", kind: "Board games", text: "Won" })
    check("person.timeline-add: a kind of one's own is taken", !t.error && read("People/Sam Park.md").includes("· board games · Won"), t)
    t = await run("person.timeline-add", { person: "Sam Park", kind: "a · b · c", text: "x" })
    check("person.timeline-add: what wouldn't read back as a kind is refused, saying what a kind is", t.error && t.text.includes("a word or two"), t)
    t = await run("people.remember", { fact: "Keeps bees." })
    check("people.remember: about the user, under About me", !t.error && /## About me\n[\s\S]*- Keeps bees\./.test(read("ME.md")) && t.text.startsWith("Remembered in ME.md under About me"), [t, read("ME.md")])
    t = await run("people.remember", { fact: "Keeps bees." })
    check("people.remember: twice is once", !t.error && t.text === "ME.md already says that." && read("ME.md").split("Keeps bees.").length === 2, t)
    t = await run("people.remember", { fact: "Runs a bakery.", about: "Sam Park" })
    check("people.remember: about a person, from who asked", !t.error && /Runs a bakery\. \(from Claude Code, \d{4}-\d\d-\d\d\)/.test(read("People/Sam Park.md")) && t.result.person === "Sam Park", [t, read("People/Sam Park.md")])
    t = await run("people.remember", { fact: "x", about: "Nobody" })
    check("people.remember: no one by that name is an error", t.error && t.text.includes("No one called 'Nobody'"), t)
    const page = `<!doctype html><html><head><title>Beacon: a field guide</title></head><body><article><h1>Beacon: a field guide</h1>
<p>Beacon lists the birds of a park, by season, with where to look for each one and what they sound like at dawn.</p></article></body></html>`
    t = await run("clipper.save", { url: "https://beacon.example.com/guide", html: page, tags: ["Reading"] })
    check("clipper.save: a clip, said like clip", !t.error && t.text.startsWith('Clipped "Beacon: a field guide" to Clippings/Beacon - a field guide.md') && read("Clippings/Beacon - a field guide.md").includes("tags: [Reading]"), t)
    t = await run("clipper.save", { url: "https://beacon.example.com/guide", html: page })
    check("clipper.save: the same address again", !t.error && t.text.startsWith("Already clipped: Clippings/Beacon - a field guide.md"), t)
    t = await run("clipper.save", { url: "https://beacon.example.com/other", html: "~/Downloads/page.html" })
    check("clipper.save: html that's a file's name is refused, saying how", t.error && t.text.includes("--html - < page.html"), t)
    t = await run("inbox.add", { title: "Op findings", body: "## Birds\n- Wren", tldr: "Wrens, mostly." })
    check("inbox.add: from who asked, said like inbox_add", !t.error && t.text === "In the user's inbox: Inbox/Op findings.md (they'll see it marked new)." && read("Inbox/Op findings.md").includes("from: Claude Code") &&
      read("Inbox/Op findings.md").includes("> [!tldr] In short\n> Wrens, mostly.\n\n## Birds"), t)
    t = await run("inbox.list", {})
    check("inbox.list: what's new", !t.error && t.text.includes("To review:") && t.text.includes("Inbox/Op findings.md  (from Claude Code)"), t)
    // From the command line: positional words and flags as the ops' parameters, stdin for a dash.
    $.vars.stdinText = "From stdin.\n"
    let c = await vau("note", "Op from vau", "--body", "-", "--ext-id", "op-vau-1")
    check("vau note <title> --body -: the title by position, the body from stdin, --ext-id", c.code === 0 && read("Notes/Op from vau.md").includes("From stdin.") && read("Notes/Op from vau.md").includes("id: op-vau-1"), c)
    c = await vau("person", "timeline", "Sam Park", "note", "Moved", "to Lisbon", "--date", "2026-09-26")
    check("vau person timeline <who> <kind> <text...>", c.code === 0 && read("People/Sam Park.md").includes("- 2026-09-26 · note · Moved to Lisbon"), [c, read("People/Sam Park.md")])
    c = await vau("remember", "Prefers", "tea.", "--about", "preference")
    check("vau remember --about preference", c.code === 0 && /## How to work with me\n[\s\S]*- Prefers tea\./.test(read("ME.md")), [c, read("ME.md")])
    $.vars.stdinText = page
    c = await vau("clip", "https://beacon.example.com/stdin", "--html", "-", "--folder", "Notes/Reading")
    check("vau clip --html -: the page from stdin, into a folder", c.code === 0 && c.out.includes("to Notes/Reading/Beacon - a field guide.md"), c)
    $.vars.stdinText = ""
    c = await vau("note", "--json", "Op json out", "--body", "x")
    check("vau note --json: the op's answer as JSON", c.code === 0 && JSON.parse(c.out).path === "Notes/Op json out.md", c)
    {
      // Daily notes: daily-note.open makes one where they go; Obsidian's daily-notes.json names them, finds them and fills them.
      t = await run("daily-note.open", { date: "2026-09-22" })
      check("daily-note.open: a day's note made in Daily/, typed (no folder set finds them)", !t.error && t.result.path === "Daily/2026-09-22.md" && t.result.made && read("Daily/2026-09-22.md").startsWith("---\ntype: day\n---"), t)
      t = await run("daily-note.open", { date: "2026-09-22" })
      check("daily-note.open: there already, it's the same note", !t.error && t.result.path === "Daily/2026-09-22.md" && !t.result.made, t)
      // ```block-day: a day's note, or a section of it, as text; reading never makes one.
      write("Daily/2026-09-22.md", "---\ntype: day\n---\n\n## Plan\n\n- [ ] Ship the plan\n- [x] Run\n\n## Notes\n\nQuiet day.\n")
      write("Dashboards/Qa day.md", "---\ntype: dashboard\n---\n\n```block-day\nsection: Plan\ndate: 2026-09-22\n```\n\n```block-day\nsection: \"## Plan\"\ndate: 2026-09-30\n```\n\n```block-day\nsection: Lunch\ndate: 2026-09-22\n```\n")
      await vault.sync()
      let [, dayText] = await api("GET", "render?path=Dashboards/Qa day.md")
      check("block-day: a section's lines under the day and the note's path; a missing note or heading says so", dayText.includes("## Plan · 2026-09-22 (Daily/2026-09-22.md)\n\n- [ ] Ship the plan\n- [x] Run\n") &&
        !dayText.includes("Quiet day") && dayText.includes("No daily note for 2026-09-30 yet") && dayText.includes("No heading Lunch in it"), dayText)
      let [, dayAt] = await api("GET", "daily-notes/day?date=2026-09-30")
      check("block-day: the app finds where a missing day's note goes, without making it", dayAt.path === "Daily/2026-09-30.md" && !dayAt.exists && !exists("Daily/2026-09-30.md"), dayAt)
      ;[, dayAt] = await api("GET", "daily-notes/day?date=2026-09-22")
      check("block-day: an existing day's note", dayAt.path === "Daily/2026-09-22.md" && dayAt.exists, dayAt)
      fs.rmSync(path.join(VAULT, "Dashboards/Qa day.md"))
      // iCloud's copies of it (two Macs made it at once): one with nothing of its own merges in, one with text stays.
      write("Daily/2026-09-22.md", "---\ntype: day\ndone: [Gym]\n---\n\nPlan the week.\n")
      write("Daily/2026-09-22 2.md", "---\ntype: day\ndone: [Stretch]\nmood: good\n---\n")
      write("Daily/2026-09-22 3.md", "---\ntype: day\n---\n\nA thought only here.\n")
      await vault.sync()
      t = await run("daily-note.open", { date: "2026-09-22" })
      check("daily-note.open: iCloud's copy merges in and is archived; one with its own text is left",
        !t.error && read("Daily/2026-09-22.md") === "---\ntype: day\ndone: [Gym, Stretch]\nmood: good\n---\n\nPlan the week.\n" &&
        !exists("Daily/2026-09-22 2.md") && exists("Daily/.archive/2026-09-22 2.md") && exists("Daily/2026-09-22 3.md"), [t, read("Daily/2026-09-22.md")])
      // A copy that can't be tidied away now (here, the archive can't be written): the note opens all the same.
      write("Daily/2026-09-22 2.md", "---\ntype: day\n---\n")
      await vault.sync()
      fs.chmodSync(path.join(VAULT, "Daily/.archive"), 0o555)
      t = await run("daily-note.open", { date: "2026-09-22" })
      fs.chmodSync(path.join(VAULT, "Daily/.archive"), 0o755)
      check("daily-note.open: a copy that can't be merged doesn't stop the note opening", !t.error && t.result.path === "Daily/2026-09-22.md" && exists("Daily/2026-09-22 2.md"), t)
      fs.rmSync(path.join(VAULT, "Daily/2026-09-22 2.md"))
      // There on disk but not read yet (iCloud bringing it): no second one.
      fs.rmSync(path.join(VAULT, "Daily/2026-09-22.md"))
      await vault.sync()
      write(".Daily-placeholder", "")
      fs.renameSync(path.join(VAULT, ".Daily-placeholder"), path.join(VAULT, "Daily/.2026-09-22.md.icloud"))
      t = await run("daily-note.open", { date: "2026-09-22" })
      check("daily-note.open: a note iCloud is still bringing isn't made again", t.error && !exists("Daily/2026-09-22.md"), t)
      for (const f of ["Daily/.2026-09-22.md.icloud", "Daily/2026-09-22 3.md", "Daily/.archive"]) fs.rmSync(path.join(VAULT, f), { recursive: true })
      await vault.sync()
      write(".obsidian/daily-notes.json", JSON.stringify({ folder: "Journal/", format: "YYYY/MM/DD-MM-YYYY", template: "Tpl/Day.md" }))
      write("Tpl/Day.md", "---\nmood: \n---\n# {{date:dddd}}\n")
      write("Journal/2026/09/24-09-2026.md", "Rain.\n")
      write("Journal/2026/09/Plans.md", "Not a day.\n")
      let [, st] = await api("GET", "state")
      const days = st.files.files.filter((f: Any) => f.kind === "days").map((f: Any) => f.path)
      check("daily notes: one without a type is found by its name in Obsidian's folder and format", days.includes("Journal/2026/09/24-09-2026.md") && !days.includes("Journal/2026/09/Plans.md"), days)
      check("daily notes: Obsidian's settings are the defaults, never written", st.settingDefaults["plugins/daily-notes/data"]?.format === "YYYY/MM/DD-MM-YYYY" &&
        st.filing.homes.find((h: Any) => h.key === "days")?.folder === "Journal" && !exists(".vaultite/plugins/daily-notes/data.json") && !exists(".vaultite/folders.json"), [st.settingDefaults, st.filing])
      t = await run("daily-note.open", { date: "2026-09-23" })
      check("daily-note.open: named in the format, in the folder, from the template filled for that day", !t.error && t.result.path === "Journal/2026/09/23-09-2026.md" &&
        read("Journal/2026/09/23-09-2026.md") === "---\nmood: \n---\n\n# Wednesday\n", [t, exists(t.result?.path ?? "x") && read(t.result.path)])
      write(".obsidian/templates.json", JSON.stringify({ folder: "Tpl/", dateFormat: "D MMM YYYY" }))
      let [, tpl] = await api("GET", "templates")
      check("templates: Obsidian's templates.json's folder and formats, while unset", tpl.folder === "Tpl" && tpl.dateFormat === "D MMM YYYY" && tpl.timeFormat === "HH:mm", tpl)
      write(".vaultite/plugins/templates/data.json", JSON.stringify({ folder: "Templates" }))
      ;[, tpl] = await api("GET", "templates")
      check("templates: the app's own folder over Obsidian's", tpl.folder === "Templates" && tpl.dateFormat === "D MMM YYYY", tpl)
      fs.rmSync(path.join(VAULT, ".vaultite/plugins/templates/data.json"))
      fs.rmSync(path.join(VAULT, ".obsidian/templates.json"))
      write(".vaultite/plugins/daily-notes/data.json", JSON.stringify({ format: "YYYY-MM-DD", template: "" }))
      write(".vaultite/folders.json", JSON.stringify({ days: "Days" }))
      t = await run("daily-note.open", { date: "2026-09-21" })
      check("daily-note.open: the app's own settings over Obsidian's", !t.error && t.result.path === "Days/2026-09-21.md" && read(t.result.path) === "", t)
      for (const f of [".obsidian/daily-notes.json", ".vaultite/plugins/daily-notes/data.json", ".vaultite/folders.json"]) fs.rmSync(path.join(VAULT, f))
      for (const d of ["Journal", "Tpl", "Days"]) fs.rmSync(path.join(VAULT, d), { recursive: true })
      await app.vault.sync()
    }
    {
      // A kind's folder: set, new files go there whatever most of its files say; unset, back to the guess.
      write(".vaultite/folders.json", JSON.stringify({ notes: "Ideas/Fresh" }))
      t = await run("note.create", { title: "Op folder set", body: "Here." })
      check("folders.json: a new note goes in its kind's folder", !t.error && exists("Ideas/Fresh/Op folder set.md"), t)
      const [, st] = await api("GET", "state")
      check("folders.json: the state shows each kind's folder, set or guessed", st.filing.homes.some((h: Any) => h.key === "notes" && h.folder === "Ideas/Fresh" && h.set) &&
        st.filing.homes.some((h: Any) => h.key === "people" && h.folder === "People" && !h.set) && st.filing.homes.some((h: Any) => h.key === "dashboards"), st.filing.homes)
      fs.rmSync(path.join(VAULT, ".vaultite/folders.json"))
      fs.rmSync(path.join(VAULT, "Ideas"), { recursive: true })
      await app.vault.sync()
    }
    {
      // Excluded files: Obsidian's userIgnoreFilters, else files.json's: out of search, the graph and unlinked mentions.
      const hadApp = exists(".obsidian/app.json") ? read(".obsidian/app.json") : null
      write(".obsidian/app.json", JSON.stringify({ userIgnoreFilters: ["Ops/Hidden/", "/Zebra \\d+/"] }))
      write("Ops/Hidden/Secret.md", "A zebracorn, and [[Seen]].\n")
      write("Ops/Zebra 7.md", "Another zebracorn.\n")
      write("Ops/Seen.md", "A zebracorn in plain sight.\n")
      let [, hits] = await api("GET", "search?q=zebracorn")
      check("excluded files: search leaves them out", same(hits.map((h: Any) => h.path), ["Ops/Seen.md"]), hits)
      const [, st] = await api("GET", "state")
      const row = (p: string) => st.files.files.find((f: Any) => f.path === p)
      check("excluded files: still files, marked", row("Ops/Hidden/Secret.md")?.excluded === true && row("Ops/Zebra 7.md")?.excluded === true && !row("Ops/Seen.md")?.excluded, [row("Ops/Hidden/Secret.md"), row("Ops/Seen.md")])
      const [, g] = await api("GET", "graph")
      check("excluded files: the graph leaves them out", !g.nodes.some((n: Any) => n.path === "Ops/Hidden/Secret.md") && g.nodes.some((n: Any) => n.path === "Ops/Seen.md"), g.nodes.length)
      ;[, hits] = await api("GET", "search?q=zebracorn&folder=Ops/Hidden")
      check("excluded files: a search in their folder finds them", same(hits.map((h: Any) => h.path), ["Ops/Hidden/Secret.md"]), hits)
      write(".vaultite/files.json", JSON.stringify({ ...JSON.parse(exists(".vaultite/files.json") ? read(".vaultite/files.json") : "{}"), excluded: [] }))
      ;[, hits] = await api("GET", "search?q=zebracorn")
      check("excluded files: the vault's own setting (none) over Obsidian's", hits.length === 3, hits)
      const files = JSON.parse(read(".vaultite/files.json"))
      delete files.excluded
      write(".vaultite/files.json", JSON.stringify(files))
      if (hadApp === null) fs.rmSync(path.join(VAULT, ".obsidian/app.json")); else write(".obsidian/app.json", hadApp)
      for (const f of ["Ops/Hidden/Secret.md", "Ops/Zebra 7.md", "Ops/Seen.md"]) fs.rmSync(path.join(VAULT, f))
      fs.rmSync(path.join(VAULT, "Ops/Hidden"), { recursive: true })
      await app.vault.sync()
    }
    {
      // The attachment folder: files.json's, written Obsidian's way ("./sub": beside the note).
      write("Ops/Pics/Note.md", "A note.\n")
      write(".vaultite/files.json", JSON.stringify({ ...JSON.parse(exists(".vaultite/files.json") ? read(".vaultite/files.json") : "{}"), attachmentFolder: "./assets" }))
      // (held as the server holds a write op: the upload route holds the vault too, which a raw vault.lock would wedge)
      const up = await app.hold(() => app.runOp("file.upload", { data: Buffer.from("hello").toString("base64"), name: "hello.txt", note: "Ops/Pics/Note.md" }, { who: claude }))
      check("attachment folder: ./assets puts an upload beside its note", (up.result as Any).path === "Ops/Pics/assets/hello.txt", up.result)
      const files = JSON.parse(read(".vaultite/files.json"))
      delete files.attachmentFolder
      write(".vaultite/files.json", JSON.stringify(files))
      fs.rmSync(path.join(VAULT, "Ops/Pics"), { recursive: true })
      await app.vault.sync()
    }
    write("Ops/Link a.md", "Links [[Link b]] and #topic/one.\n")
    write("Ops/Link b.md", "---\ntags: [topic]\n---\n\nLinks [[Link c]].\n")
    write("Ops/Link c.md", "Nothing.\n")
    t = await run("graph.links", { path: "Link b" })
    check("graph.links: a file by its name, what links to it and what it links to", !t.error && same(t.result.in, ["Ops/Link a.md"]) && same(t.result.out, ["Ops/Link c.md"]) && t.text.startsWith("Links to Ops/Link b.md (1):"), t)
    t = await run("graph.links", { path: "Ops/Link a.md", depth: 2 })
    check("graph.links: with depth, what's further out", !t.error && t.result.further.some((x: Any) => x.path === "Ops/Link c.md" && x.dist === 2), t)
    t = await run("tag.list", {})
    check("tag.list: every tag with its count, nested ones counting for their parents", !t.error && t.result.tags.some((x: Any) => x.tag === "topic" && x.count >= 2) && t.text.includes("- #topic/one: 1"), t.result?.tags?.slice(0, 5))
    t = await run("tag.list", { tag: "#topic" })
    check("tag.list: one tag's files", !t.error && t.result.files.length === 2, t)
    t = await run("history.list", { path: "Ops/Link a.md" })
    check("history.list: a file's versions (none yet)", !t.error && t.text === "No earlier versions of Ops/Link a.md.", t)
    t = await run("calendar.events", { from: "2026-10-05" })
    check("calendar.events: with no calendars, says so", !t.error && t.text.startsWith("No calendars connected yet"), t)
    t = await run("calendar.events", { from: "2026-10-05", to: "2026-10-01" })
    check("calendar.events: a range backwards is refused", t.error, t)
    const en: string[] = vault.config("plugins").enabled
    vault.setConfig("plugins", { ...vault.config("plugins"), enabled: en.filter((x) => x !== "people") })
    check("ops: an offByDefault plugin's aren't there until it's turned on", !app.opNamed("people.remember"), app.opNamed("people.remember")?.op.id)
    vault.setConfig("plugins", { ...vault.config("plugins"), enabled: en })
    check("ops: ...and are once it is", !!app.opNamed("people.remember"))
    c = await vau("properties")
    check("vau properties: every key, counted", c.code === 0 && /^tags\s+\d+\s+list/m.test(c.out), c)
    c = await vau("tags", "topic")
    check("vau tags <tag>", c.code === 0 && c.out.includes("Ops/Link b.md"), c)
  }
}
