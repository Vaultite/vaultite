import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, exists, read, write } = $
  const { act, actHeard } = $.vars
  // ---------- Activity's recaps (Recaps/<date>.md): what you did each day, from File history's versions and the events ----------
  {
  const rc = await import("../../../plugins/core/activity/recap.ts")
  const bq = await import("../../../plugins/core/activity/build.ts")
  check("recap: a task's text without the Tasks plugin's fields, Dataview's or a block id", rc.taskLine("- [x] Pay rent 🔼 📅 2026-10-05 ✅ 2026-10-06 ^ab1")?.title === "Pay rent" &&
    rc.taskLine("  * [ ] Pay [due:: 2026-10-05] the rent")?.title === "Pay the rent" && rc.taskLine("- plain") === null, rc.taskLine("- [x] Pay rent 🔼 📅 2026-10-05 ✅ 2026-10-06 ^ab1"))
  check("recap: a quoted line keeps links and images, not tags, embeds or callout heads", bq.quoteLine("A #tag and ![[Note]] and ![[pic.png]]") === "A \\#tag and [[Note]] and ![[pic.png]]" &&
    bq.quoteLine("> [!quote]+ Updated on today") === "" && bq.quoteLine("## Plan") === "**Plan**" && bq.quoteLine("```js") === "", bq.quoteLine("A #tag and ![[Note]] and ![[pic.png]]"))
  const md = "Mine above\n\n- 09:12 Captured [[A/B|B]] · Raindrop\n  > quoted\n- 9:30 Edited [[C]] · 1 change\n  - item\n\nMine below\n"
  const pr = rc.parseRecap(md)
  check("recap: parsed leniently, your own lines kept around the entries", pr.entries.length === 2 && pr.entries[0].kind === "captured" && pr.entries[1].time === "09:30" &&
    pr.entries[1].items[0] === "item" && rc.renderRecap(pr.entries, pr) === md.replace("- 9:30", "- 09:30"), rc.renderRecap(pr.entries, pr))

  const HOUR = 3_600_000
  {
    // Links go where files are now: an agent's report archived since, a file renamed twice that day.
    const d0 = new Date(2026, 9, 5).getTime(), t = d0 + 9 * HOUR, here = new Set(["Inbox/.archive/Rep.md", "Rc2/C.md", "Rc2/D.md", "Rc2/Old D.md"])
    const ev = (n: number, action: string, kind: string, paths: string[]) => ({ id: `e${n}`, t: t + n * 60_000, action, text: "", paths, actor: { kind, name: kind === "agent" ? "Claude Code" : "You" } })
    const got = await bq.buildRecap({ from: d0, to: d0 + 24 * HOUR, changed: ["Inbox/Rep.md", "Rc2/D.md"], captureFolders: [],
      events: [ev(0, "create", "agent", ["Inbox/Rep.md"]), ev(5, "move", "you", ["Rc2/A.md", "Rc2/B.md"]), ev(6, "move", "you", ["Rc2/B.md", "Rc2/C.md"]),
        ev(7, "move", "you", ["Rc2/D.md", "Rc2/Old D.md"]), ev(8, "create", "agent", ["Rc2/D.md"])] as Any,
      versions: async (rel) => ({ gone: false, versions: rel === "Inbox/Rep.md" ? [{ t }] : rel === "Rc2/D.md" ? [{ t: t + 8 * 60_000 }] : [] }), text: async () => "A report\n",
      exists: (rel) => here.has(rel), kindOf: () => ({ life: false, log: false }) })
    const lines = got.flatMap((e) => [e.text, ...e.items])
    check("recap: links go to where files are now (archived, renamed)", lines.includes("[[Inbox/.archive/Rep|Rep]]") && lines.filter((l) => l.startsWith("Moved [[Rc2/C|C]]")).length === 2, lines)
    check("recap: a path made again after its file moved links to the new file", lines.some((l) => l.includes("[[Rc2/D|D]]")) && !lines.some((l) => /Created.*Old D/.test(l)), lines)
  }
  // Its days are today and yesterday: one run spanning midnight would split them, so a run just before it waits.
  const toMidnight = new Date().setHours(24, 0, 0, 0) - Date.now()
  if (toMidnight < 60_000) await new Promise((r) => setTimeout(r, toMidnight + 1000))
  const localDay = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
  const Y = +midnight - 2 * HOUR, Y2 = +midnight - 26 * HOUR // yesterday 22:00, the day before's
  const at = (rel: string, text: string, t: number) => { write(rel, text); fs.utimesSync(path.join(VAULT, rel), t / 1000, t / 1000) }
  // A sync, and File history done reading what it found (it reads after the sync answers).
  const settled = async () => { await api("GET", "state"); await api("GET", "history?path=Rc/Idea.md") }
  write(".vaultite/plugins/activity/data.json", JSON.stringify({ capture_folders: ["Rc/Transcripts"] }))
  write(".obsidian/plugins/obsidian-tasks-plugin/data.json", JSON.stringify({ statusSettings: { coreStatuses: [], customStatuses: [{ symbol: "d", name: "Delegated", type: "DONE" }] } }))
  at("Rc/Open.md", "- [ ] Call the bank 📅 2026-10-05\n- [ ] Print the flyers\n  - Reason: the venue has screens\n- [ ] Take out the trash 🔁 every week 📅 2026-10-06\n- [ ] Ask Alice\n", Y2)
  at("Rc/Closed.md", "# Closed\n", Y2)
  at("Rc/Idea.md", "# Idea\n\nFirst thought\n", Y2)
  at("Rc/Phone.md", "Old\n", Y2)
  at("Rc/Props.md", "---\nstatus: a\n---\nBody\n", Y2)
  at("Rc/Gone.md", "bye\n", Y2)
  at("Rc/Away.md", "moving\n", Y2)
  at("Rc/Done.md", "done\n", Y2)
  await settled()
  at("Rc/Idea.md", "# Idea\n\nFirst thought\nYesterday's line\n", Y)
  await settled()
  await api("POST", "ops/activity.recap", {}) // (asked just before: what follows is still in the next one)
  // Today: an edit in the app, tasks done, moved, dropped, recurring and in a status of the Tasks plugin's own.
  await actHeard("PUT", "file", { path: "Rc/Idea.md", text: "# Idea\n\nFirst thought\nYesterday's line\nToday's #line about [[Lighthouse]]\n" }, "app/desktop")
  write("Rc/Open.md", "- [-] Print the flyers ❌ 2026-10-06\n  - Reason: the venue has screens\n- [ ] Take out the trash 🔁 every week 📅 2026-10-13\n- [x] Take out the trash 🔁 every week 📅 2026-10-06 ✅ 2026-10-06\n- [d] Ask Alice\n")
  write("Rc/Closed.md", "# Closed\n- [x] Call the bank 📅 2026-10-05 ✅ 2026-10-06\n")
  write("Rc/Phone.md", "Old\nTyped on the phone\n") // arrives on disk, like iCloud
  write("Rc/Props.md", "---\nstatus: b\n---\nBody\n")
  for (let i = 0; i < 5; i++) write(`Rc/Raindrop/Bookmark ${i}.md`, `---\nraindrop_id: ${100 + i}\nlink: https://example.com/${i}\n---\n# Metadata\nSource URL:: https://example.com/${i}\n# Bookmark ${i}\nWhat page ${i} says.\n`)
  write("Rc/Clip.md", "---\nsource: https://example.org/a-page\n---\nThe page's text.\n")
  write("Rc/Transcripts/Call.md", "Hello, this is the call.\n")
  write("Rc/Agent.md", "An agent's note\n")
  write("Rc/Report.md", "---\ntype: inbox\nfrom: Claude Code\nagent: claude\n---\n\nWhat it did.\n") // an agent's report, from another machine
  write("Rc/Scratch.md", "a scratch\n")
  app.changed(["Rc/Phone.md", "Rc/Agent.md"])
  await api("POST", "activity/hook?agent=claude&terminal=claude-rc", { tool_name: "Write", tool_input: { file_path: path.join(VAULT, "Rc/Agent.md") } })
  await actHeard("POST", "logs", [{ area: "workouts", date: localDay(), source: "claude", ext_id: "rc-1", title: "Recap run" }], "cli", "claude-code")
  const logFile = (fs.readdirSync(path.join(VAULT, "Logs"), { recursive: true }) as string[]).find((f) => f.endsWith(".md") && read(`Logs/${f}`).includes("ext_id: rc-1"))
  app.changed([`Logs/${logFile}`]) // (the watcher's news, which ties it to the request that wrote it)
  await actHeard("DELETE", "file?path=Rc/Gone.md", undefined, "app/desktop")
  await settled()
  await actHeard("DELETE", "file?path=Rc/Scratch.md", undefined, "app/desktop")
  at("Rc/.archive/Done.md", "done\n", Y2) // an inbox item marked done: archived, not deleted
  await actHeard("DELETE", "file?path=Rc/Done.md", undefined, "app/desktop")
  await actHeard("POST", "file/move", { from: "Rc/Away.md", to: "Rc/Moved/Away.md" }, "app/desktop")
  await settled()
  await new Promise((r) => setTimeout(r, 2800))
  const recap = async (body: object = {}) => (await api("POST", "ops/activity.recap", body))[1]
  let [today] = (await recap()).days
  const texts = today.entries.map((e: Any) => e.text) as string[]
  const has = (re: RegExp) => today.entries.find((e: Any) => re.test(e.text))
  check("recap: an edit in the app, with the text it added quoted", has(/^Edited \[\[Rc\/Idea\|Idea\]\] · 1 change$/)?.quote.join() === "Today's \\#line about [[Lighthouse]]", texts)
  check("recap: a task done in one file and moved to another is one, from and to", has(/^Completed "Call the bank" · \[\[Rc\/Open\|Open\]\] → \[\[Rc\/Closed\|Closed\]\]$/), texts)
  check("recap: a recurring task done once, its next copy not new", texts.filter((t) => /Take out the trash/.test(t)).length === 1 && has(/^Completed "Take out the trash" · \[\[Rc\/Open/), texts)
  check("recap: a task cancelled, with its reason", has(/^Cancelled "Print the flyers"/)?.quote[0] === "Reason: the venue has screens", texts)
  check("recap: a Tasks plugin status of its own", has(/^Completed "Ask Alice"/), texts)
  check("recap: an edit that arrived on disk is yours", has(/^Edited \[\[Rc\/Phone\|Phone\]\]/)?.quote[0] === "Typed on the phone", texts)
  check("recap: only properties changed is nothing", !texts.some((t) => t.includes("Props")) && !has(/Edited \[\[Rc\/Open/) && !has(/Edited \[\[Rc\/Closed/), texts)
  const batch = has(/^Captured 5 notes · Raindrop$/)
  check("recap: a bookmarks sync is one capture, its files listed", batch?.items.length === 5 && batch.items[0] === "[[Rc/Raindrop/Bookmark 0|Bookmark 0]]", texts)
  check("recap: a page saved from the web, and a capture folder's file", has(/^Captured \[\[Rc\/Clip\|Clip\]\] · example\.org$/)?.quote[0] === "The page's text." &&
    has(/^Captured \[\[Rc\/Transcripts\/Call\|Call\]\] · Transcripts$/), texts)
  const agent = has(/^Claude Code changed \d+ files?/)
  check("recap: an agent's edits are one line for its session, listed", agent?.kind === "agent" && agent.items.includes("[[Rc/Agent|Agent]]") && !has(/^Created \[\[Rc\/Agent/), texts)
  check("recap: a log an agent made is yours to remember, by it", has(/^Logged \[\[.*Recap run.*\]\] · by Claude Code$/), texts)
  check("recap: a report that names its agent is the agent's; a scratch made and deleted, an archived file, aren't told",
    today.entries.some((e: Any) => e.kind === "agent" && e.items.includes("[[Rc/Report|Report]]")) && !texts.some((t) => /Scratch|Deleted Done/.test(t)), texts)
  check("recap: deleted and moved", has(/^Deleted Gone$/) && has(/^Moved \[\[Rc\/Moved\/Away\|Away\]\] · from Rc\/Away$/), texts)
  check("recap: oldest first", today.entries.every((e: Any, i: number) => !i || today.entries[i - 1].time <= e.time), today.entries.map((e: Any) => e.time))
  const [yday] = (await recap({ date: "yesterday" })).days
  check("recap: a file changed on two days is on both (not only its last change)", yday.entries.some((e: Any) => /^Edited \[\[Rc\/Idea/.test(e.text) && e.quote[0] === "Yesterday's line") &&
    !yday.entries.some((e: Any) => /Phone|Bank/.test(e.text)), yday.entries)
  // Written to the vault, your own lines kept; the recap isn't in itself.
  const file = `Recaps/${localDay()}.md`
  await recap({ write: true })
  check("recap: written as a recap file", read(file).startsWith("---\ntype: recap\n---\n") && read(file).includes(`Completed "Call the bank"`), read(file))
  fs.writeFileSync(path.join(VAULT, file), read(file).replace("---\n\n", "---\n\nA good day.\n\n"))
  write("Rc/Idea.md", read("Rc/Idea.md") + "One more\n")
  await settled()
  await recap({ write: true })
  check("recap: written again, your own line stays and it isn't itself in it", read(file).includes("A good day.\n\n- ") && !read(file).includes("Recaps/") && read(file).includes("> One more"), read(file))
  const [, rt] = await api("GET", `render?path=${file}`)
  check("recap: its file reads as text", typeof rt === "string" && rt.includes("Call the bank"), rt)
  write("Rc/Yesterday.md", "```block-recap\ndate: yesterday\n```\n")
  const [, dt] = await api("GET", "render?path=Rc/Yesterday.md")
  check("recap: its block, for a day", typeof dt === "string" && dt.includes("Yesterday's line") && !dt.includes("Call the bank"), dt)
  const [, counts] = await api("GET", "activity/recap/counts?weeks=2")
  check("recap: each day's count by kind", counts.days[localDay()].tasks >= 3 && counts.days[localDay()].captures >= 7, counts.days[localDay()])
  // The job: yesterday's written once; deleted, it isn't made again.
  const yfile = `Recaps/${localDay(Date.now() - 86_400_000)}.md`
  await act.recapsDue()
  check("recap: the days before are written once", exists(yfile) && read(yfile).includes("Yesterday's line"), exists(yfile) && read(yfile))
  fs.rmSync(path.join(VAULT, yfile))
  await api("GET", "state")
  await act.recapsDue()
  check("recap: one you deleted isn't made again", !exists(yfile))
  fs.rmSync(path.join(VAULT, ".obsidian/plugins/obsidian-tasks-plugin"), { recursive: true })
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/activity/data.json"))
  for (const d of ["Rc", "Recaps"]) fs.rmSync(path.join(VAULT, d), { recursive: true, force: true })
  for (const f of fs.readdirSync(path.join(VAULT, "Logs"), { recursive: true }) as string[]) {
    const p = path.join(VAULT, "Logs", f)
    if (f.endsWith(".md") && fs.readFileSync(p, "utf8").includes("ext_id: rc-1")) fs.rmSync(p)
  }
  await api("GET", "state")
  }
}
