// A sidebar's panels each in their own box (components/Sidebar.tsx, panelLayout.ts) in the desktop app, with a deep
// tree in Files (core/virtual.ts): scrolled fast (big wheel deltas, jumps, a fling) and laid out again while scrolled
// (Tabs growing and shrinking above it, the window resized), its rows always fill what's in sight, it keeps the room
// the others leave, and nothing scrolls past its rows; no panel's scroller is cut off by what holds it, and each one's
// scrollbar is where a sidebar scrolling as one has its own, overlaid or classic. WRITES: the throwaway vault only.
//   node web/qa/panelscroll.mjs <vault copy> [out dir]
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"
import { stopTerminals } from "../../tools/test/lib.ts"

const { args: [VAULT, OUT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-panelscroll-"))
if (OUT) fs.mkdirSync(OUT, { recursive: true })

// A deep tree: rounds of sections, folders in folders, and folders past the limit (a "Show N more" row each).
const D = "Qa deep"
fs.rmSync(path.join(VAULT, D), { recursive: true, force: true })
for (let r = 1; r <= 10; r++) for (const sec of ["Knowledge map", "Readings", "Exercises"]) for (let f = 1; f <= 16; f++) {
  const dir = path.join(VAULT, D, `Round ${r}`, sec, f % 4 === 0 ? "Deeper" : "")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${f} Transit map.md`), `Round ${r}, ${sec}, ${f}.\n`)
}
const conf = (name, v) => { const p = path.join(VAULT, ".vaultite", `${name}.json`); fs.writeFileSync(p, JSON.stringify({ ...(fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {}), ...v }, null, 2)) }
conf("files", { folderLimit: 10, autoReveal: false })
conf("sidebars", { left: ["search:search", "pages:pages", "tabs:tabs", "inbox:inbox", "files:files"], right: ["tags:tags", "outline:outline"], collapsed: [], heights: {} })
conf("appearance", { sidebarScroll: null })

// A Mac's scrollbars as with a trackpad (System Settings: Show scroll bars when scrolling), whatever this one's are.
const bars = process.platform === "darwin" ? ["-AppleShowScrollBars", "WhenScrolling"] : []
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT, ...bars],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
let port = ""
try {
  const win = await app.firstWindow()
  watch(win, { console: true })
  const size = (w, h) => app.evaluate(({ BaseWindow }, [w, h]) => BaseWindow.getAllWindows()[0].setSize(w, h), [w, h])
  await size(1280, 820)
  await win.waitForSelector("[data-panel='files:files'] [role=tree]", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  port = new URL(origin).port
  const frames = () => win.evaluate(() => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 200) }))
  const BOX = "[data-panel='files:files'] [data-panel-scroll]"

  /** The Files panel as drawn: the most of what's in sight (under its heading, above where its rows end) that no row
   *  covers, the room left under it in the sidebar, a row's height, and its scroller's height against what it holds. */
  const look = () => win.evaluate((sel) => {
    const sc = document.querySelector(sel), ul = sc.querySelector("[role=tree]"), head = sc.querySelector("[data-panel-handle]")
    const b = sc.getBoundingClientRect(), u = ul.getBoundingClientRect()
    const end = Math.min(b.bottom, u.bottom - parseFloat(getComputedStyle(ul).paddingBottom))
    const lis = [...ul.querySelectorAll(":scope > li[data-vi]")]
    const rows = lis.map((li) => li.getBoundingClientRect()).filter((r) => r.bottom > head.getBoundingClientRect().bottom && r.top < end).sort((x, y) => x.top - y.top)
    let at = head.getBoundingClientRect().bottom, gap = 0
    for (const r of rows) { gap = Math.max(gap, r.top - at); at = Math.max(at, r.bottom) }
    gap = Math.max(gap, end - at)
    const body = sc.closest("[data-sidebar-body]"), last = [...body.querySelectorAll(":scope > [data-panel]")].at(-1)
    const free = body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).paddingBottom) - last.getBoundingClientRect().bottom
    return { gap: Math.round(gap), free: Math.round(free), row: lis[0]?.getBoundingClientRect().height ?? 0, top: Math.round(sc.scrollTop), box: sc.clientHeight,
      past: Math.round(sc.scrollHeight - (u.bottom - b.top + sc.scrollTop)), more: rows.length === 1 && !!lis.find((li) => li.dataset.treeMore) }
  }, BOX)
  const fails = []
  /** One look, kept when it's wrong: rows missing in sight, room left under the tree, or room scrolled past its end. */
  const step = async (what) => {
    await frames()
    const l = await look()
    if (l.gap > 1 || l.free > l.row + 1 || Math.abs(l.past) > 1 || l.more) fails.push({ what, ...l })
    return l
  }

  // Every folder open: thousands of rows, the tree taking the room the panels above leave.
  const files = win.locator("[data-panel='files:files']")
  if (await files.locator("[aria-label='Collapse all']").count()) await files.locator("[aria-label='Collapse all']").click({ force: true })
  await files.locator("[aria-label='Expand all']").click({ force: true })
  await until(async () => (await win.evaluate((sel) => document.querySelector(sel).scrollHeight, BOX)) > 10000, 10000)
  const opened = await step("every folder opened")
  check("opened, the tree fills the room the panels above it leave (no more than a row's sliver under it)", opened.free <= opened.row + 1 && opened.box > 300, opened)

  const box = await win.locator(BOX).boundingBox()
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 8; i++) { await win.mouse.wheel(0, 2400); await step(`wheel ${i}`) }
  for (let i = 0; i < 8; i++) { await win.mouse.wheel(0, -1800); await step(`wheel back ${i}`) }
  for (const f of [0.5, 0.05, 0.95, 1, 0.3, 0.7, 0]) {
    await win.evaluate(([sel, f]) => { const sc = document.querySelector(sel); sc.scrollTop = f * (sc.scrollHeight - sc.clientHeight) }, [BOX, f])
    await step(`jump to ${f}`)
  }
  // A fling: a trackpad's momentum, big deltas easing off, a frame apart.
  for (const d of [900, 760, 640, 530, 440, 360, 290, 230, 180, 140, 100, 70, 45, 25, 10]) { await win.mouse.wheel(0, d); await wait(16); await step(`fling ${d}`) }
  const end = await win.evaluate((sel) => { const sc = document.querySelector(sel); sc.scrollTop = sc.scrollHeight; return sc.scrollTop }, BOX)
  const atEnd = await step("at the end")
  check("scrolled fast (wheel, jumps, a fling), its rows fill what's in sight every time, and its end is its last row's",
    !fails.length && end > 10000 && atEnd.gap <= 1, fails.slice(0, 6))

  // Laid out again while scrolled far down: Tabs grows and shrinks above it, the window resizes.
  fails.length = 0
  await win.evaluate((sel) => { document.querySelector(sel).scrollTop = 6000 }, BOX)
  await step("scrolled to the middle")
  const tabs = () => win.locator("[data-panel='tabs:tabs'] [data-open-tab]").count()
  const had = await tabs()
  for (let i = 0; i < 2; i++) { await win.locator("[data-panel='tabs:tabs'] [data-new-tab-row]").click(); await until(async () => (await tabs()) > had + i, 5000) }
  const grown = await step("Tabs grew above it")
  await win.keyboard.press("ControlOrMeta+w"); await until(async () => (await tabs()) <= had + 1, 5000)
  await step("Tabs shrank above it")
  await size(1280, 700); await step("the window shorter")
  await size(1280, 900); await step("the window taller")
  const kept = await look()
  check("laid out again while scrolled, the tree keeps its room and its rows (none left as one row or a Show more)",
    !fails.length && grown.top > 5000 && kept.box > 300, fails.length ? fails.slice(0, 6) : kept)
  if (OUT) await win.screenshot({ path: path.join(OUT, "panelscroll.png") })

  // Nothing that holds a panel's scroller cuts it off (its scrollbar's right with it), in either sidebar, and its right
  // edge is where a sidebar scrolling as one has its own: with the system's overlaid scrollbars, then the app's own.
  const edges = () => win.evaluate(() => {
    const cut = [], rights = {}
    for (const sc of document.querySelectorAll("[data-sidebar-body] [data-panel-scroll], [data-sidebar-body][data-scroll=sidebar]")) {
      if (!/auto|scroll/.test(getComputedStyle(sc).overflowY)) continue
      const r = sc.getBoundingClientRect(), name = sc.closest("[data-panel]")?.dataset.panel ?? sc.dataset.sidebarBody
      rights[name] = r.right
      for (let p = sc.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p)
        if (s.overflowX === "visible") continue
        const b = p.getBoundingClientRect(), inner = b.left + p.clientLeft + p.clientWidth
        if (r.right > inner + 0.5 || r.left < b.left + p.clientLeft - 0.5) cut.push({ name, right: r.right, by: p.dataset.sidebarBody ? "sidebar body" : p.tagName, at: inner })
      }
    }
    return { cut, rights }
  })
  const classic = (on) => win.evaluate((on) => {
    const html = document.documentElement
    html.toggleAttribute("data-classic-scrollbars", on)
    html.style.setProperty("--scrollbar-room", on ? "12px" : "0px")
  }, on)
  const appearance = (v) => fetch(`${origin}/api/config/appearance`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }, body: JSON.stringify(v) })
  const scrollingAsOne = () => until(() => win.evaluate(() => !!document.querySelector("[data-sidebar-body=left][data-scroll=sidebar]")), 5000)
  const native = await win.evaluate(() => document.documentElement.hasAttribute("data-classic-scrollbars"))
  for (const kind of native ? ["classic"] : ["overlaid", "classic"]) {
    if (kind === "classic" && !native) await classic(true)
    await frames()
    const own = await edges()
    await appearance({ sidebarScroll: "sidebar" }); await scrollingAsOne(); await frames()
    const one = await edges()
    await appearance({ sidebarScroll: null }); await until(() => win.evaluate(() => !!document.querySelector("[data-sidebar-body=left][data-scroll=panels]")), 5000)
    check(`${kind} scrollbars: no panel's scroller is cut off by what holds it, in either sidebar`, !own.cut.length && Object.keys(own.rights).length >= 3, own)
    check(`${kind} scrollbars: Files' scrollbar is where the sidebar's is when it scrolls as one`, Math.abs(own.rights["files:files"] - one.rights.left) < 0.5, { own: own.rights, one: one.rights })
  }
  if (!native) await classic(false)
} finally {
  await app.close().catch(() => {})
  // (and its terminal keeper, which outlives the app)
  if (port) stopTerminals(port)
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
