// Dispatch: a note's header has a button per action, after Provenance's label and before the view button (desktop), in
// the line above the title at 390px (a 44px target, nothing wider than the screen). Clicking one saves what's typed, starts
// its terminal on the server and opens it in a new tab, focused: a shell command gets the note's path quoted, Claude Code
// starts with the prompt, then told to end with `vau inbox report` (`claude ... -- '<prompt>\n\nDo it all the way...'`),
// in the background (a toast's Open session opens its tab).
// The palette's "Dispatch to Claude Code", ⌘⇧↩ in the editor, a file's menu and an inbox result's menu do the same; the
// settings sheet lists the actions and Reset clears them; a command this machine hasn't run yet is shown and run once
// confirmed. WRITES "QA dispatch/", the plugin's data.json and an inbox result, starts shells and Claude Code (told to
// answer "ok", ended after): throwaway server only.
//   node web/qa/dispatch.mjs <base url> <vault path> [out dir]
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/dispatch-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const text = (rel) => { try { return readFileSync(file(rel), "utf8") } catch { return "" } }
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins/dispatch/data.json"), keep(".vaultite/plugins/claude-code/data.json")]
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
const enc = encodeURIComponent

const DIR = "QA dispatch"
const NOTE = `${DIR}/Bob's garden plan.md`
rmSync(file(DIR), { recursive: true, force: true })
await api("PUT", "file", { path: NOTE, text: "## Beds\n\n- Tomatoes along the fence\n" })
// A shell command to see what an action gets, and Claude Code told to answer one word.
const PROMPT = "Reply with only the word ok and use no tools. ({path})"
await api("PATCH", "config/plugin/dispatch", { actions: [
  { id: "claude", label: "Claude Code", icon: "claude", agent: "claude", prompt: PROMPT },
  { id: "show", label: "Show it", icon: "file-text", command: "cat {file}" },
] })

const sessions = async () => (await api("GET", "terminals/sessions")).sessions.map((s) => s.id)
const started = new Set()
/** The session that wasn't there `before` (and keep it to end it after). */
const newSession = (before, prefix = "") => until(async () => {
  const id = (await sessions()).find((s) => !before.includes(s) && s.startsWith(prefix) && !started.has(s))
  if (id) started.add(id)
  return id
}, 8000)
const screen = async (id) => (await api("GET", `terminals/${enc(id)}/screen?lines=40`)).lines?.join("\n") ?? ""
const claudeArgs = (id) => { try { return execFileSync("/bin/ps", ["-axww", "-o", "args="], { encoding: "utf8" }).split("\n").find((l) => /^claude /.test(l.trim()) && l.includes(`terminal=${id}`)) ?? "" } catch { return "" } }

async function open(w, h, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
  return { ctx, page: watch(await ctx.newPage(), { label: w }) }
}
const go = async (page, rel) => { await page.goto(`${B}/#file/${enc(rel)}`); await page.locator(`.file-view[data-path="${rel}"]:visible`).waitFor({ timeout: 10000 }); await wait(800) }
const shown = (page, rel, sel) => page.locator(`.file-view[data-path="${rel}"]:visible ${sel}`)
/** A terminal is on screen and has the keyboard. */
const termFocused = (page) => until(() => page.evaluate(() => !!document.activeElement?.matches(".xterm-helper-textarea") && document.activeElement.closest("[data-pane]")?.checkVisibility()), 8000)

