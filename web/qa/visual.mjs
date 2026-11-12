// Screens held against this machine's pictures (web/qa/visual/): web/src/index.css, components/Workspace.tsx,
// components/Sidebar.tsx, components/Palette.tsx, components/ContextMenu.tsx, components/kit.tsx, pages/Settings.tsx

//   node web/qa/visual.mjs <base url> [diff dir] [--update]
import crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ANCHOR } from "../../core/sandbox.ts"
import { SHOTS, openPalette, qa } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"

const { args: [B0, OUT0], browser, check, watch, done, skip } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
const OUT = OUT0 && !OUT0.startsWith("--") ? OUT0 : path.join(SHOTS, "visual")
fs.mkdirSync(OUT, { recursive: true })

function machine() {
  const fonts = process.platform === "linux" ? (() => { try { return execFileSync("fc-list", ["--format", "%{family}\n"], { encoding: "utf8" }) } catch { return "" } })() : os.release().split(".")[0]
  const lines = [...new Set(fonts.split("\n"))].sort().join("\n")
  return `${process.platform}-${crypto.createHash("sha256").update(lines).digest("hex").slice(0, 8)}`
}
const HOME = fileURLToPath(new URL(`visual/${machine()}/`, import.meta.url))
const FIRST = !fs.existsSync(HOME), UPDATE = FIRST || process.argv.includes("--update")
fs.mkdirSync(HOME, { recursive: true })

const NOON = new Date(`${ANCHOR}T12:00:00`)
const enc = encodeURIComponent
const note = (p) => `#file/${enc(p)}`

const compare = (page, was, now) => page.evaluate(async ([a, b]) => {
  const load = async (b64) => { const i = new Image(); i.src = `data:image/png;base64,${b64}`; await i.decode(); return i }
  const [x, y] = await Promise.all([load(a), load(b)])
  if (x.width !== y.width || x.height !== y.height) return { differ: -1, size: [x.width, x.height, y.width, y.height] }
  const c = new OffscreenCanvas(x.width, x.height), g = c.getContext("2d")
  g.drawImage(x, 0, 0); const p = g.getImageData(0, 0, x.width, x.height)
  g.drawImage(y, 0, 0); const q = g.getImageData(0, 0, x.width, x.height)
  let differ = 0
  for (let i = 0; i < p.data.length; i += 4) {
    const d = Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2]))
    if (d > 24) { differ++; q.data[i] = 255; q.data[i + 1] = 0; q.data[i + 2] = 255 }
  }
  if (!differ) return { differ, of: x.width * x.height }
  g.putImageData(q, 0, 0)
  const blob = await c.convertToBlob({ type: "image/png" })
  const url = await new Promise((done) => { const f = new FileReader(); f.onload = () => done(f.result); f.readAsDataURL(blob) })
  return { differ, of: x.width * x.height, diff: String(url).split(",")[1] }
}, [was.toString("base64"), now.toString("base64")])

async function screen(page, ui, name) {
  await ui.idle()
  await page.mouse.move(0, 0)
  const shoot = () => page.screenshot({ animations: "disabled", caret: "hide", mask: [page.locator("[data-sonner-toast]")] })
  let now = await shoot()
  for (const end = Date.now() + 5000; Date.now() < end;) { const next = await shoot(); if (next.equals(now)) break; now = next }
  const file = path.join(HOME, `${name}.png`)
  if (UPDATE || !fs.existsSync(file)) { fs.writeFileSync(file, now); console.log(`drew ${name}`); return }
  const r = await compare(page, fs.readFileSync(file), now)
  if (r.diff) fs.writeFileSync(path.join(OUT, `${name}.diff.png`), Buffer.from(r.diff, "base64"))
  fs.writeFileSync(path.join(OUT, `${name}.png`), now)
  check(`${name} looks as it did`, r.differ >= 0 && r.differ <= r.of / 20_000, r.differ < 0 ? r.size : `${r.differ} pixels differ: ${path.join(OUT, `${name}.diff.png`)}`)
}

async function open(viewport, scheme, phone = false) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone })
  const page = watch(await ctx.newPage()), ui = app(page)
  await page.clock.setFixedTime(NOON)
  return { ctx, page, ui }
}

for (const scheme of ["light", "dark"]) {
  const { ctx, page, ui } = await open({ width: 1280, height: 800 }, scheme)
  await page.goto(`${B}${note("Projects/Lighthouse.md")}`)
  await page.locator("[data-pane] .cm-content").first().waitFor()
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await screen(page, ui, `note-${scheme}`)
  await page.goto(`${B}${note("People/Alice Martin.md")}`)
  await page.locator("[data-pane]").first().waitFor()
  await screen(page, ui, `person-${scheme}`)
  if (scheme === "light") {
    await page.goto(`${B}${note("Projects/Lighthouse.md")}`)
    await page.locator("[data-pane] .cm-content").first().waitFor()
    await openPalette(page)
    await page.locator("[role=dialog] input:focus").waitFor()
    await page.keyboard.type("theme")
    await screen(page, ui, "palette")
    await page.keyboard.press("Escape")
    await ui.idle()
    await ui.menu.context(page.locator("aside [data-tree-path='Projects/Lighthouse.md']").first())
    await screen(page, ui, "file-menu")
    await ui.menu.close()
    await page.goto(`${B}#settings`)
    await page.getByRole("searchbox").or(page.getByPlaceholder("Search settings")).first().waitFor()
    await screen(page, ui, "settings")
  }
  await ctx.close()
}

for (const scheme of ["light", "dark"]) {
  const { ctx, page, ui } = await open({ width: 390, height: 844 }, scheme, true)
  await page.goto(`${B}${note("Projects/Lighthouse.md")}`)
  await page.locator("[data-phone-bar]").waitFor()
  await screen(page, ui, `phone-note-${scheme}`)
  await ctx.close()
}

if (FIRST) await skip(`drew this machine's pictures (${HOME}), none before`)
await done()
