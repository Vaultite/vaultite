// A site's dropdowns in the desktop app's Browser open and stay open as in Chrome, with the page alone and while the
// window is raised over it (a toast, a float, a sidebar peeking: layers.ts "through"): a CSS :hover menu at the page's
// top (as government sites' headers), a jQuery UI combobox (its list closes as its field blurs), a customizable
// <select> (its picker a popover, closed by any blur), a native <select> getting the press that opens it, a list box.
// And nothing takes the keyboard from the page after a press, the keyboard in the page, the address bar or a note beside:
// every webContents.focus() is logged. A quiet window is never key, so both its page and a site's say they have the
// focus and a site never hears a blur from that: the logged focus() calls are what tells a theft.
// A native <select>'s menu is drawn by macOS on the screen: only the press that opens it is checked.
// WRITES: the throwaway vault only.
//   node web/qa/dropdowns.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait, uiAt } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-dropdowns-"))

// ---------- the made-up site: Lighthouse's tax portal ----------
// (the header as MyTax Illinois draws it: W3Schools' hover dropdown, open only while the pointer's over it)
const HEAD = `<style>
.navbar{overflow:hidden;float:right}.navbar a{float:right;font-size:16px;color:#fff;padding:14px 16px;text-decoration:none}
.dropdown{float:right;overflow:hidden}.dropdown .dropbtn{font-size:16px;border:none;outline:none;color:#fff;padding:14px 16px;background:inherit;margin:0}
.dropdown:hover .dropbtn{background:#3fa2eb}.dropdown-content{display:none;position:absolute;background:#0e76bc;min-width:160px;z-index:500}
.dropdown-content a{float:none;color:#fff;padding:12px 16px;display:block;text-decoration:none}.dropdown:hover .dropdown-content{display:block}
header{background:#0e76bc;height:48px}
</style>
<header><div class=navbar><a href="#privacy">Privacy</a>
  <div class=dropdown id=contact><button class=dropbtn>Contact</button><div class=dropdown-content><a href="#c1">Contact us</a><a href="#c2">Offices</a></div></div>
  <div class=dropdown id=help><button class=dropbtn id=helpbtn>Help</button><div class=dropdown-content id=helpmenu><a id=manual href="#m">Help manual</a><a href="#f">FAQs</a><a href="#s">Site map</a></div></div>
</div></header>`
// (jQuery UI's combobox, as WDC's: the toggle focuses the field and searches; the list closes when the field blurs,
// unless the press was on the list, and on a press outside)
const COMBO = `<style>#combo{position:relative}#list{position:absolute;left:0;top:34px;margin:0;padding:0;list-style:none;background:#fff;border:1px solid #888;width:220px}
#list li{padding:6px 10px}select,input,button{font-size:16px}.row{margin:24px 0;display:flex;gap:12px;align-items:center}
select.base,select.base::picker(select){appearance:base-select}</style>
<div class=row><span id=combo><input id=field placeholder="County"><button id=toggle type=button>Show all</button><ul id=list hidden></ul></span></div>
<div class=row><select class=base id=base><option>Adams</option><option>Brown</option><option>Cook</option></select></div>
<div class=row><select id=native><option>Single</option><option>Married</option></select></div>
<div class=row><select id=box size=4><option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option></select></div>
<script>
const COUNTIES = ["Adams", "Brown", "Cook", "DuPage", "Kane", "Lake"]
const list = document.getElementById("list"), field = document.getElementById("field"), toggle = document.getElementById("toggle")
let cancelBlur = false, wasOpen = false, searching = 0
const close = (why) => { if (!list.hidden) { list.hidden = true; log("list closed: " + why) } }
const suggest = () => { list.replaceChildren(...COUNTIES.map((c) => Object.assign(document.createElement("li"), { textContent: c }))); list.hidden = false; log("list open") }
list.addEventListener("mousedown", (e) => { e.preventDefault(); cancelBlur = true; queueMicrotask(() => { cancelBlur = false }) })
field.addEventListener("blur", () => { if (cancelBlur) return; clearTimeout(searching); close("blur") })
document.addEventListener("mousedown", (e) => { if (!list.hidden && !document.getElementById("combo").contains(e.target)) close("press outside") })
toggle.addEventListener("mousedown", () => { wasOpen = !list.hidden })
toggle.addEventListener("click", () => { field.focus(); if (wasOpen) return; searching = setTimeout(suggest, 0) })
// (the native select's own menu is drawn by macOS on the screen, so its press is kept from opening it; what matters
// is that the press reaches it, trusted, with nothing else having taken it)
document.getElementById("native").addEventListener("mousedown", (e) => { window.__native = (window.__native || 0) + (e.isTrusted && !e.defaultPrevented ? 1 : 0); e.preventDefault() })
</script>`
const LOG = `<script>
window.__log = []
const log = (s) => window.__log.push([Math.round(performance.now()), s])
const who = (t) => t && t.id ? "#" + t.id : t === window ? "window" : t && t.nodeName ? t.nodeName.toLowerCase() : String(t)
addEventListener("blur", (e) => { if (e.target === window) log("window blur") })
addEventListener("focus", (e) => { if (e.target === window) log("window focus") })
document.addEventListener("focusout", (e) => log("focusout " + who(e.target) + " to " + who(e.relatedTarget)))
</script>`
const server = http.createServer((_q, r) => {
  r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  r.end(`<!doctype html><html><head><meta charset=utf-8><title>Lighthouse tax</title></head><body style="margin:0;font:16px system-ui;background:#f4f6f8">
${LOG}${HEAD}<main style="padding:24px 24px 24px 220px">${COMBO}</main></body></html>`)
})
await new Promise((ok) => server.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${server.address().port}/`

const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer"])] }))

// ---------- the app ----------
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  const ui = (body) => uiAt(origin)(body)
  // Every webContents.focus(), by whose (the window's own page or a site's), and when (main process ms).
  await app.evaluate(({ BaseWindow, BrowserWindow }) => {
    const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow))
    w.setBounds({ x: 40, y: 40, width: 1280, height: 800 })
    globalThis.__focus = []
    const proto = Object.getPrototypeOf(w.webContents), focus = proto.focus
    proto.focus = function () {
      globalThis.__focus.push({ t: Date.now(), app: this === w.webContents, by: (new Error().stack ?? "").split("\n").slice(2, 4).map((l) => l.trim()).join(" < ") })
      return focus.call(this)
    }
  })
  await ui({ action: "open", path: `view:web/${SITE}`, newTab: true })

  /** The page on screen: its view's bounds (window points) and what it says of itself. */
  const view = () => app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow))
    const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && x.getBounds().x > -1000)
    if (!v) return null
    return { ...v.getBounds(), url: v.webContents.getURL(), focused: v.webContents.isFocused() }
  })
  /** In the page: `js`'s value. */
  const inPage = (js) => app.evaluate(({ BaseWindow, BrowserWindow }, js) => {
    const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow))
    const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && x.getBounds().x > -1000)
    return v.webContents.executeJavaScript(js)
  }, js)
  const placed = await until(async () => (await view())?.url === SITE && (await inPage("!!document.getElementById('box')")), 30000)
  check("the site shows", !!placed, await view())
  await wait(800)
  /** A point of the page away from every list (its right edge, out of a peeking sidebar's way). */
  const side = [(await inPage("innerWidth")) - 40, 400]
  /** The middle of `sel` in the page (CSS px from its corner), `dy` down from it. */
  const at = async (sel, dy = 0) => inPage(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2 + ${dy})] })()`)

  // The pointer as the Mac's: over the page alone, the page's view hears it (and a press makes it the first responder:
  // the keyboard's); with the window raised over it, the window's view hears it (the press making the window's page the
  // first responder) and passes it on (layers.ts passPointer).
  let raised = false
  /** Where the keyboard is put in the app before each press (null: left where it is). */
  let before = null
  const move = async ([x, y]) => {
    if (raised) { const b = await view(); await win.mouse.move(b.x + x, b.y + y, { steps: 3 }); return }
    await app.evaluate(({ BaseWindow, BrowserWindow }, [x, y]) => {
      const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow))
      const wc = w.contentView.children.find((v) => v.webContents && v.webContents !== w.webContents && v.getVisible() && v.getBounds().x > -1000).webContents
      wc.sendInputEvent({ type: "mouseMove", x, y })
    }, [x, y])
  }
  const click = async ([x, y]) => {
    if (before) { await win.evaluate(before); await wait(100) }
    await move([x, y])
    await app.evaluate(({ BaseWindow, BrowserWindow }, [x, y, raised]) => {
      const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow))
      const wc = w.contentView.children.find((v) => v.webContents && v.webContents !== w.webContents && v.getVisible() && v.getBounds().x > -1000).webContents
      globalThis.__pressed = Date.now()
      // (what macOS does as the press lands, before any page hears it; not logged as the app's doing)
      const first = raised ? w.webContents : wc
      Object.getPrototypeOf(first).focus.call(first)
      globalThis.__focus.pop()
      if (raised) return
      wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 })
      wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 })
    }, [x, y, raised])
    if (raised) { await win.mouse.down(); await win.mouse.up() }
    // (a key window's page losing the keyboard hears it: a quiet window, never key, doesn't, so it's told as it would be)
    else if (before) await win.evaluate(() => {
      const a = document.activeElement
      if (a && a !== document.body) { a.dispatchEvent(new FocusEvent("blur")); a.dispatchEvent(new FocusEvent("focusout", { bubbles: true })) }
      window.dispatchEvent(new FocusEvent("blur"))
    })
  }
  /** The window's page given the keyboard since the last press (by the app, not macOS), and the page's blurs. */
  const stolen = () => app.evaluate(() => globalThis.__focus.filter((f) => f.app && f.t >= globalThis.__pressed))
  const clearLog = () => inPage("window.__log.length = 0")
  const pageLog = () => inPage("window.__log.map(([t, s]) => t + ' ' + s)")
  const away = () => move(side)

  const battery = async (mode, cover) => {
    // (the pointer off the menus, and every list closed, between each)
    await away()
    await cover?.()
    await wait(300)
    // A CSS :hover menu at the top: shown while the pointer's on its button, and on its items.
    await move(await at("#helpbtn"))
    const hovered = await until(() => inPage("getComputedStyle(helpmenu).display === 'block'"), 2000)
    check(`${mode}: a :hover menu at the page's top opens under the pointer`, hovered, await inPage("[...document.querySelectorAll(':hover')].map((e) => e.id || e.nodeName).join(' ')"))
    await move(await at("#helpbtn", 20))
    await move(await at("#manual"))
    await wait(300)
    check(`${mode}: … and stays open as the pointer goes down onto its items`, await inPage("getComputedStyle(helpmenu).display === 'block' && manual.matches(':hover')"),
      await inPage("[...document.querySelectorAll(':hover')].map((e) => e.id || e.nodeName).join(' ')"))
    await click(await at("#helpbtn"))
    await wait(500)
    check(`${mode}: … and stays open after a click on its button`, await inPage("getComputedStyle(helpmenu).display === 'block'"), await pageLog())
    await away()
    await wait(200)
    check(`${mode}: … and closes as the pointer leaves`, await inPage("getComputedStyle(helpmenu).display === 'none'"))

    // The combobox: its toggle opens the list and focuses the field; 500 ms later both still are.
    await clearLog()
    await click(await at("#toggle"))
    await wait(500)
    const combo = await inPage("({ open: !list.hidden, field: document.activeElement === field, has: document.hasFocus() })")
    check(`${mode}: a combobox's toggle opens its list, still open 500 ms on`, combo.open, { combo, log: await pageLog(), stolen: await stolen() })
    check(`${mode}: … its field keeping the keyboard`, combo.field, { combo, log: await pageLog() })
    check(`${mode}: … and nothing of the app took the keyboard after the press`, !(await stolen()).length, await stolen())
    // (closed by a press elsewhere, as jQuery UI does)
    await click(side)
    await wait(200)

    // A customizable select: its picker (a popover, closed by a blur) open 500 ms after the press.
    await clearLog()
    await click(await at("#base"))
    await wait(500)
    const picker = await inPage("({ open: base.matches(':open'), focused: document.activeElement === base })")
    check(`${mode}: a customizable <select> opens its picker, still open 500 ms on`, picker.open, { picker, log: await pageLog(), stolen: await stolen() })
    check(`${mode}: … and nothing of the app took the keyboard`, !(await stolen()).length, await stolen())
    await inPage("document.activeElement?.blur(); 0")
    await click(side)
    await wait(200)

    // A native select gets its press; a list box takes one and keeps the keyboard.
    await inPage("window.__native = 0")
    await click(await at("#native"))
    check(`${mode}: a native <select> gets the press that opens its menu`, await until(() => inPage("window.__native === 1"), 2000), await inPage("window.__native"))
    await clearLog()
    await click(await at("#box option:nth-child(3)"))
    await wait(500)
    const box = await inPage("({ value: box.value, focused: document.activeElement === box })")
    check(`${mode}: a list box <select> picks the option pressed, keeping the keyboard`, box.value === "Q3" && box.focused, { box, log: await pageLog(), stolen: await stolen() })
    await inPage("box.selectedIndex = -1; document.activeElement?.blur(); 0")
  }

  // ---------- the page alone ----------
  check("the window isn't over the page", await until(async () => !(await win.evaluate(() => "overPages" in document.documentElement.dataset)), 15000),
    await win.evaluate(() => [...document.querySelectorAll("[data-sonner-toast], [data-floats], dialog[open], :popover-open, [role=menu], [role=listbox], [role=dialog], [role=alertdialog]")].map((e) => e.outerHTML.slice(0, 200))))
  await battery("the page alone")

  // ---------- the window over it, letting the pointer through ----------
  const overPages = () => win.evaluate(() => "overPages" in document.documentElement.dataset)
  const uncover = async () => {
    await win.evaluate(() => document.getElementById("qa-cover")?.remove())
    check("(the window back under the page)", await until(async () => !(await overPages()), 15000))
    raised = false
  }
  /** Something of the app's over a part of the page: a float (no pointer of its own) or a panel taking its own. */
  const cover = (css, floats) => async () => {
    await win.evaluate(([css, floats]) => {
      const d = document.createElement("div")
      d.id = "qa-cover"
      if (floats) d.dataset.floats = ""
      d.style.cssText = `position:fixed;z-index:50;background:#333;${css}`
      document.body.append(d)
    }, [css, floats])
    raised = !!(await until(overPages, 5000))
    check("(the window raised over the page)", raised)
  }
  await battery("a float in a corner", cover("right:20px;bottom:20px;width:200px;height:40px;pointer-events:none", true))
  await uncover()
  // (a hidden sidebar peeking over the page's left: it takes its own pointer, the rest goes on to the page)
  const left = (await view()).x
  await battery("a sidebar peeking over its left", cover(`left:0;top:0;bottom:0;width:${left + 180}px`, false))
  await uncover()
  await battery("a toast", async () => {
    await ui({ action: "notify", text: "Saved Lighthouse tax return", button: { label: "Open", open: "Welcome.md" } })
    raised = !!(await until(overPages, 5000))
    check("(the toast raises the window over the page)", raised)
  })
  await uncover()

  // ---------- the keyboard in the app before the press: the page takes it, and keeps it ----------
  before = () => document.querySelector("[data-web-address]").focus()
  await battery("the keyboard in the address bar first")
  await ui({ action: "open", path: "Notes/Lisbon trip.md", split: "right" })
  check("(a note beside the page)", await until(() => win.evaluate(() => !!document.querySelector(".cm-content")), 15000))
  await wait(1500)
  before = () => document.querySelector(".cm-content").focus()
  await battery("the keyboard in a note in the pane beside")
  before = null
  console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
} finally {
  await app.close().catch(() => {})
  server.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
