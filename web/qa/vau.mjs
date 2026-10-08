// The `vau` CLI driving open app windows (bin/vau, POST /api/ui): `vau open` opens a file in the window the user was
// in last (two windows open: only that one acts), `--split down` opens it in a new pane below, `--new-tab` keeps the
// current tab, a view opens too, `vau command` runs a palette command, and with no window open it says so.
// Writes a note (Notes/Vau open test.md): throwaway server only.
//   node web/qa/vau.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/vau-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const VAU = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../bin/vau")
/** Run vau from another folder, as an agent would: [exit code, output]. */
const vau = (...args) => {
  try {
    return [0, execFileSync(VAU, args, { cwd: "/", env: { ...process.env, VAULTITE_URL: B.replace(/\/$/, "") }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })]
  } catch (e) {
    return [e.status, String(e.stderr) + String(e.stdout)]
  }
}

const a = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const b = await browser.newPage({ viewport: { width: 1280, height: 800 } })
for (const p of [a, b]) watch(p)
const hash = (p) => p.evaluate(() => decodeURIComponent(location.hash))
const panes = (p) => p.$$eval("section[data-group]", (els) => els.length)
const tabs = (p) => p.$$eval("[role=tab]", (els) => els.length)
/** The user clicks in a window: it's the one in use now. */
const focusOn = async (p) => {
  await p.bringToFront()
  await p.evaluate(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })))
  await wait(300)
}
try {
  await fetch(new URL("/api/file", B), { method: "PUT", body: JSON.stringify({ path: "Notes/Vau open test.md", text: "Opened by vau.\n" }) })
  for (const p of [a, b]) { await p.goto(B); await p.waitForSelector("section[data-group]") }
  await wait(800)
  let [code, out] = vau("context")
  check("context sees two windows", code === 0 && out.includes("2 app windows open"), out)

  await focusOn(a)
  const bBefore = await hash(b)
  ;[code, out] = vau("open", "Vau open test")
  check("vau open answers", code === 0 && out.includes("Opened Notes/Vau open test.md"), out)
  check("the window in use opens the file", await until(async () => (await hash(a)).includes("file/Notes/Vau open test.md")), await hash(a))
  check("its text shows", await until(async () => (await a.textContent("#main-scroll"))?.includes("Opened by vau.")))
  check("the other window doesn't move", (await hash(b)) === bBefore, await hash(b))
  await a.screenshot({ path: `${OUT}1-open.png` })

  await focusOn(b)
  ;[code, out] = vau("open", "Dashboards/Today.md", "--split", "down")
  check("--split down opens a pane in the window now in use", code === 0 && await until(async () => (await panes(b)) === 2), [out, await panes(b)])
  check("and window a keeps one pane", (await panes(a)) === 1, await panes(a))
  await b.screenshot({ path: `${OUT}2-split.png` })

  await focusOn(a)
  const before = await tabs(a)
  ;[code, out] = vau("open", "Dashboards/Today.md", "--new-tab")
  check("--new-tab adds a tab", code === 0 && await until(async () => (await tabs(a)) === before + 1), [out, before, await tabs(a)])

  ;[code, out] = vau("open", "view:nothing-here/1")
  check("a view opens (a blank one when its plugin has none)", code === 0 && await until(async () => (await hash(a)).includes("view/nothing-here/1")), [out, await hash(a)])

  const side = () => a.evaluate(() => JSON.parse(localStorage.getItem("vaultite.prefs") ?? "{}").sidebar ?? true)
  const open = await side()
  ;[code, out] = vau("command", "sidebar:toggle")
  check("vau command runs a palette command (the sidebar folds)", code === 0 && await until(async () => (await side()) !== open), out)
  vau("command", "sidebar:toggle")

  ;[code, out] = vau("open", "x.md", "--split", "left")
  check("a bad --split is refused", code === 1 && out.includes("right or down"), out)
  await a.close(); await b.close()
  await wait(500)
  ;[code, out] = vau("open", "Dashboards/Today.md")
  check("no window open: says so", code === 1 && out.includes("no app window is open"), out)
} finally {
  await fetch(new URL("/api/file?path=" + encodeURIComponent("Notes/Vau open test.md"), B), { method: "DELETE" })
  await browser.close()
}
await done()
