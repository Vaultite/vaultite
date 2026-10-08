// Toasts (core/notify.ts, components/Toast.tsx): trashing a file from the tree says so with Undo, and Undo brings it
// back; moving one (Move file to…) says where with Undo, and Undo moves it back; Undo after the file moved again fails
// with an error toast; `vau notify` with a button that opens a file, and --error (a red icon); at most three stack;
// hovering pauses them; the colours follow dark mode and a gallery scheme; desktop bottom right above the status bar,
// phones (390px) above the bar. WRITES a "Qa toast" folder and appearance.json (put back): throwaway server only.
//   node web/qa/toast.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { devices } from "playwright-core"
import { SHOTS, apiAt, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = `${SHOTS}toast/`], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const exists = async (p) => (await api("GET", "files")).files.some((f) => f.path === p)
// Without the app's variables from wherever this runs (a terminal's VAULTITE_TERMINAL ties a notice to that terminal,
// which gives its toast an Open button and so a longer life), so it tests the same thing anywhere.
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^VAULTITE_/.test(k)))
const vau = (...args) => execFileSync("node", [new URL("../../bin/vau", import.meta.url).pathname, ...args], { env: { ...clean, VAULTITE_URL: B.replace(/\/$/, "") }, encoding: "utf8" })

// A fresh folder: Qa toast/{Doomed.md, Mover.md, Target/}
await fetch(`${B}api/file?path=${encodeURIComponent("Qa toast")}`, { method: "DELETE" })
for (const p of ["Qa toast", "Qa toast/Target", "Qa toast/Elsewhere"]) await api("POST", "folder", { path: p })
await api("POST", "file", { path: "Qa toast/Doomed.md", text: "Delete me.\n" })
await api("POST", "file", { path: "Qa toast/Mover.md", text: "Move me.\n" })
const savedLook = await api("GET", "config/appearance")
const look = (patch) => api("PUT", "config/appearance", { ...savedLook, ...patch })
await look({ theme: "light", scheme: "default" })

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(B).origin })
const page = watch(await ctx.newPage(), { console: true })
const shot = (p, name) => p.screenshot({ path: `${OUT}${name}.png` })
const toasts = (p = page) => p.locator("[data-sonner-toast]")
const toastWith = (text, p = page) => p.locator("[data-sonner-toast]", { hasText: text }).first()
const row = (p) => page.locator(`aside [role=tree] div[data-tree-path="${p}"]`).first()
const menu = async (path, item) => { await row(path).click({ button: "right" }); await page.getByRole("menuitem", { name: item, exact: true }).click() }
/** Wait for every toast to go by itself (removing them by hand would break sonner's own state). */
const dismissAll = async (p = page) => { await p.mouse.move(5, 5); await p.waitForFunction(() => !document.querySelector("[data-sonner-toast]"), null, { timeout: 30_000 }); await wait(100) }

await page.goto(B); await wait(1500)
if (!(await row("Qa toast/Doomed.md").isVisible())) { await row("Qa toast").locator("button").first().click(); await wait(300) }

// 1. Trash a file from the tree: no confirm, a toast with Undo; Undo brings it back.
let dialogs = 0
page.on("dialog", (d) => { dialogs++; d.dismiss() })
await menu("Qa toast/Doomed.md", "Delete")
await wait(500)
check("trashing asks nothing", dialogs === 0, dialogs)
check("the file is in the trash", !(await exists("Qa toast/Doomed.md")))
const del = toastWith("Moved Doomed to trash")
check("a toast says it was trashed, with Undo", await del.isVisible() && (await del.locator("[data-button]").innerText()) === "Undo", await toasts().allInnerTexts())
await shot(page, "desktop-deleted")
const tb = await del.boundingBox()
check("desktop: bottom right, above the status bar (28px) with a gap", tb.x + tb.width > 1440 - 40 && tb.y + tb.height <= 900 - 36, tb)
const styles = await del.evaluate((el) => { const cs = getComputedStyle(el), root = getComputedStyle(document.documentElement)
  const probe = document.createElement("div"); probe.style.background = "var(--card)"; document.body.append(probe)
  const card = getComputedStyle(probe).backgroundColor; probe.remove()
  return { bg: cs.backgroundColor, card, size: cs.fontSize, radius: cs.borderRadius, font: cs.fontFamily, ui: root.getPropertyValue("--font-sans") } })
