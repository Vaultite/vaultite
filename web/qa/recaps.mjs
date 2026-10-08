// Day recaps (plugins/core/activity: Recaps/<date>.md, ```block-recap): a day as someone works from their daily note.
// Tasks ticked in the Tasks plugin's query (plugin-compat, with obsidian-tasks-plugin on: its lab), one moved from
// Open to Closed, one dropped with a reason; a note written in; a bookmarks sync (Raindrop's files) and a transcript
// arriving on disk; Claude Code writing a note and logging a run. Then the daily note's recap, the recap file, the
// Activity page's Days tab, a week, a filter, a phone. Writes: throwaway server only, its vault staged three days old
// with Tasks/Open.md, Tasks/Closed.md, Notes/Lighthouse launch.md and Raindrop/Design/Calm technology.md.
//   node web/qa/recaps.mjs <base url> <vault path>
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const file = (rel) => path.join(VAULT, rel)
const read = (rel) => { try { return fs.readFileSync(file(rel), "utf8") } catch { return "" } }
const onDisk = (rel, text) => { fs.mkdirSync(path.dirname(file(rel)), { recursive: true }); fs.writeFileSync(file(rel), text) }
const shot = (page, name) => page.screenshot({ path: path.join(os.tmpdir(), `qa-recaps-${name}.png`), fullPage: false })
const you = apiAt(B, { "x-vaultite-client": "app/desktop" })
const claude = apiAt(B, { "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" })
const pad = (n) => String(n).padStart(2, "0")
const d = new Date(), today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// The daily note, where the day is worked from: what's to do (the Tasks plugin's query) and the day's recap.
const daily = `Daily/${today}.md`
const plan = "\n```tasks\nnot done\npath includes Tasks/Open\n```\n\n```block-recap\n```\n"
await you(read(daily) ? "PUT" : "POST", "file", { path: daily, text: `${read(daily) || "---\ntype: day\n---\n\nPlan the launch today.\n"}${plan}` })
const page = watch(await browser.newPage({ viewport: { width: 1280, height: 1000 } }))
await page.goto(`${B}#file/${encodeURIComponent(daily)}`)
const tasks = page.locator('[data-fence="tasks"] li')
check("the Tasks plugin lists what's to do in the daily note", await until(async () => (await tasks.count()) >= 4, 15000), await tasks.count())
for (const name of ["Book the venue", "Water the plants"]) {
  await page.locator('[data-fence="tasks"] li', { hasText: name }).locator("input[type=checkbox]").first().click()
  await wait(1200)
}
const open = read("Tasks/Open.md")
check("ticked in its query, a task is done in its file, with its date", new RegExp(`- \\[x\\] Book the venue.*✅ ${today}`).test(open), open)
check("...and a recurring one makes its next copy", (open.match(/Water the plants/g) ?? []).length === 2, open)

// Moved to Closed by hand (cut and paste), one dropped with why, a note written in.
const booked = open.split("\n").find((l) => l.includes("Book the venue"))
await you("PUT", "file", { path: "Tasks/Open.md", text: open.replace(`${booked}\n`, "").replace("- [ ] Print the flyers", `- [-] Print the flyers ❌ ${today}\n  - Reason: the venue has screens`) })
await you("PUT", "file", { path: "Tasks/Closed.md", text: `${read("Tasks/Closed.md")}${booked}\n` })
await you("PUT", "file", { path: "Notes/Lighthouse launch.md", text: read("Notes/Lighthouse launch.md").replace("- Which week?", "- Which week? The one after the review, so Alice Park can join.") })
await wait(1500) // (what arrives on disk next isn't these writes')
// A bookmarks sync (Raindrop's plugin writes one note per bookmark, and appends new highlights), a transcript exported.
for (const [i, t] of ["Local-first software", "The garden and the stream", "Small is beautiful", "Seeing like a state", "The tyranny of structurelessness"].entries()) {
  onDisk(`Raindrop/Reading/${t}.md`, `---\nraindrop_id: ${813000 + i}\nlink: https://example.com/${i}\n---\n# Metadata\nSource URL:: https://example.com/${i}\n\n---\n# ${t}\n\nWhat ${t.toLowerCase()} is about.\n`)
}
onDisk("Raindrop/Design/Calm technology.md", `${read("Raindrop/Design/Calm technology.md")}\n> [!quote]+ Updated on ${today}\n> The right amount of technology is the minimum needed to solve the problem.\n`)
onDisk("Transcripts/Call with Alice.md", "Alice: The venue has screens, so no flyers.\nMe: Then we only need the slides.\n")
// Claude Code: a note through its own tool (its hook says so), a run logged through vau.
onDisk("Notes/Launch checklist.md", "# Launch checklist\n\n- Slides\n- Venue\n")
await wait(1500)
await claude("POST", `activity/hook?agent=claude&terminal=qa-claude`, { tool_name: "Write", tool_input: { file_path: file("Notes/Launch checklist.md") } })
await claude("POST", "logs", [{ area: "workouts", date: today, source: "claude", ext_id: "qa-recap-run", title: "Evening run", duration_min: 32 }])
await wait(3500)
await apiAt(B, { "x-vaultite-client": "cli" })("POST", "ops/activity.recap", { write: true })

