// The Mac's small motions (core/animation.ts fadeAway, refuse): a menu fades as it closes (components/ContextMenu.tsx),
// its chosen row blinking first, and a press of the right button let go on a row picks it; the palette
// (components/Palette.tsx) and tooltips (components/Tooltip.tsx) fade too, nothing does with Reduce motion; the focus
// ring settles (index.css); a window out of focus greys what's selected (core/windowfocus.ts); a rename the file tree
// can't take (components/FileTree.tsx, core/files.ts nameProblem) shakes, keeping what was typed.
// WRITES "Qa motion": throwaway server only.
//   node web/qa/macmotion.mjs <base url>
import { apiAt, openPalette, qa, until, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url, { motion: true })
const api = apiAt(B, { "X-Vaultite-Client": "app/qa" })

const D = "Qa motion"
await fetch(`${B}api/file?path=${encodeURIComponent(D)}`, { method: "DELETE" })
await api("POST", "folder", { path: D })
await api("POST", "file", { path: `${D}/First.md`, text: "One.\n" })
await api("POST", "file", { path: `${D}/Second.md`, text: "Two.\n" })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage())
const row = (p) => page.locator(`aside [role=tree] div[data-tree-path="${p}"]`).first()
const menus = () => page.locator("[data-menu-list]:not([data-fading] *)").count()
const fading = (tag) => page.evaluate((t) => document.querySelectorAll(t === undefined ? "[data-fading]" : `[data-fading="${t}"]`).length, tag)

await page.goto(B); await wait(1500)
await page.locator('aside [aria-label="Collapse all"]').click().catch(() => {}); await wait(200)
await row(D).locator("button").first().click()
await until(() => row(`${D}/First.md`).count())

// 1. Escape: the menu is gone at once, its picture fading, then gone too.
await row(`${D}/First.md`).click({ button: "right" })
await until(() => menus())
await page.keyboard.press("Escape")
check("a menu closed: gone at once, a picture of it fading", (await menus()) === 0 && (await fading("")) === 1, [await menus(), await fading("")])
check("the picture can't be clicked", await page.evaluate(() => { const g = document.querySelector("[data-fading]"); return !!g && g.inert && getComputedStyle(g).pointerEvents === "none" }))
check("then it's gone", !!(await until(async () => (await fading()) === 0, 1500)))

// 2. A row picked: it blinks (lit, its background animated) before the menu fades.
await row(`${D}/First.md`).click({ button: "right" })
await until(() => menus())
await page.getByRole("menuitem", { name: "Rename", exact: true }).first().click()
const blink = await page.evaluate(() => {
  const g = document.querySelector("[data-fading]")
  const lit = [...(g?.querySelectorAll("button") ?? [])].find((b) => b.style.backgroundColor)
  const fade = g?.querySelector("[data-menu-list]")?.getAnimations()[0]
  return { lit: lit?.textContent ?? null, blinks: !!lit?.getAnimations().length, delay: fade?.effect.getTiming().delay ?? null }
})
check("the chosen row blinks first, then the menu fades", blink.lit?.includes("Rename") && blink.blinks && blink.delay === 100, blink)
const field = page.locator("aside [role=tree] input[aria-label='New name']")
check("and what it chose ran (Rename: the name is a field)", !!(await until(() => field.count())))

// 3. A rename the tree can't take shakes, keeping what was typed; Escape puts the name back.
await field.fill("Second")
await field.press("Enter")
const shook = await field.evaluate((f) => f.getAnimations().some((a) => a.effect.getKeyframes().some((k) => k.translate && k.translate !== "0")))
check("taken (another file's name): refused, saying why", !!(await until(() => page.locator("[data-sonner-toast]", { hasText: "is already taken in this folder" }).count())))
check("taken: the field shakes and keeps what was typed", shook && (await field.count()) === 1 && (await field.inputValue()) === "Second")
await field.fill("second")
await field.press("Enter")
check("taken in another case too (a Mac's disk doesn't tell them apart)", (await field.count()) === 1)
await field.fill(".hidden")
await field.press("Enter")
check("a dot first: refused, saying why", !!(await until(() => page.locator("[data-sonner-toast]", { hasText: "can't start with a dot" }).count())) && (await field.count()) === 1)
await field.fill("a".repeat(260))
await field.press("Enter")
check("too long: refused", !!(await until(() => page.locator("[data-sonner-toast]", { hasText: "too long" }).count())) && (await field.count()) === 1)
await field.press("Escape")
check("Escape: the name as it was", !!(await until(async () => (await field.count()) === 0)) && (await row(`${D}/First.md`).count()) === 1)

// 4. Press, slide, let go: a right press opens the menu as it goes down (a Mac's, Linux's; Windows' opens on the way
// up), and letting go on a row picks it. A quick click leaves the menu open.
if (process.platform !== "win32") {
  const box = await row(`${D}/First.md`).boundingBox()
  await page.mouse.move(box.x + 30, box.y + box.height / 2)
  await page.mouse.down({ button: "right" })
  await page.mouse.up({ button: "right" })
  check("a quick right click: the menu stays open", !!(await until(() => menus())) && (await menus()) > 0)
  await page.keyboard.press("Escape"); await until(async () => (await fading()) === 0, 1500)
  await page.mouse.move(box.x + 30, box.y + box.height / 2)
  await page.mouse.down({ button: "right" })
  await until(() => menus())
  const it = await page.getByRole("menuitem", { name: "Rename", exact: true }).first().boundingBox()
  await page.mouse.move(it.x + 20, it.y + it.height / 2, { steps: 6 })
  await page.mouse.up({ button: "right" })
  check("press, slide to Rename, let go: it's picked", !!(await until(() => field.count())) && (await menus()) === 0)
  await field.press("Escape"); await until(async () => (await field.count()) === 0)
}

// 5. The palette fades as it closes.
await openPalette(page)
await page.waitForSelector("[role=dialog] input:focus")
await page.keyboard.press("Escape")
check("the palette fades as it closes", (await fading("palette")) === 1 && (await page.locator("[data-palette]:not([data-fading] *)").count()) === 0)
await until(async () => (await fading()) === 0, 1500)

// 6. The focus ring settles: its animation as the keyboard reaches a button.
await page.locator('aside [aria-label="Collapse all"]').focus()
await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab")
check("the focus ring settles in", await page.evaluate(() => document.activeElement?.getAnimations().some((a) => a.animationName === "focus-ring")))

// 7. Out of focus, what's selected goes grey: not the accent.
await row(`${D}/First.md`).locator("button").first().click()
await row(`${D}/Second.md`).locator("button").first().click({ modifiers: ["ControlOrMeta"] })
// (read once its row's colour transition is over)
const tint = () => wait(400).then(() => page.evaluate(() => { const s = document.querySelector("[data-selected]"); return s ? getComputedStyle(s).backgroundColor : null }))
const on = await tint()
await page.evaluate(() => document.documentElement.setAttribute("data-window-inactive", ""))
const off = await tint()
await page.evaluate(() => document.documentElement.removeAttribute("data-window-inactive"))
check("a window out of focus greys what's selected", !!on && !!off && on !== off, [on, off])

// 8. Reduce motion: nothing lingers.
await page.emulateMedia({ reducedMotion: "reduce" })
await row(`${D}/First.md`).click({ button: "right" })
await until(() => menus())
await page.keyboard.press("Escape")
check("Reduce motion: a menu closes with no fade", (await menus()) === 0 && (await fading()) === 0)

await fetch(`${B}api/file?path=${encodeURIComponent(D)}`, { method: "DELETE" })
await done()