check("its colours are the app's card, 13px text, a small radius", styles.bg === styles.card && styles.size === "13px" && parseFloat(styles.radius) <= 10, styles)
check("no icon on a plain toast", !(await del.locator("[data-icon] svg").count()))
await del.locator("[data-button]").click()
await wait(800)
check("Undo put the file back", await exists("Qa toast/Doomed.md"))
check("and it shows in the tree again", await row("Qa toast/Doomed.md").isVisible())
await dismissAll()

// 2. Move a file with Move file to…: a toast says where, Undo moves it back.
await menu("Qa toast/Mover.md", "Move file to…")
await page.keyboard.type("Qa toast/Target"); await wait(200); await page.keyboard.press("Enter")
await wait(700)
check("the file moved", await exists("Qa toast/Target/Mover.md") && !(await exists("Qa toast/Mover.md")))
const moved = toastWith("Moved to Qa toast/Target")
check("a toast says where it went, with Undo", await moved.isVisible(), await toasts().allInnerTexts())
await shot(page, "desktop-moved")
await moved.locator("[data-button]").click()
await wait(800)
check("Undo moved it back", await exists("Qa toast/Mover.md") && !(await exists("Qa toast/Target/Mover.md")))
await dismissAll()

// 3. Rename (the tree's Rename), then Undo.
await menu("Qa toast/Mover.md", "Rename")
await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.type("Renamed"); await page.keyboard.press("Enter")
await wait(700)
const ren = toastWith("Renamed to Renamed")
check("a rename says so, with Undo", await exists("Qa toast/Renamed.md") && await ren.isVisible(), await toasts().allInnerTexts())
await ren.locator("[data-button]").click(); await wait(700)
check("Undo renamed it back", await exists("Qa toast/Mover.md") && !(await exists("Qa toast/Renamed.md")))
await dismissAll()

// 4. Undo after the file moved again (an agent, another device): an error toast, nothing moves.
await menu("Qa toast/Mover.md", "Move file to…")
await page.keyboard.type("Qa toast/Target"); await wait(200); await page.keyboard.press("Enter")
await wait(700)
await api("POST", "file/move", { from: "Qa toast/Target/Mover.md", to: "Qa toast/Elsewhere/Mover.md" })
await wait(500)
await toastWith("Moved to Qa toast/Target").locator("[data-button]").click()
await wait(800)
const err = toastWith("Couldn't undo")
check("Undo after it moved again fails with an error toast", await err.isVisible(), await toasts().allInnerTexts())
check("the error has a red icon", await err.locator("[data-icon] svg").count() === 1)
check("nothing moved", await exists("Qa toast/Elsewhere/Mover.md") && !(await exists("Qa toast/Mover.md")))
await shot(page, "desktop-undo-failed")
await api("POST", "file/move", { from: "Qa toast/Elsewhere/Mover.md", to: "Qa toast/Mover.md" })
await dismissAll()

// 5. vau notify: a toast in this window, its button opening a file; --error; Copy path.
await page.locator("main, #main-scroll").first().click({ position: { x: 300, y: 300 } }).catch(() => {}); await wait(300)
let out = vau("notify", "Wrote the weekly review", "--action-label", "Open", "--action-open", "Qa toast/Mover.md")
await wait(600)
const agent = toastWith("Wrote the weekly review")
check("vau notify shows a toast here", out.includes("Shown") && await agent.isVisible(), [out, await toasts().allInnerTexts()])
await shot(page, "desktop-vau-notify")
await agent.locator("[data-button]").click(); await wait(800)
check("its button opens the file", decodeURIComponent(await page.evaluate(() => location.hash)).includes("Qa toast/Mover.md"), await page.evaluate(() => location.hash))
vau("notify", "The import failed: the file was empty", "--error")
await wait(600)
const e2 = toastWith("The import failed")
const red = await e2.locator("[data-icon] svg").evaluate((el) => { const probe = document.createElement("div"); probe.style.color = "var(--red)"; document.body.append(probe)
  const want = getComputedStyle(probe).color; probe.remove(); return [getComputedStyle(el).color, want] })