// The daily note's recap: the day as a timeline.
await page.reload()
const entries = page.locator("[data-recap-entry]")
await until(async () => (await entries.count()) >= 6, 15000)
const kinds = await entries.evaluateAll((es) => es.map((e) => e.getAttribute("data-recap-entry")))
const text = await page.locator("[data-recap]").first().innerText()
await page.locator("[data-recap]").first().scrollIntoViewIfNeeded()
await shot(page, "daily")
check("the daily note's recap: tasks done (one moved), one dropped with why", kinds.filter((k) => k === "done").length === 2 && kinds.includes("cancelled") &&
  /Book the venue/.test(text) && /Open → Closed/.test(text) && /Reason: the venue has screens/.test(text), { kinds, text })
check("...the note's edit with the text written", /Edited|Lighthouse launch/.test(text) && /The one after the review/.test(text), text)
check("...the bookmarks sync as one, the highlight, the transcript", /Captured · Raindrop\n5 notes/.test(text) && /minimum needed to solve the problem/.test(text) && /Call with Alice/.test(text), text)
check("...Claude Code's session one line, its log by it", kinds.includes("agent") && /Launch checklist/.test(text) && /Evening run/.test(text) && kinds.includes("logged"), { kinds, text })
await page.locator("[data-recap-entry] a, [data-recap-entry] [data-wiki]", { hasText: "Lighthouse launch" }).first().click()
check("a file in the recap opens", await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("Lighthouse launch")), 4000), await page.evaluate(() => location.hash))

// The recap file reads as the same timeline.
const recap = `Recaps/${today}.md`
check("the day's recap is a file in the vault", read(recap).startsWith("---\ntype: recap\n---") && read(recap).includes("Book the venue"), read(recap))
await page.goto(`${B}#file/${encodeURIComponent(recap)}`)
check("its file reads as the timeline", await until(async () => (await entries.count()) >= 6, 10000), await entries.count())
await shot(page, "file")

// The Activity page's Days tab: the grid of days and the timeline; a week; only tasks.
const days = await until(() => page.evaluate(() => window.__vaultite?.store?.files?.files?.find?.((f) => /(^|\/)Days\.md$/.test(f.path))?.path), 3000) ??
  fs.readdirSync(VAULT, { recursive: true }).find((f) => /(^|\/)Days\.md$/.test(f))
await page.goto(`${B}#file/${encodeURIComponent(days)}`)
check("the Days tab: a grid of days, today's coloured", await until(async () => (await page.locator(`[data-recap-grid] [data-day="${today}"]`).count()) === 1, 10000) &&
  await page.locator(`[data-recap-grid] [data-day="${today}"]`).evaluate((e) => getComputedStyle(e).backgroundColor !== "rgba(0, 0, 0, 0)"), days)
await shot(page, "days")
await page.getByRole("radio", { name: "Week" }).first().click()
check("a week: each day with something done", await until(async () => (await page.locator("[data-recap-day]").count()) >= 1, 8000))
await page.locator('[data-chip="tasks"]').first().click()
await wait(300)
const only = await entries.evaluateAll((es) => es.map((e) => e.getAttribute("data-recap-entry")))
check("filtered to tasks", only.length >= 3 && only.every((k) => ["done", "cancelled", "started", "reopened"].includes(k)), only)
await shot(page, "week-tasks")

// A phone.
const phone = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }))
await phone.goto(`${B}#file/${encodeURIComponent(recap)}`)
await until(async () => (await phone.locator("[data-recap-entry]").count()) >= 6, 10000)
const over = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth)
check("on a phone, nothing wider than the screen", over <= 1, over)
await shot(phone, "phone")
await done()