// ---------- desktop ----------
{
  const { ctx, page } = await open(1280, 800)
  await go(page, NOTE)
  const btn = shown(page, NOTE, "[data-dispatch=claude]")
  check("desktop: a button per action in the header", (await shown(page, NOTE, "[data-dispatch]").count()) === 2)
  const order = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".file-view [data-dispatch=claude]")].find((e) => e.checkVisibility()), kids = [...(b?.parentElement?.children ?? [])]
    const chip = kids.find((k) => k.matches("[data-chip=origin]")), view = kids.find((k) => ["Read", "Edit"].includes(k.getAttribute("aria-label")))
    const r = b.getBoundingClientRect(), v = view?.getBoundingClientRect()
    return { after: !!chip && kids.indexOf(chip) < kids.indexOf(b), before: !!view && kids.indexOf(b) < kids.indexOf(view), mid: v ? Math.abs((r.top + r.height / 2) - (v.top + v.height / 2)) : null }
  })
  check("desktop: after the origin label, before the view button, centred with it", order.after && order.before && order.mid < 1, order)
  for (const t of ["light", "dark"]) {
    await api("PATCH", "config/appearance", { theme: t }); await wait(600)
    const box = await btn.boundingBox()
    await page.screenshot({ path: `${OUT}desktop-${t}-header.png`, clip: { x: Math.max(0, box.x - 500), y: Math.max(0, box.y - 12), width: 620, height: 52 } })
  }

  // Typed and not saved yet, then the command button: it reads what was typed, in a new focused tab.
  await shown(page, NOTE, ".cm-content").click(); await page.keyboard.press("ControlOrMeta+End")
  await page.keyboard.type("\n- Basil between them")
  let before = await sessions()
  await shown(page, NOTE, "[data-dispatch=show]").click()
  // A command this machine hasn't run yet asks first, showing it (core/trust.ts); asked once.
  const ask = page.locator("dialog[open][role=alertdialog]")
  check("click: a command not run here before asks first, showing it", await until(async () => (await ask.count()) && (await ask.innerText()).includes("cat {file}"), 8000), await ask.count())
  await ask.getByRole("button", { name: "Run" }).click()
  let id = await newSession(before)
  check("click: a new terminal", !!id, await sessions())
  check("click: its tab opens with the keyboard", await termFocused(page))
  check("click: the command gets the note as saved just now", await until(async () => (await screen(id)).includes("- Basil between them"), 8000), id && await screen(id))
  await page.screenshot({ path: `${OUT}desktop-terminal.png` })

  // The palette's command and ⌘⇧↩ start Claude Code with the prompt.
  await go(page, NOTE)
  before = await sessions()
  await page.keyboard.press("ControlOrMeta+p"); await wait(300); await page.keyboard.type("dispatch to claude"); await wait(300)
  await page.screenshot({ path: `${OUT}desktop-palette.png` })
  await page.keyboard.press("Enter")
  id = await newSession(before, "claude-")
  check("palette: Dispatch to Claude Code starts it", !!id, await sessions())
  // An agent that reports runs in the background: a toast offers its session instead of a tab.
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "its report comes to your inbox" })
  check("palette: no tab, a toast offering its session", await until(async () => (await toast.count()) === 1, 8000) &&
    !(await page.evaluate(() => [...document.querySelectorAll(".xterm")].some((e) => e.checkVisibility()))))
  await page.screenshot({ path: `${OUT}desktop-toast.png` })
  await toast.getByRole("button", { name: "Open session" }).click()
  check("palette: Open session opens its tab with the keyboard", await termFocused(page))
  const want = `-- ${PROMPT.replace("{path}", NOTE)}` // (ps shows the arguments unquoted)
  check("palette: claude runs with the prompt, then told to end with a report", await until(() => claudeArgs(id).includes(`${want}\\012\\012Do it all the way, then end with \`vau inbox report\``), 10000), claudeArgs(id).slice(-300))
  await go(page, NOTE)
  await shown(page, NOTE, ".cm-content").click()
  const was = text(NOTE)
  before = await sessions()
  await page.keyboard.press("ControlOrMeta+Shift+Enter")
  id = await newSession(before, "claude-")
  check("⌘⇧↩ in the editor starts it", !!id, await sessions())
  await wait(1000)
  check("⌘⇧↩: the note's text is unchanged", text(NOTE) === was, text(NOTE))

  // A file's menu (its tab's).
  await go(page, NOTE)
  await page.locator("[data-tab-bar] [role=tab][aria-selected=true]").first().click({ button: "right" }); await wait(300)
  const item = page.locator("[role=menu] [role=menuitem]").filter({ hasText: "Dispatch to Show it" })
  check("file menu: Dispatch to each action", (await item.count()) === 1 && (await page.locator("[role=menu] [role=menuitem]").filter({ hasText: "Dispatch to Claude Code" }).count()) === 1)
  before = await sessions()
  await item.click()
  check("file menu: it runs", !!(await newSession(before)))

  // A second Claude Code account: the button says which one it runs in, and its menu sets this workspace's default.
  const second = `${OUT}claude-second`
  mkdirSync(`${second}/projects`, { recursive: true })
  await api("PATCH", "config/plugin/claude-code", { accounts: { second: { dir: second, label: "Second" } } })
  await page.goto("about:blank"); await go(page, NOTE)
  const where = shown(page, NOTE, "[data-dispatch=claude] [data-dispatch-where]")
  check("accounts: the button says the account it runs in", await until(async () => (await where.count()) && (await where.innerText()) === "Default", 10000), await where.count() && await where.innerText())
  await btn.click({ button: "right" }); await wait(300)
  await page.locator("[role=menu] [role=menuitem]").filter({ hasText: /^Default( in |$)/ }).click(); await wait(300)
  const pick = page.locator("[role=menu]").last().locator("[role^=menuitem]").filter({ hasText: "Claude Code · Second" })
  check("accounts: the menu's Default (in <workspace>) lists the accounts", (await pick.count()) === 1)
  await pick.click(); await page.keyboard.press("Escape")
  check("accounts: picked, the button says it", await until(async () => (await where.innerText()) === "Second", 8000), await where.innerText())
  before = await sessions()
  await btn.click()
  id = await newSession(before, "claude_second-")
  check("accounts: a click runs it in the workspace's default", !!id, await sessions())
  await page.reload(); await page.locator(`.file-view[data-path="${NOTE}"]:visible`).waitFor({ timeout: 10000 })
  check("accounts: the default stays after a reload", await until(async () => (await where.count()) && (await where.innerText()) === "Second", 10000))
  await page.screenshot({ path: `${OUT}default-account.png` })
  await btn.click({ button: "right" }); await wait(300)
  await page.locator("[role=menu] [role=menuitem]").filter({ hasText: /^Default( in |$)/ }).click(); await wait(300)
  await page.locator("[role=menu]").last().locator("[role^=menuitem]").filter({ hasText: "Claude Code · Default" }).click(); await page.keyboard.press("Escape")
  check("accounts: back to its own", await until(async () => (await where.innerText()) === "Default", 8000))
  await api("PATCH", "config/plugin/claude-code", { accounts: null })

  // An inbox result's menu has them too.
  const r = await api("POST", "inbox", { title: "QA dispatch result", body: "Something to act on." })
  await page.goto("about:blank"); await page.goto(`${B}/#view/inbox`) // (a hash alone is undone by the workspace's tabs)
  const res = page.locator("[data-inbox-view] [data-result]", { hasText: "QA dispatch result" }).first()
  if (await until(() => res.count(), 8000)) {
    await res.click({ button: "right" }); await wait(300)
    const item = page.locator("[role=menu] [role=menuitem]").filter({ hasText: "Dispatch to Show it" })
    check("inbox: a result's menu has the actions", (await item.count()) === 1)
    before = await sessions()
    await item.click()
    const sid = await newSession(before)
    check("inbox: it runs on the result's file", await until(async () => (await screen(sid)).includes("Something to act on."), 8000), sid && await screen(sid))
  } else check("inbox: the result is listed", false, r)
  rmSync(file(`${r.id}.md`), { force: true })

  // The settings sheet: the actions in order; Reset goes back to the default.
  await page.goto(`${B}/#settings/plugin-settings/dispatch`)
  check("settings: the actions, in order", await until(async () => (await page.locator("[data-dispatch-action]").evaluateAll((es) => es.map((e) => e.dataset.dispatchAction))).join() === "claude,show", 8000))
  for (const t of ["light", "dark"]) { await api("PATCH", "config/appearance", { theme: t }); await wait(600); await page.screenshot({ path: `${OUT}settings-${t}.png` }) }
  await page.locator("[data-dispatch-action=show] input[aria-label=Label]").fill("Show the note"); await page.keyboard.press("Enter")
  check("settings: a label typed is saved", await until(() => /"label": "Show the note"/.test(text(".vaultite/plugins/dispatch/data.json")), 8000), text(".vaultite/plugins/dispatch/data.json"))
  // An agent that reports runs in the background unless its switch says to open its terminal.
  const sw = page.locator("[data-dispatch-action=claude] [role=switch]")
  check("settings: Claude Code's terminal doesn't open by itself", (await sw.getAttribute("aria-checked")) === "false")
  await sw.click()
  check("settings: its switch saves open", await until(() => /"open": true/.test(text(".vaultite/plugins/dispatch/data.json")), 8000), text(".vaultite/plugins/dispatch/data.json"))
  await sw.click()
  check("settings: back off, its default isn't written", await until(() => !/"open"/.test(text(".vaultite/plugins/dispatch/data.json")), 8000), text(".vaultite/plugins/dispatch/data.json"))
  await page.locator("[data-dispatch-reset]").click()
  check("settings: Reset clears them", await until(() => !/actions/.test(text(".vaultite/plugins/dispatch/data.json")), 8000), text(".vaultite/plugins/dispatch/data.json"))
  check("settings: then only Claude Code", await until(async () => (await page.locator("[data-dispatch-action]").count()) === 1, 8000))
  await page.keyboard.press("Escape"); await wait(300)
  await ctx.close()
}

