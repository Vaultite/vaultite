// Daily notes: the template, Open today's daily note, a link to a day, the day block, Settings, the phone.
// WRITES daily notes, templates, a note and daily notes' settings: throwaway server.
//   node web/qa/dailynotes.mjs <base url> <vault path> [out dir]
// Paths: plugins/core/daily-notes
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { command, palette, qa, until, wait } from "./lib/qa.mjs"

const { args: [B, VAULT, OUT = "/tmp/dailynotes-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const read = (rel) => { try { return readFileSync(file(rel), "utf8") } catch { return null } }
const write = (rel, text) => { mkdirSync(file(rel).replace(/\/[^/]+$/, ""), { recursive: true }); writeFileSync(file(rel), text) }
const api = (p) => fetch(new URL(`/api/${p}`, B)).then((r) => r.json())
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const plus = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return iso(d) }
const T = iso(new Date())
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const long = (date) => { const d = new Date(`${date}T12:00:00`); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
const hash = (page) => page.evaluate(() => decodeURIComponent(location.hash))
function named(date) {
  const out = [], walk = (dir) => {
    for (const e of readdirSync(file(dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) { if (!e.name.startsWith(".") && rel !== "Logs") walk(rel) } else if (e.name.startsWith(date)) out.push(rel)
    }
  }
  walk("")
  return out.sort()
}
const minutesOff = (hhmm) => { const [h, m] = hhmm.split(":").map(Number), n = new Date(); return Math.abs(n.getHours() * 60 + n.getMinutes() - (h * 60 + m)) % (24 * 60) }

for (let i = -1; i < 8; i++) for (const rel of named(plus(T, i))) if (/^(Daily|Journal|Notes)\//.test(rel) || !rel.includes("/")) rmSync(file(rel))
rmSync(file(".vaultite/plugins/daily-notes/data.json"), { force: true })
write("Templates/Daily.md", "---\nmood: \ntags: [journal]\n---\n# {{title}}\n\nDay: {{date:dddd D MMMM YYYY}}\nISO: {{date}}\nStarted at {{time}}\n\n## Plan\n- \n")
write("Templates/Daily short.md", "Short day: {{date:D MMM}}\n")
const LINKS = "Notes/Lighthouse week.md"
write(LINKS, `# Lighthouse week\n\nShip on [[${plus(T, 3)}]], retro on [[${plus(T, 5)}]].\n\n\`\`\`block-day\ndate: ${T}\n\`\`\`\n`)
await until(async () => (await api("state")).files?.files?.some((f) => f.path === LINKS), 8000)

const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" })
const page = watch(await desk.newPage())
const go = async (p, to) => { await p.goto("about:blank"); await p.goto(`${B}#${to}`); await p.waitForSelector("main", { timeout: 20_000 }); await wait(800) }
const SHEET = "dialog[open] [data-plugin-settings-sheet='daily-notes']"
const settingsSheet = async (p) => { await go(p, "settings/plugin-settings/daily-notes"); await p.waitForSelector(SHEET, { timeout: 10_000 }) }
async function setText(p, key, value) {
  const f = p.locator(`${SHEET} [data-setting='${key}'] input`)
  await f.fill(value); await f.press("Enter")
  return until(() => JSON.parse(read(".vaultite/plugins/daily-notes/data.json") ?? "{}")[key] === value, 4000)
}
const closeSheet = async (p) => { for (let i = 0; i < 3 && (await p.locator("dialog[open]").count()); i++) { await p.keyboard.press("Escape"); await wait(300) } }

try {
  await settingsSheet(page)
  check("Settings: the template saved from its field", !!(await setText(page, "template", "Templates/Daily")))
  await page.screenshot({ path: `${OUT}settings.png` })
  await closeSheet(page)
  await go(page, `file/${encodeURIComponent(LINKS)}`)
  await page.waitForSelector("[data-pane] .cm-content")

  const todayRel = `Daily/${T}.md`
  await page.click("[data-pane] .cm-content")
  await page.keyboard.press("ControlOrMeta+Alt+d"); await page.keyboard.press("ControlOrMeta+Alt+d")
  check("its keys, twice: today's note opens in the tab", !!(await until(async () => (await hash(page)).includes(todayRel), 6000)), await hash(page))
  await wait(500)
  check("...one note, in the daily notes' folder", JSON.stringify(named(T)) === JSON.stringify([todayRel]), named(T))
  const made = read(todayRel) ?? ""
  check("...from the template: {{title}}, {{date}}, {{date:dddd D MMMM YYYY}}", made.includes(`# ${T}\n`) && made.includes(`ISO: ${T}\n`) && made.includes(`Day: ${long(T)}\n`), made)
  const time = /Started at (\d\d:\d\d)/.exec(made)?.[1]
  check("...{{time}}: when it was made, not noon", !!time && minutesOff(time) <= 2, time)
  check("...its properties merged with the day's own", /^---\ntype: day\nmood: \ntags: \[journal\]\n---\n/.test(made) && !made.includes("{{"), made.slice(0, 80))

  await page.waitForSelector("[data-pane]:not([data-kept]) .cm-content")
  await page.locator("[data-pane]:not([data-kept]) .cm-line", { hasText: /^(## )?Plan$/ }).first().click(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("End")
  await page.keyboard.type("Call Alice Park about Lighthouse")
  check("typed in it saves", !!(await until(() => read(todayRel)?.includes("- Call Alice Park about Lighthouse"), 6000)))
  const edited = read(todayRel)
  await go(page, `file/${encodeURIComponent(LINKS)}`)
  await palette(page, "Open today's daily note")
  check("the palette's Open today's daily note opens it again", !!(await until(async () => (await hash(page)).includes(todayRel), 6000)), await hash(page))
  await wait(500)
  check("...not made again, the edit kept", read(todayRel) === edited && named(T).length === 1, named(T))

  await go(page, `file/${encodeURIComponent(LINKS)}`)
  const linked = plus(T, 3)
  await page.locator(`[data-pane] [data-wiki='${linked}']`).first().click({ modifiers: [] })
  const asked = await until(async () => (await page.locator("[role=option]", { hasText: "Create" }).count()) || (await hash(page)).includes(linked), 4000)
  if (asked && !(await hash(page)).includes(linked)) await page.locator("[role=option]", { hasText: "Create" }).first().click()
  check("a [[link]] to a day: opens that day's note", !!(await until(async () => (await hash(page)).includes(`Daily/${linked}.md`), 6000)), [await hash(page), named(linked)])
  check("...made in the daily notes' folder, nowhere else", JSON.stringify(named(linked)) === JSON.stringify([`Daily/${linked}.md`]), named(linked))
  check("...from the template", (read(`Daily/${linked}.md`) ?? "").includes(`Day: ${long(linked)}`), read(`Daily/${linked}.md`))

  await go(page, `file/${encodeURIComponent(LINKS)}`)
  const block = page.locator("[data-pane] [aria-label='Day after']").first()
  await block.waitFor({ timeout: 8000 })
  await block.click(); await block.click()
  const second = plus(T, 2)
  const start = page.locator("[data-pane] button", { hasText: "Start it" }).first()
  check("the day block: two days on, no note, Start it", !!(await until(() => start.isVisible(), 4000)))
  check("...looking didn't make it", named(second).length === 0, named(second))
  await page.locator("[data-pane] [aria-label='Day before']").first().click()
  check("...a day back: tomorrow's, not there either", !!(await until(async () => (await page.locator("[data-pane] button", { hasText: "Tomorrow" }).count()) > 0, 3000)))
  await page.locator("[data-pane] [aria-label='Day after']").first().click()
  await start.click()
  check("...Start it: made from the template", !!(await until(() => read(`Daily/${second}.md`)?.includes(`Day: ${long(second)}`), 6000)), named(second))

  await settingsSheet(page)
  check("Settings: another template", !!(await setText(page, "template", "Templates/Daily short")))
  check("Settings: a date format that makes a folder a month", !!(await setText(page, "format", "YYYY/MM/YYYY-MM-DD")))
  await page.click(`${SHEET} [data-setting='folder-days'] [data-folder-field]`)
  await page.waitForSelector("[role=dialog] input:focus"); await page.keyboard.type("Journal")
  await until(() => page.locator("[role=option]", { hasText: "Journal" }).count(), 3000); await page.keyboard.press("Enter")
  check("Settings: the folder, a new one", !!(await until(() => JSON.parse(read(".vaultite/folders.json") ?? "{}").days === "Journal", 4000)), read(".vaultite/folders.json"))
  await closeSheet(page)
  const tomorrow = plus(T, 1), [y, m] = tomorrow.split("-")
  const nested = `Journal/${y}/${m}/${tomorrow}.md`
  await go(page, `file/${encodeURIComponent(LINKS)}`)
  await palette(page, "Open tomorrow's daily note")
  check("Open tomorrow's daily note: in the new folder and format, no reload", !!(await until(async () => (await hash(page)).includes(nested), 6000)), [await hash(page), named(tomorrow)])
  const short = read(nested) ?? ""
  check("...from the new template", short.startsWith(`Short day: ${new Date(`${tomorrow}T12:00:00`).getDate()} ${MONTHS[+m - 1].slice(0, 3)}`), short)
  check("...its folder finds it: no type: day of its own", !short.includes("type:") && (await api(`daily-notes/day?date=${tomorrow}`)).exists === true, short)
  await palette(page, "Open today's daily note")
  check("today's, made before the change, still opens: not a second one", !!(await until(async () => (await hash(page)).includes(todayRel), 6000)) && named(T).length === 1, [await hash(page), named(T)])

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const pp = watch(await phone.newPage(), { label: "phone" })
  await go(pp, `file/${encodeURIComponent(LINKS)}`)
  await pp.waitForSelector("main .cm-content", { timeout: 15_000 })
  const retro = plus(T, 5), retroRel = `Journal/${retro.slice(0, 4)}/${retro.slice(5, 7)}/${retro}.md`
  await pp.locator(`main [data-wiki='${retro}']`).first().tap()
  const askedP = await until(async () => (await pp.locator("[role=option]", { hasText: "Create" }).count()) || (await hash(pp)).includes(retro), 4000)
  if (askedP && !(await hash(pp)).includes(retro)) await pp.locator("[role=option]", { hasText: "Create" }).first().tap()
  check("phone: a link to a day makes it where the settings say now", !!(await until(async () => (await hash(pp)).includes(retroRel), 6000)), [await hash(pp), named(retro)])
  check("...from the template, nowhere else", (read(retroRel) ?? "").startsWith("Short day:") && named(retro).length === 1, named(retro))
  check("phone: the palette opens today's note", (await command(pp, "Open today's daily note", 300)) && !!(await until(async () => (await hash(pp)).includes(todayRel), 6000)), await hash(pp))
  check("...its edit there, nothing new", (read(todayRel) ?? "").includes("Call Alice Park about Lighthouse") && named(T).length === 1)
  check("phone: nothing wider than the screen", (await pp.evaluate(() => document.documentElement.scrollWidth)) <= 390)
  await pp.screenshot({ path: `${OUT}phone.png` })
  await phone.close()

  const bad = await fetch(new URL("/api/ops/daily-note.open", B), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: "2026-02-30" }) }).then((r) => r.json())
  check("daily-note.open: 2026-02-30 is refused, not made as March 2", !!bad.error && !existsSync(file("Journal/2026/03/2026-03-02.md")), bad)
} catch (e) {
  check("ran to the end", false, String(e))
  await page.screenshot({ path: `${OUT}failed.png` }).catch(() => {})
}
await desk.close()
await done()