check("vau notify --error: a red icon (--red)", red[0] === red[1], red)
await shot(page, "desktop-error")
await dismissAll()
// (a click on Copy path copies from the vault folder)
await menu("Qa toast/Mover.md", "Copy path")
await wait(400)
check("Copy path says so", await toastWith("Copied the path").isVisible(), await toasts().allInnerTexts())
check("and the path is on the clipboard", (await page.evaluate(() => navigator.clipboard.readText())) === "Qa toast/Mover.md")
await dismissAll()
await menu("Qa toast/Mover.md", "Pin"); await wait(500)
check("Pin says so", await toastWith("Pinned Mover").isVisible(), await toasts().allInnerTexts())
await toastWith("Pinned Mover").locator("[data-button]").click(); await wait(600)
const pinsNow = async () => (await api("GET", "workspaces")).workspaces?.find((w) => w?.pinned)?.pinned ?? (await api("GET", "config/pages")).pinned
check("its Undo unpins it", !(await pinsNow()).includes("Qa toast/Mover.md"), await pinsNow())
await dismissAll()

// 6. At most three at once; hovering pauses them.
for (let i = 1; i <= 5; i++) vau("notify", `Toast number ${i}`)
await wait(700)
const shown = await page.locator("[data-sonner-toast][data-visible=true]").count()
check("at most three show", shown === 3, shown)
await shot(page, "desktop-stack")
await dismissAll()
vau("notify", "Hover keeps me")
await wait(400)
await toastWith("Hover keeps me").hover()
await wait(5500)
check("hovering pauses it (still there after 5.5 s)", await toastWith("Hover keeps me").isVisible())
await page.mouse.move(400, 300)
await wait(5000)
check("and it goes when the pointer leaves", !(await toastWith("Hover keeps me").isVisible().catch(() => false)))

// 7. Dark mode and schemes: the toast is drawn in the scheme's card and text.
for (const [theme, scheme] of [["dark", "default"], ["light", "gruvbox"], ["dark", "nord"], ["light", "catppuccin"]]) {
  await look({ theme, scheme }); await page.reload(); await wait(1500)
  vau("notify", `A toast in ${scheme} ${theme}`, "--action-label", "Open", "--action-open", "Qa toast/Mover.md")
  await wait(600)
  const t = toastWith(`A toast in ${scheme} ${theme}`)
  const c = await t.evaluate((el) => { const cs = getComputedStyle(el)
    const probe = document.createElement("div"); probe.style.background = "var(--card)"; probe.style.color = "var(--foreground)"; document.body.append(probe)
    const p = getComputedStyle(probe); const r = [p.backgroundColor, p.color]; probe.remove()
    return { bg: cs.backgroundColor, fg: cs.color, card: r[0], text: r[1], scheme: document.documentElement.dataset.scheme, dark: document.documentElement.classList.contains("dark") } })
  check(`${scheme} ${theme}: the scheme's card and text`, c.bg === c.card && c.fg === c.text && (c.scheme ?? "default") === scheme && c.dark === (theme === "dark"), c)
  await shot(page, `desktop-${scheme}-${theme}`)
  await dismissAll()
}
await look({ theme: "light", scheme: "default" })

// 8. Phones (390px): bottom centre, above the bar.
const phone = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } })
await phone.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const ph = watch(await phone.newPage(), { label: "phone" })
await ph.goto(B); await wait(1500)
await ph.locator("h1").first().tap().catch(() => {}); await wait(300) // (says this window is the one in use)
vau("notify", "Imported 12 meals from Hevy", "--action-label", "Open", "--action-open", "Qa toast/Mover.md")
await wait(700)
const pt = toastWith("Imported 12 meals", ph)
const bar = await ph.locator("[data-phone-bar]").boundingBox()
const pb = await pt.boundingBox().catch(() => null)
check("phone: the toast shows", !!pb, await toasts(ph).allInnerTexts())
if (pb) {
  check("phone: above the bar", pb.y + pb.height <= bar.y - 4, { toast: pb, bar })
  check("phone: across the width, 16px gutters", Math.abs(pb.x - 16) <= 1 && Math.abs(390 - (pb.x + pb.width) - 16) <= 1, pb)
  check("phone: iOS text size", (await pt.evaluate((el) => getComputedStyle(el).fontSize)) === "15px")
}
await shot(ph, "phone")
await look({ theme: "dark", scheme: "default" }); await ph.reload(); await wait(1500)
await ph.locator("h1").first().tap().catch(() => {}); await wait(300) // (says this window is the one in use)
vau("notify", "Moved to Notes", "--action-label", "Undo", "--action-open", "Qa toast/Mover.md")
await wait(700)
check("phone, dark: the toast shows here", await toastWith("Moved to Notes", ph).isVisible(), await toasts(ph).allInnerTexts())
await shot(ph, "phone-dark")
await look(savedLook)

await browser.close()
await fetch(`${B}api/file?path=${encodeURIComponent("Qa toast")}`, { method: "DELETE" })
await done()
