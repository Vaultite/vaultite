// The terminal's keeper (the default backend, plugins/core/terminal/ptyd.ts) in a browser: a shell's whole history (its
// scrollback setting's lines) comes back after a reload as the page's own scrollback (it scrolls by itself, nothing
// redrawn). Runs a shell: throwaway server only.
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
await page.keyboard.type("for i in $(seq 1 6000); do echo row-$i; done\n")
await until(async () => (await screenText(id)).includes("row-6000"), 15000)
await page.reload(); await wait(2500)
const historyText = () => page.evaluate(() => document.querySelector("[data-terminal]")?.terminalText?.(true) ?? "")
await until(async () => /^row-6000$/m.test(await historyText()), 15000)
const history = await historyText()
check("keeper: after a reload, the whole history is back (over 3000 lines)", /^row-1$/m.test(history) && /^row-6000$/m.test(history), history.length)
// The wheel scrolls xterm.js's own buffer (nothing goes to the server): what it shows moves up the history.
const box = await page.$("[data-pane] .xterm-screen")
const at = await box?.boundingBox()
if (at) await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2)
const shown = () => page.evaluate(() => document.querySelector("[data-terminal]")?.terminalText?.() ?? "")
const before = await shown()
await page.mouse.wheel(0, -1500); await wait(600)
const after = await shown()
check("keeper: after a reload, the history is the page's own scrollback", !!before && after !== before && !/^row-6000$/m.test(after), after.slice(-40))
await page.screenshot({ path: `${OUT}keeper-scrolled.png` })
const sessions = await api("terminals/sessions")
check("keeper: the session runs in Vaultite's own", sessions.sessions?.find((s) => s.id === id)?.backend === "vaultite", sessions.sessions)
await api(`terminals/${id}`, { method: "DELETE" })
noErrors()
await done()
