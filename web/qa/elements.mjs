// Block an element in the desktop app (Electron), end to end on a throwaway vault, against a made-up site this script
// serves on 127.0.0.1 (Shields' lists: a small one of its own, no network): the Shields menu's Block an element… starts
// the picker (the page's right-click Block element… too, on what was clicked); pointing outlines, a click picks the
// element (a stable selector, not its generated class), ↑ widens it to the custom element around it, marked but still
// shown until P previews it hidden, ↓ narrows back, Esc cancels with nothing kept; Enter keeps `127.0.0.1##<selector>` in the
// blocked elements list and the page stays so, a reload too; the menu's Hidden on 127.0.0.1 shows one again (gone from the
// list, shown without a reload); an agent's `web-viewer.block` hides live (a site's rule, and a generic one), unblock shows.
// Site styles: a site's CSS file applies at once and beats the page's own, with the vault's look as variables (following
// light and dark), a reload too; the Shields menu turns it off and on.
// WRITES: the throwaway vault only.
//   node web/qa/elements.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-elements-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

// ---------- a made-up site: cards (two sponsored), a banner ----------
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>Feed</title>
<style>body { font: 16px sans-serif; margin: 0; } my-card { display: block; margin: 12px; } .inner { padding: 20px; background: #eef; } .x9f3kq2 { height: 40px; }</style>
<div class="promo-banner" id="banner">A banner</div>
<section class="feed">
  <my-card is-sponsored id="s1"><div class="inner x9f3kq2"><span class="label">Sponsored: a boat</span></div></my-card>
  <my-card id="story"><div class="inner x9f3kq2"><span class="label">The story</span></div></my-card>
  <my-card is-sponsored id="s2"><div class="inner x9f3kq2"><span class="label">Sponsored: a car</span></div></my-card>
</section>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}/`

const LISTS = path.join(TMP, "lists")
fs.mkdirSync(LISTS)
fs.writeFileSync(path.join(LISTS, "filters.txt"), "/nothing-here.js$script\n")

const pluginsFile = path.join(VAULT, ".vaultite/plugins.json")
const plugins = fs.existsSync(pluginsFile) ? JSON.parse(fs.readFileSync(pluginsFile, "utf8")) : {}
fs.mkdirSync(path.dirname(pluginsFile), { recursive: true })
fs.writeFileSync(pluginsFile, JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []).filter((x) => x !== "web-viewer"), "web-viewer"],
  disabled: (plugins.disabled ?? []).filter((x) => x !== "web-viewer") }, null, 2) + "\n")
const NOTE = path.join(VAULT, ".vaultite/plugins/web-viewer/blocked-elements.md")
const STYLE = path.join(VAULT, ".vaultite/plugins/web-viewer/sites/127.0.0.1.css")
const note = () => (fs.existsSync(NOTE) ? fs.readFileSync(NOTE, "utf8") : "")

// ---------- the app ----------
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local"),
    VAULTITE_ADBLOCK_LISTS: LISTS },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const runOp = (id, params) => fetch(`${origin}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) }).then((r) => r.json())