// ---------- phone ----------
{
  await api("PATCH", "config/plugin/dispatch", { actions: [{ id: "claude", label: "Claude Code", icon: "claude", agent: "claude", prompt: PROMPT }, { id: "show", label: "Show it", command: "cat {file}" }] })
  const { ctx, page } = await open(390, 844, true)
  await go(page, NOTE)
  const fit = await page.evaluate(() => {
    const bs = [...document.querySelectorAll(".file-view [data-dispatch]")].filter((e) => e.checkVisibility()).map((e) => e.getBoundingClientRect())
    return { n: bs.length, right: Math.round(Math.max(...bs.map((b) => b.right))), h: Math.round(Math.min(...bs.map((b) => b.height))), wide: document.documentElement.scrollWidth }
  })
  check("390: the buttons are in the line above the title, 44px targets, nothing wider than the screen", fit.n === 2 && fit.right <= 390 && fit.h >= 44 && fit.wide <= 390, fit)
  for (const t of ["light", "dark"]) { await api("PATCH", "config/appearance", { theme: t }); await wait(600); await page.screenshot({ path: `${OUT}phone-${t}.png`, clip: { x: 0, y: 0, width: 390, height: 260 } }) }
  const before = await sessions()
  await shown(page, NOTE, "[data-dispatch=show]").tap()
  const id = await newSession(before)
  check("390: a tap starts it", !!id && await until(async () => (await screen(id)).includes("Tomatoes"), 8000), id)
  check("390: and shows its terminal", await until(() => page.evaluate(() => [...document.querySelectorAll(".xterm")].some((e) => e.checkVisibility())), 8000))
  await page.screenshot({ path: `${OUT}phone-terminal.png` })
  await ctx.close()
}

await browser.close()
for (const id of started) await api("DELETE", `terminals/${enc(id)}`).catch(() => {})
rmSync(file(DIR), { recursive: true, force: true })
for (const r of restore) r()
await done()
