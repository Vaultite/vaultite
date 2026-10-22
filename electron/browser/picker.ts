// Block an element: a picker in the page (picker-page.js, in an isolated world) answers the selector the user chose; the
// app keeps it in the blocked elements list, which comes back to Shields (adblock.ts `adblock:rules`) like every rule.
import type { BrowserWindow } from "electron"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { allPages, handle } from "./engine.ts"

const WORLD = 1020
let source = ""
const code = () => (source ||= fs.readFileSync(fileURLToPath(new URL("./picker-page.js", import.meta.url)), "utf8"))
const cancel = "globalThis.__vaultitePicker?.cancel()"

const pageOf = (win: BrowserWindow, id: unknown) => allPages().find((x) => x.id === id && x.win === win && !x.wc.isDestroyed())

/** Pick an element in the page: its selector, or null when cancelled (Esc, Cancel, the page went elsewhere). `at`: a
 *  point (window px, from the page's right-click menu) whose element starts picked. */
handle("adblock:pick", async (win, id, site, at) => {
  const p = pageOf(win, id)
  if (!p || !/^https?:/i.test(p.wc.getURL())) return null
  const wc = p.wc
  // (one at a time: a picker already there gives way)
  await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: cancel }]).catch(() => {})
  wc.focus()
  let off = () => {}
  const gone = new Promise<null>((done) => {
    const left = (d: { isMainFrame: boolean; isSameDocument: boolean }) => { if (d.isMainFrame && !d.isSameDocument) done(null) }
    const closed = () => done(null)
    wc.on("did-start-navigation", left)
    wc.once("destroyed", closed)
    off = () => { if (!wc.isDestroyed()) { wc.off("did-start-navigation", left); wc.off("destroyed", closed) } }
  })
  const z = wc.getZoomFactor(), pt = at as { x?: unknown; y?: unknown } | undefined
  const point = pt && Number.isFinite(pt.x) && Number.isFinite(pt.y) ? { x: Number(pt.x) / z, y: Number(pt.y) / z } : undefined
  const args = JSON.stringify({ site: typeof site === "string" ? site.slice(0, 300) : "", at: point })
  try {
    const r = await Promise.race([wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${code()})(${args})` }], true), gone])
    const selector = r && typeof r === "object" && typeof (r as { selector?: unknown }).selector === "string" ? (r as { selector: string }).selector.trim() : ""
    return selector && selector.length <= 2000 && !/[\n\r]/.test(selector) ? { selector } : null
  } finally { off() }
})

/** Stop a page's picker, if it has one. */
handle("adblock:pick-stop", async (win, id) => {
  const p = pageOf(win, id)
  if (p) await p.wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: cancel }]).catch(() => {})
})
