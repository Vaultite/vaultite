// The panes from the keyboard, with the real keys: ⌘D and ⇧⌘D split (in an editor too), ⌃⌘ arrows focus (past the
// last pane into a sidebar), ⌃⌘] and [ go in order, ⌃⇧⌘ arrows swap, ⌃⌥⌘ arrows resize, ⌃⌘= evens out; Dim inactive
// panes fades the others, light and dark. WRITES: throwaway server only.
//   node web/qa/panekeys.mjs <base url> <vault path> [out dir]
import { mkdirSync, readdirSync, readFileSync } from "node:fs"
import { command, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/panekeys-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const MAC = process.platform === "darwin"
const note = readdirSync(`${VAULT}/Notes`).filter((f) => f.endsWith(".md")).sort()[0]

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
const shot = (name) => page.screenshot({ path: `${OUT}panekeys-${name}.png` })

const panes = () => page.evaluate(() => [...document.querySelectorAll("section[aria-label=Pane]")].map((s) => {
  const r = s.getBoundingClientRect()
  return { id: s.dataset.group, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), focused: s.hasAttribute("data-focused") }
}).sort((a, b) => a.x - b.x || a.y - b.y))
const focused = async () => (await panes()).find((p) => p.focused)
/** Which pane's editor has the keyboard (its group), or what else does. */
const keyboard = () => page.evaluate(() => {
  const a = document.activeElement
  return a?.closest(".cm-content") ? `editor:${a.closest("section[data-group]")?.dataset.group}` : a?.closest("[data-sidebar-body]") ? "sidebar" : a?.tagName ?? ""
})
const press = async (k) => { await page.keyboard.press(k); await wait(350) }

await page.goto(`${B}#file/${encodeURIComponent(`Notes/${note}`)}`); await wait(1500)
await page.locator(".cm-content").first().click(); await wait(200)
const text = readFileSync(`${VAULT}/Notes/${note}`, "utf8")

// ---------- splitting ----------
await press("ControlOrMeta+D")
let ps = await panes()
check("⌘D in an editor splits right (not Delete paragraph)", ps.length === 2 && ps[0].y === ps[1].y && ps[1].focused, ps)
check("...the keyboard goes with the focus, into the new pane's editor", await keyboard() === `editor:${ps[1].id}`, await keyboard())
await wait(1200)
check("...the note is untouched", readFileSync(`${VAULT}/Notes/${note}`, "utf8") === text)
await press("ControlOrMeta+Shift+D")
ps = await panes()
check("⇧⌘D splits down", ps.length === 3 && ps[2].x === ps[1].x && ps[2].y > ps[1].y && ps[2].focused, ps)

if (MAC) {
  // ---------- focus ----------
  const [L, TR, BR] = ps
  await press("Meta+Control+ArrowUp")
  check("⌃⌘↑ focuses the pane above", (await focused())?.id === TR.id, await panes())
  await press("Meta+Control+ArrowLeft")
  check("⌃⌘← focuses the pane to the left, its editor taking the keyboard", (await focused())?.id === L.id && await keyboard() === `editor:${L.id}`, [await panes(), await keyboard()])
  await press("Meta+Control+ArrowLeft")
  check("...past the last pane, the left sidebar", await keyboard() === "sidebar", await keyboard())
  await press("Meta+Control+ArrowRight")
  check("...and back to the pane", await keyboard() === `editor:${L.id}`, await keyboard())
  await press("Meta+Control+]")
  const n1 = (await focused())?.id
  await press("Meta+Control+]"); await press("Meta+Control+]")
  check("⌃⌘] goes to the next pane in order, round to the first", n1 === TR.id && (await focused())?.id === L.id, [n1, await focused()])
  await press("Meta+Control+[")
  check("⌃⌘[ goes back round to the last", (await focused())?.id === BR.id, await focused())

  // ---------- moving and resizing ----------
  await press("Meta+Control+ArrowLeft")
  await press("Meta+Control+Shift+ArrowRight")
  ps = await panes()
  check("⌃⇧⌘→ swaps the pane with its neighbour, keeping the focus", ps[0].id === TR.id && ps[1].id === L.id && ps[1].focused && ps[1].h === TR.h, ps)
  const w0 = ps[0].w
  await press("Meta+Control+Alt+ArrowLeft")
  ps = await panes()
  check("⌃⌥⌘← moves its divider left (the pane on the right grows)", Math.abs(ps[0].w - (w0 - 48)) <= 3, [w0, ps[0].w])
  await press("Meta+Control+Alt+ArrowDown")
  ps = await panes()
  const [up, down] = ps.filter((p) => p.x === ps[1].x)
  check("⌃⌥⌘↓ moves its divider down", up.focused && up.h - down.h >= 90, [up, down])
  await press("Meta+Control+=")
  ps = await panes()
  check("⌃⌘= evens every split out", Math.abs(ps[0].w - ps[1].w) <= 2 && Math.abs(ps[1].h - ps[2].h) <= 2, ps)
}

// ---------- Dim inactive panes ----------
const dims = () => page.evaluate(() => [...document.querySelectorAll("section[data-group]")].map((s) => ({
  focused: s.hasAttribute("data-focused"), o: Number(getComputedStyle(s.querySelector("[data-pane-body]"), "::after").opacity),
})))
check("off by default: nothing dims", (await dims()).every((d) => d.o === 0), await dims())
await command(page, "Dim inactive panes"); await wait(600)
let d = await dims()
check("Dim inactive panes: the panes without the focus fade, the focused one doesn't", d.filter((x) => !x.focused).every((x) => x.o > 0.2) && d.find((x) => x.focused)?.o === 0, d)
await shot("dim-light")
await command(page, "Use dark theme"); await wait(600)
await shot("dim-dark")
// The fade follows the focus, cross-fading (mid-way, both are part-faded).
await page.evaluate(() => document.querySelector("section[data-group]:not([data-focused]) [data-pane-body]")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })))
await wait(40)
const mid = await dims()
await wait(400)
d = await dims()
check("...the focus moving cross-fades: mid-way part-faded, then the new one clear", mid.some((x) => x.o > 0 && x.o < 0.3) && d.find((x) => x.focused)?.o === 0, [mid, d])
await command(page, "Use light theme"); await command(page, "Dim inactive panes"); await wait(400)
check("...off again, nothing dims", (await dims()).every((x) => x.o === 0), await dims())

await ctx.close()
await done()