/** Run `code` in the visible page: in its own world, or (`world`) another, as the picker's (1020). */
const inPage = (code, world = 0) => app.evaluate(({ BaseWindow }, [code, world]) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  if (!v) return null
  return world ? v.webContents.executeJavaScriptInIsolatedWorld(world, [{ code }]) : v.webContents.executeJavaScript(code)
}, [code, world])
/** Real input into the visible page (its own coordinates). */
const input = (events) => app.evaluate(({ BaseWindow }, events) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  for (const e of events) v?.webContents.sendInputEvent(e)
}, events)
const centre = (sel) => inPage(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
const point = async (sel) => { const { x, y } = await centre(sel); await input([{ type: "mouseMove", x, y }]); return { x, y } }
const click = async (sel) => { const { x, y } = await point(sel); await input([{ type: "mouseDown", x, y, button: "left", clickCount: 1 }, { type: "mouseUp", x, y, button: "left", clickCount: 1 }]) }
const key = (keyCode) => input([{ type: "keyDown", keyCode }, { type: "keyUp", keyCode }])
const picker = () => inPage("globalThis.__vaultitePicker?.state?.() ?? null", 1020)
/** Which of the page's parts show. */
const seen = () => inPage(`(() => { const shown = (id) => getComputedStyle(document.getElementById(id)).display !== "none"
  return { s1: shown("s1"), s2: shown("s2"), story: shown("story"), banner: shown("banner") } })()`)
const button = win.locator("[data-web-shields]")
const menuItem = (text) => win.locator("[role^=menuitem]", { hasText: text })
const startPicker = async () => {
  await button.click()
  await menuItem(/^Block an element/).click()
  return until(async () => (await picker()) !== null, 5000)
}

await ui({ action: "open", path: `view:web/${SITE}` })
check("a page opens", await until(async () => (await inPage("location.href")) === SITE, 20000), await inPage("location.href"))
await until(() => button.count(), 10000)

// ---------- Esc cancels ----------
check("Block an element… starts the picker in the page", await startPicker(), await picker())
await key("Escape")
check("Esc: the picker's gone, nothing hidden, nothing kept", await until(async () => (await picker()) === null, 5000)
  && JSON.stringify(await seen()) === JSON.stringify({ s1: true, s2: true, story: true, banner: true }) && !note(), [await picker(), await seen(), note()])

// ---------- the page's right-click menu: Block element… starts on what was right-clicked ----------
// (a native menu Playwright can't click: what its item tells the window, with the page's id and the right-click's point)
const pageId = Number(await win.locator("[data-web-page]").first().getAttribute("data-web-page"))
const at = await centre("#s1 .label")
await app.evaluate(({ BaseWindow }, msg) => BaseWindow.getAllWindows()[0].webContents.send("vaultite:web", msg), { type: "block", id: pageId, ...at })
check("right-click, Block element…: the picker starts with that element picked", await until(async () => (await picker())?.selector === "span.label", 5000), await picker())
await key("Escape")
await until(async () => (await picker()) === null, 5000)

// ---------- pick, widen, narrow, block ----------
await startPicker()
await point("#s1 .label")
check("pointing outlines it", await until(async () => (await picker())?.hovered, 5000), await picker())
await click("#s1 .label")
check("a click picks it by a selector that lasts (its class, not the generated one)", await until(async () => (await picker())?.selector === "span.label", 5000), await picker())
await key("Up")
check("↑ widens it to the custom element around it, by its name and kind", await until(async () => (await picker())?.selector === "my-card[is-sponsored]", 5000), await picker())
check("… what it matches still shows, marked to hide", await until(async () => /Will hide 2 elements on 127\.0\.0\.1/.test((await picker())?.status ?? ""), 5000)
  && JSON.stringify(await seen()) === JSON.stringify({ s1: true, s2: true, story: true, banner: true }), [await seen(), await picker()])
await key("P")
check("P previews: what it matches hidden, not the rest", await until(async () => JSON.stringify(await seen()) === JSON.stringify({ s1: false, s2: false, story: true, banner: true }), 5000)
  && /Previewing without 2 elements/.test((await picker())?.status ?? ""), [await seen(), await picker()])
await key("P")
check("… P again shows them", await until(async () => (await seen())?.s1 === true, 5000), await seen())
await key("Down")
check("↓ narrows back", await until(async () => (await picker())?.selector === "span.label", 5000), await picker())
await key("Up")
await until(async () => (await picker())?.selector === "my-card[is-sponsored]", 5000)
await key("Return")
const RULE = "127.0.0.1##my-card[is-sponsored]"
check("Enter keeps the rule in the blocked elements list, under its site", await until(() => note().includes(`## 127.0.0.1\n\n- \`${RULE}\``), 10000), note())
check("… the picker's gone", (await picker()) === null)
await wait(2600) // (past the picker's own preview: the rule hides them now)
check("… and they stay hidden by the rule", JSON.stringify(await seen()) === JSON.stringify({ s1: false, s2: false, story: true, banner: true }), await seen())
await inPage("location.reload()")
await wait(1500)
check("a reload: still hidden", await until(async () => JSON.stringify(await seen()) === JSON.stringify({ s1: false, s2: false, story: true, banner: true }), 10000), await seen())

// ---------- the menu's list: show it again ----------
await button.click()
await menuItem(/^Hidden on 127\.0\.0\.1/).hover()
const row = menuItem("my-card[is-sponsored]")
check("the Shields menu lists the site's rules", await until(() => row.count(), 5000), await win.locator("[role=menu]").allInnerTexts().catch(() => []))
await row.click()
check("a click shows it again, without a reload", await until(async () => (await seen())?.s1 === true && (await seen())?.s2 === true, 10000), await seen())
check("… and takes it out of the list", await until(() => !note().includes(RULE), 10000), note())

// ---------- agents ----------
await runOp("web-viewer.block", { rule: ".promo-banner", site: "127.0.0.1" })
check("an agent's rule (web-viewer.block) hides at once", await until(async () => (await seen())?.banner === false, 10000) && note().includes("127.0.0.1##.promo-banner"), [await seen(), note()])
await runOp("web-viewer.unblock", { rule: "127.0.0.1##.promo-banner" })
check("… and unblock shows it again", await until(async () => (await seen())?.banner === true, 10000) && !note().includes("promo-banner"), [await seen(), note()])
await runOp("web-viewer.block", { rule: "##.promo-banner" })
check("a rule for every site (a class's, matched by what the page has) hides at once too", await until(async () => (await seen())?.banner === false, 10000) && note().includes("## Every site"), [await seen(), note()])
await runOp("web-viewer.unblock", { rule: "##.promo-banner" })
check("… and is taken back", await until(async () => (await seen())?.banner === true, 10000), await seen())

// ---------- site styles ----------
/** How the page's parts look, and the vault's look as the page has it. */
const looks = () => inPage(`(() => { const css = (sel, p) => getComputedStyle(document.querySelector(sel))[p]
  const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
  return { card: css("#story .inner", "backgroundColor"), banner: css("#banner", "color"), bg: v("--vault-background"), scheme: v("--vault-color-scheme") } })()`)
const EEF = "rgb(238, 238, 255)"
check("no style: the site as it made it", (await looks())?.card === EEF && !(await looks())?.bg, await looks())
fs.mkdirSync(path.dirname(STYLE), { recursive: true })
fs.writeFileSync(STYLE, ".inner { background: var(--vault-background) }\n#banner { color: rgb(1, 2, 3) }\n")
check("a site's style applies at once, over the page's own, with the vault's look", await until(async () => {
  const l = await looks()
  return l?.banner === "rgb(1, 2, 3)" && l.card !== EEF && !!l.bg && /^(light|dark)$/.test(l.scheme)
}, 10000), await looks())
await inPage("location.reload()")
await wait(1500)
check("a reload: still styled, from its first paint", await until(async () => (await looks())?.banner === "rgb(1, 2, 3)", 10000), await looks())
const appearance = path.join(VAULT, ".vaultite/appearance.json")
const look = fs.existsSync(appearance) ? JSON.parse(fs.readFileSync(appearance, "utf8")) : {}
const was = (await looks())?.scheme, other = was === "dark" ? "light" : "dark"
fs.writeFileSync(appearance, JSON.stringify({ ...look, theme: other }, null, 2) + "\n")
check("the vault's look changing (light, dark) reaches the page", await until(async () => (await looks())?.scheme === other, 10000), await looks())
fs.writeFileSync(appearance, JSON.stringify(look, null, 2) + "\n")
await button.click()
check("the Shields menu has the site's style, on", await until(() => menuItem("Style for 127.0.0.1").count(), 5000)
  && (await menuItem("Style for 127.0.0.1").getAttribute("aria-checked")) === "true", await win.locator("[role=menu]").allInnerTexts().catch(() => []))
await menuItem("Style for 127.0.0.1").click()
check("turned off: the site as it made it, without a reload", await until(async () => (await looks())?.banner !== "rgb(1, 2, 3)" && (await looks())?.card === EEF, 10000), await looks())
await button.click()
await menuItem("Style for 127.0.0.1").click()
check("… and on again", await until(async () => (await looks())?.banner === "rgb(1, 2, 3)", 10000), await looks())
fs.rmSync(STYLE)
check("its file gone: the site as it made it", await until(async () => (await looks())?.card === EEF, 10000), await looks())
await button.click()
await menuItem("Style this site…").click()
check("Style this site…: its file made from the template, opened beside the page", await until(() => fs.existsSync(STYLE) && fs.readFileSync(STYLE, "utf8").includes("--vault-background"), 10000)
  && await until(() => win.getByText("127.0.0.1.css").first().isVisible().catch(() => false), 10000), fs.existsSync(STYLE))

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
