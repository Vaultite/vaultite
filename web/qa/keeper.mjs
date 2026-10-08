// The terminal's keeper (the default backend, plugins/core/terminal/ptyd.ts) in a browser: a shell's history comes back
// after a reload as the page's own scrollback (it scrolls by itself, nothing redrawn). Runs a shell: throwaway server
// only.
//   node web/qa/keeper.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/keeper-shots/"], browser, check, watch, noErrors, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = (p, o) => fetch(new URL(`/api/${p}`, B), o).then((r) => r.json())
const id = `qa${Date.now().toString(36)}`

const page = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }))
const screenText = async (sid) => (await api(`terminals/${sid}/screen?lines=40`)).lines?.join("\n") ?? ""
await page.goto(B); await wait(2000)
await page.evaluate((s) => { location.hash = `#view/terminal%2F${s}` }, id); await wait(1500)
await page.keyboard.type("for i in $(seq 1 120); do echo row-$i; done\n")
await until(async () => (await screenText(id)).includes("row-120"), 8000)
await page.reload(); await wait(2500)
// The wheel scrolls xterm.js's own buffer (nothing goes to the server): its scrollbar's slider moves up.
const box = await page.$("[data-pane] .xterm-screen")
const at = await box?.boundingBox()
if (at) await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2)
const slider = () => page.$eval("[data-pane] .xterm-scrollable-element .scrollbar.vertical .slider", (e) => e.getBoundingClientRect().top).catch(() => null)
const before = await slider()
await page.mouse.wheel(0, -1500); await wait(600)
const after = await slider()
check("keeper: after a reload, the history is the page's own scrollback", before !== null && after !== null && after < before, { before, after })
await page.screenshot({ path: `${OUT}keeper-scrolled.png` })
const sessions = await api("terminals/sessions")
check("keeper: the session runs in Vaultite's own", sessions.sessions?.find((s) => s.id === id)?.backend === "vaultite", sessions.sessions)
await api(`terminals/${id}`, { method: "DELETE" })
noErrors()
await done()
