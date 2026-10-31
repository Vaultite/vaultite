// Rename tab… (core/tabnames.tsx): the palette as a field naming a view's tab, a terminal's session (terminal.rename,
// kept by the server) and a tab group; Add current tab to group…. Headless Chrome; WRITES (starts a shell), so only
// against a throwaway server.   node web/qa/tabnames.mjs <base url>
import { spawnSync } from "node:child_process"
import path from "node:path"
import { qa, ROOT, SHOTS, until, wait } from "./lib/qa.mjs"

const { args: [arg], browser, check, watch, done } = await qa(import.meta.url)
const base = arg.endsWith("/") ? arg : `${arg}/`
const vau = (...a) => spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), ...a], { env: { ...process.env, VAULTITE_URL: base.replace(/\/$/, "") }, encoding: "utf8" })
const ops = async (id, body = {}) => (await fetch(`${base}api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = watch(await ctx.newPage(), { console: true })
await page.goto(base)
await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
await wait(1500)
const palette = page.locator("[role=dialog]").filter({ has: page.locator("input") }).last()
const field = palette.locator("input")
const command = async (name) => {
  await page.keyboard.press("ControlOrMeta+P"); await wait(300)
  await page.keyboard.type(name); await wait(300)
  await page.keyboard.press("Enter"); await wait(500)
}
const active = () => page.evaluate(() => document.querySelector('[data-tab-id] [role=tab][aria-selected=true]')?.closest("[data-tab-id]")?.textContent?.trim() ?? "")
let terminal = ""

try {
  // A view's tab: the name stays on the tab.
  await command("Open terminals in a tab")
  check("a view's tab opens, named by its view", (await active()).includes("Terminals"), await active())
  await command("Rename tab…")
  const typed = await field.inputValue().catch(() => null)
  const selected = await field.evaluate((f) => f.selectionStart === 0 && f.selectionEnd === f.value.length).catch(() => false)
  check("Rename tab…: a field holding its name, selected", typed === "Terminals" && selected, typed)
  check("its heading says what it names, its placeholder how", (await palette.innerText()).includes('Rename tab "Terminals"')
    && (await field.getAttribute("placeholder")) === "Name this tab…", await palette.innerText())
  await page.keyboard.type("My shells"); await wait(200)
  await page.screenshot({ path: `${SHOTS}tabnames-1-field.png` })
  check("typing offers the rename", (await palette.innerText()).includes('Rename to "My shells"'), await palette.innerText())
  await page.keyboard.press("Enter"); await wait(400)
  check("Enter renames the tab", (await active()).includes("My shells"), await active())
  await page.screenshot({ path: `${SHOTS}tabnames-2-renamed.png` })

  await command("Rename tab…")
  await page.keyboard.press("Backspace"); await wait(200)
  check("emptied, it says Enter gives the automatic name back", (await palette.innerText()).includes('automatic name, "Terminals"'), await palette.innerText())
  await page.keyboard.press("Enter"); await wait(400)
  check("an empty name: the automatic one again", (await active()) === "Terminals", await active())
  await command("Rename tab…"); await page.keyboard.type("Shells"); await page.keyboard.press("Enter"); await wait(300)
  await command("Rename tab…"); await page.keyboard.press("Escape"); await wait(300)
  check("Esc leaves it", (await active()) === "Shells" && !(await palette.count()), await active())

  // A terminal: the name is its session's, kept by the server.
  await command("Open terminal on this machine")
  await until(async () => (await ops("terminal.list")).sessions?.length > 0, 15000)
  terminal = (await ops("terminal.list")).sessions[0]?.id ?? ""
  check("a shell runs", !!terminal, terminal)
  await wait(1500)
  await command("Rename tab…")
  check("a terminal's field says so", (await palette.innerText()).includes('Rename terminal "Terminal"') && (await field.getAttribute("placeholder")) === "Name this terminal…", await palette.innerText())
  await page.keyboard.type("Build box"); await page.keyboard.press("Enter"); await wait(300)
  check("its tab shows the name at once", (await active()).includes("Build box"), await active())
  const listed = (await ops("terminal.list")).sessions.find((s) => s.id === terminal)
  check("the server keeps it (terminal.list)", listed?.name === "Build box", listed)
  check("vau terminal shows it", vau("terminal").stdout.includes('named "Build box"'), vau("terminal").stdout)
  const r = vau("terminal", "rename", terminal, "Release notes")
  check("vau terminal rename names it", r.status === 0 && r.stdout.includes('Named') , r)
  check("and its tab follows", await until(async () => (await active()).includes("Release notes"), 5000), await active())
  check("an unknown terminal: an error", vau("terminal", "rename", "nosuchterm", "x").status !== 0, null)
  await page.screenshot({ path: `${SHOTS}tabnames-3-terminal.png` })

  // Groups: into a new one named as typed, then renamed.
  await command("Add current tab to group…")
  check("Add current tab to group… with no groups: a field for the new one's name", (await field.getAttribute("placeholder")) === "Name the new group…", await field.getAttribute("placeholder"))
  await page.keyboard.type("Work"); await wait(200)
  check("it offers a new group so named", (await palette.innerText()).includes('New group "Work"'), await palette.innerText())
  await page.keyboard.press("Enter"); await wait(500)
  const chip = () => page.evaluate(() => [...document.querySelectorAll("[data-set-chip]")].map((e) => e.textContent?.trim()).join(","))
  check("the tab is in group Work", (await chip()) === "Work", await chip())
  await command("Rename tab group…")
  check("Rename tab group…: its name, selected", (await field.inputValue()) === "Work", await field.inputValue())
  await page.keyboard.type("Ops"); await wait(200)
  await page.screenshot({ path: `${SHOTS}tabnames-4-group-field.png` })
  await page.keyboard.press("Enter"); await wait(400)
  check("the group is renamed", (await chip()) === "Ops", await chip())
  // The view tab (Shells) joins it from the picker.
  await page.locator("[data-tab-id]", { hasText: "Shells" }).first().click(); await wait(300)
  await command("Add current tab to group…")
  check("with groups: they're listed", (await palette.innerText()).includes("Ops"), await palette.innerText())
  await page.keyboard.press("Enter"); await wait(400)
  const inOps = await page.evaluate(() => document.querySelectorAll("[data-in-set]").length)
  check("Enter adds it to the group listed", inOps === 2, inOps)

  // The tab menu has it for a view's tab.
  await page.locator("[data-tab-id]", { hasText: "Shells" }).first().click({ button: "right" }); await wait(300)
  const menu = await page.locator("[role=menu]").last().innerText().catch(() => "")
  check("a view's tab menu: Rename tab…", menu.includes("Rename tab…"), menu)
  await page.keyboard.press("Escape"); await wait(200)

  // Reloaded: both names stay.
  await page.reload(); await page.waitForFunction(() => document.querySelector("[data-tab-id]"), null, { timeout: 20000 }); await wait(2500)
  const labels = await page.evaluate(() => [...document.querySelectorAll("[data-tab-id]")].map((e) => e.textContent?.trim()).join(" | "))
  check("after a reload the tab's and the terminal's names stay", labels.includes("Shells") && labels.includes("Release notes"), labels)
  await page.screenshot({ path: `${SHOTS}tabnames-5-reloaded.png` })

  // A file's tab: Rename tab… is Rename current file (its title turns into a field).
  await command("Open today's daily note")
  const file = await active()
  if (file) {
    await command("Rename tab…")
    const editing = await page.evaluate(() => { const a = document.activeElement; return a?.tagName === "INPUT" && !a.closest("[role=dialog]") ? a.value : null })
    check("a file's tab: its name turns into a field, as Rename current file", editing !== null && !(await palette.count()), editing)
    await page.keyboard.press("Escape")
  }
} finally {
  if (terminal) vau("terminal", "end", terminal)
}
await done()
