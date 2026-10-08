// vau's dev tools and palette commands against an open app window (core/coreops/dev.ts, web/src/core/dev.ts): the
// window answers dev console, dom, eval (also awaited, and from stdin) and commands; a browser can't screenshot; an
// error is a non-zero exit on stderr; someone not the owner is refused. Opens the app in headless Chrome.
// WRITES: nothing in the vault (the window's console is cleared).
//   node web/qa/devtools.mjs <base url>
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { CHROME, ROOT, launch, qa, wait } from "./lib/qa.mjs"
const { args: [B], check, done } = await qa(import.meta.url, { chrome: false })
const base = B.endsWith("/") ? B : `${B}/`

if (!fs.existsSync(CHROME)) { console.log("devtools: skipped (no Google Chrome here)"); process.exit(0) }

const vau = (args, input = "") => spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), ...args], {
  encoding: "utf8", input, timeout: 30000, env: { ...process.env, VAULTITE_URL: base.replace(/\/$/, "") },
})
const json = (r) => { try { return JSON.parse(r.stdout) } catch { return null } }

const browser = await launch()
let r = vau(["dev", "console"])
check("no window open: says so, exit 1, on stderr", r.status === 1 && !r.stdout && r.stderr.includes("no app window is open"), r)
r = vau(["commands", "--json"])
check("vau commands without a window: the app's source", r.status === 0 && json(r)?.from === "source" && json(r).commands.some((c) => c.id === "palette:open"), r.stdout.slice(0, 300))

const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
await page.goto(base)
await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
await wait(1500)
vau(["dev", "console", "--clear"])
await page.evaluate(() => { console.warn("qa-devtools", { n: 1 }); console.log("plain line"); setTimeout(() => { throw new Error("qa-uncaught") }, 0) })
await wait(200)
r = vau(["dev", "console", "--level", "warn"])
check("dev console: the window's warnings, its value as JSON", r.status === 0 && r.stdout.includes("warn  qa-devtools {\"n\":1}") && !r.stdout.includes("plain line"), r)
r = vau(["dev", "console", "--json"])
check("dev console: uncaught errors too", r.status === 0 && json(r)?.entries.some((e) => e.level === "error" && e.text.includes("qa-uncaught")), r.stdout.slice(-600))
r = vau(["dev", "console", "--count"])
check("dev console --count", r.status === 0 && /^\d+\n$/.test(r.stdout) && Number(r.stdout) >= 3, r)

r = vau(["dev", "dom", "#root", "--attr", "id"])
check("dev dom: an attribute", r.status === 0 && r.stdout.trim().endsWith("root") && r.stdout.startsWith("1 match"), r)
const panes = await page.evaluate(() => document.querySelectorAll("[data-pane]").length)
r = vau(["dev", "dom", "[data-pane]", "--all", "--count"])
check("dev dom --all --count: as many as the page has", r.status === 0 && Number(r.stdout) === panes && panes > 0, [r, panes])
r = vau(["dev", "dom", "#nothing-here"])
check("dev dom: nothing matching says so", r.status === 0 && r.stdout.includes("Nothing matches"), r)
r = vau(["dev", "dom", "[[bad"])
check("dev dom: a bad selector is an error, exit 1", r.status === 1 && r.stderr.includes("vau dev dom:") && !r.stdout, r)

r = vau(["dev", "eval", "document.querySelector('#root').id"])
check("dev eval: an expression's value", r.status === 0 && r.stdout.trim() === "\"root\"", r)
r = vau(["dev", "eval", "await fetch('api/ui').then((x) => x.json())", "--json"])
check("dev eval: awaited at the top level", r.status === 0 && json(r)?.value?.windows >= 1, r)
r = vau(["dev", "eval", "const x = await fetch('api/ui'); const j = await x.json(); return j.windows + 100"])
check("dev eval: statements that return", r.status === 0 && Number(r.stdout) >= 101, r)
r = vau(["dev", "eval", "document.querySelector('#root')"])
check("dev eval: a DOM node as its HTML", r.status === 0 && r.stdout.includes("<div id=\\\"root\\\""), r.stdout.slice(0, 200))
r = vau(["dev", "eval"], "6 * 7\n")
check("dev eval: the code piped in", r.status === 0 && r.stdout.trim() === "42", r)
r = vau(["dev", "eval", "-"], "[1, 2, 3].map((x) => x * 2)")
check("dev eval -: stdin", r.status === 0 && json({ stdout: r.stdout })?.join() === "2,4,6", r)
r = vau(["dev", "eval", "throw new Error('qa-boom')"])
check("dev eval: the code's error, exit 1 on stderr", r.status === 1 && r.stderr.includes("qa-boom") && !r.stdout, r)

r = vau(["dev", "screenshot"])
check("dev screenshot: a browser can't, and says so", r.status === 1 && r.stderr.includes("desktop app"), r)

r = vau(["commands", "--json"])
const cmds = json(r)
check("vau commands: the window's, with which can run now", r.status === 0 && cmds?.from === "window" && cmds.commands.some((c) => c.id === "palette:open" && c.available === true), r.stdout.slice(0, 300))
r = vau(["commands", "palette", "--count"])
check("vau commands <word> --count", r.status === 0 && Number(r.stdout) >= 1 && Number(r.stdout) < cmds.commands.length, r)
r = vau(["command", "palette:open"])
const open = await page.waitForFunction(() => !!document.querySelector("[role=dialog], [cmdk-root], [data-palette]"), null, { timeout: 3000 }).then(() => true, () => false)
check("vau command: runs it in the window", r.status === 0 && open, r)

// Not the owner: through another proxy, or someone else on the tailnet.
for (const h of [{ "X-Forwarded-For": "100.64.0.9" }, { "Tailscale-User-Login": "mallory@example.com" }]) {
  const res = await fetch(`${base}api/ops/dev.eval`, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify({ code: "1" }) })
  check(`dev eval: refused (${Object.keys(h)[0]})`, res.status === 403, [res.status, await res.text()])
}
const ui = await fetch(`${base}api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dev", what: "eval", code: "1" }) })
check("POST /api/ui doesn't take dev asks", ui.status === 400, ui.status)
await browser.close()
await done()
