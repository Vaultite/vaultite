// Does the built app start? The smoke test `npm run app:build` runs before packaging (so the desktop app, its updates
// included, never ships a build that can't draw), and `npm run smoke` after `npm run build`. It serves web/dist from a
// throwaway server on a fresh sandbox vault (or uses <base url>), opens it on a desktop and a phone in Chrome, and fails
// on any error the page throws, on index.html's "couldn't start" screen, or on nothing drawn: the first page, Plugins,
// Settings and a note in the editor (its chunk loads then). Then the screen itself: the app's code throwing as it loads,
// and not loading at all, must each show it (rather than a blank window). Last, a vault of the user's own (Obsidian's,
// plain Markdown, their AGENTS.md): opening it must change none of their files and add nothing outside .vaultite/, nor
// must picking a setup for it as Set up Vaultite does.
// WRITES: only the throwaway vault it makes (none with <base url>, which should be a throwaway server too).
//   node web/qa/boot.mjs [<base url>]
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { CHROME, ROOT, freePort, launch, qa, wait } from "./lib/qa.mjs"
const { check, fails } = await qa(import.meta.url, { chrome: false })
if (!fs.existsSync(CHROME)) { console.log("boot: skipped (no Google Chrome here)"); process.exit(0) }
if (!process.argv[2] && !fs.existsSync(path.join(ROOT, "web/dist/index.html"))) { console.error("boot: no web/dist (npm run build first)"); process.exit(1) }

// The server: the one given, else this checkout's on a sandbox vault of its own (stopped by its own handle, and its
// terminals' tmux by its port, at the end).
const servers = []
async function serve(vault, local) {
  const port = await freePort()
  const server = spawn(process.execPath, [path.join(ROOT, "server.ts")], {
    cwd: ROOT, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: vault, VAULTITE_LOCAL: local },
  })
  servers.push({ server, port })
  let said = ""
  server.stderr.on("data", (b) => { said = (said + b).slice(-2000) })
  const base = `http://127.0.0.1:${port}/`
  let up = false
  for (let i = 0; i < 120 && !up && server.exitCode === null; i++) { try { up = (await fetch(`${base}api/state`)).ok } catch { await wait(250) } }
  if (!up) { console.error(`boot: the server didn't start\n${said}`); stop(); process.exit(1) }
  return base
}
let base = process.argv[2], tmp = null
if (!base) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vau-boot-"))
  const made = spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), "sandbox", path.join(tmp, "vault")], { encoding: "utf8" })
  if (made.status !== 0) { console.error(`boot: couldn't make the sandbox\n${made.stderr || made.stdout}`); process.exit(1) }
  base = await serve(path.join(tmp, "vault"), path.join(tmp, "local"))
}
if (!base.endsWith("/")) base += "/"

function stop() {
  for (const { server, port } of servers) {
    if (server.exitCode === null) server.kill()
    spawnSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" })
  }
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
}

const browser = await launch()
// Generous waits: a busy machine is slow, not broken (a broken build fails fast: the error screen, a pageerror).
const SLOW = 60_000
/** Each route on a desktop and a phone: it draws and throws nothing. */
async function visit(base, prefix = "") {
  // A note to open (its editor is a chunk of its own).
  const state = await (await fetch(`${base}api/state`)).json()
  const note = state.notes?.[0]?.id ?? null
  const sizes = { desktop: { viewport: { width: 1280, height: 800 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  for (const [name, opts] of Object.entries(sizes)) {
    const ctx = await browser.newContext(opts)
    const page = await ctx.newPage()
    page.setDefaultNavigationTimeout(SLOW)
    const errors = []
    page.on("pageerror", (e) => errors.push(e.stack || e.message))
    const routes = ["", "#plugins", "#settings", ...(note ? [`#view/files/file/${encodeURIComponent(`${note}.md`)}`] : [])]
    for (const r of routes) {
      await page.goto(base + r)
      const drawn = await page.waitForFunction(() => document.getElementById("vau-boot-error") || document.querySelector("#root > *"), null, { timeout: SLOW }).catch(() => null)
      await wait(1500) // (what comes just after: the store, lazy chunks, effects)
      const screen = await page.evaluate(() => document.getElementById("vau-boot-error")?.innerText ?? null)
      const label = `${prefix}${name}: ${r || "first page"}`
      check(`${label} draws`, drawn && !screen, screen ?? `nothing drawn in ${SLOW / 1000} s`)
      check(`${label} throws nothing`, !errors.length, errors.join("\n\n"))
      errors.length = 0
    }
    await ctx.close()
  }
}

/** Every file under dir but .vaultite/: path -> its bytes. */
function files(dir) {
  const out = {}
  for (const f of fs.readdirSync(dir, { recursive: true }).sort()) {
    const p = path.join(dir, f)
    if (!f.startsWith(".vaultite") && fs.statSync(p).isFile()) out[f] = fs.readFileSync(p, "latin1")
  }
  return out
}

try {
  await visit(base)

  // The screen: the app's own code throwing as it loads, and its code not loading at all.
  const broken = async (label, how, expect) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    page.setDefaultNavigationTimeout(SLOW)
    let main = null
    await page.route(/\/assets\/main-[^/]+\.js$/, async (route) => {
      main = route.request().url()
      if (how === "missing") return route.fulfill({ status: 404, body: "" })
      const res = await route.fetch()
      return route.fulfill({ response: res, body: `throw new Error("boot test: the app's code threw");\n${await res.text()}` })
    })
    await page.goto(base)
    const text = await page.waitForFunction(() => document.getElementById("vau-boot-error")?.innerText, null, { timeout: SLOW / 2 }).then((h) => h.jsonValue()).catch(() => null)
    check(`${label} shows the error screen`, main && text?.includes(expect), main ? text ?? "no screen" : "the page has no assets/main-*.js (not a build?)")
    await ctx.close()
  }
  await broken("code that throws as it loads", "throws", "boot test: the app's code threw")
  await broken("code that doesn't load", "missing", "didn't load")

  if (tmp) {
    const own = path.join(tmp, "own")
    const mine = {
      "AGENTS.md": "# My rules\n\nBe brief.\n", "CLAUDE.md": "@AGENTS.md\n", "Readme.md": "No newline at the end",
      "Notes/Plain.md": "Just a thought.\n", "Notes/Tagged.md": "---\ntags: [x]\n---\nNo type.", "Daily/2026-10-01.md": "Windows\r\nline ends\r\n",
      "People/Alice Park.md": "Alice.\n", "Projects/Thing.md": "A project\n", "Logs/Gym/2026-10-01 Gym.md": "Squats\n", "Inbox/Later.md": "Read later\n",
      "Books/Dune.md": "A book\n", "Dashboards/Today.md": "My own page\n", ".obsidian/app.json": "{\"vimMode\":true}",
    }
    for (const [f, t] of Object.entries(mine)) { fs.mkdirSync(path.dirname(path.join(own, f)), { recursive: true }); fs.writeFileSync(path.join(own, f), t) }
    const before = files(own)
    const ownBase = await serve(own, path.join(tmp, "own-local"))
    await visit(ownBase, "own vault, ")
    await wait(1500)
    const after = files(own)
    const touched = Object.keys({ ...before, ...after }).filter((f) => before[f] !== after[f])
    check("own vault: opening it changes none of the user's files and adds none outside .vaultite/", !touched.length, touched.join(", "))
    // Set up Vaultite's way (electron/main.ts): its pages kept out (pages.json `install: false`), then a setup picked.
    const call = (method, route, body) => fetch(`${ownBase}api/${route}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) })
    await call("PATCH", "config/pages", { install: false })
    const applied = []
    for (const id of ["pages", "life-os"]) applied.push((await call("POST", `bundles/${id}/apply`, {})).status)
    await fetch(`${ownBase}api/state`)
    await wait(500)
    const later = files(own)
    const added = Object.keys({ ...before, ...later }).filter((f) => before[f] !== later[f])
    check("own vault: a setup picked in Set up Vaultite writes nothing outside .vaultite/", applied.every((c) => c === 200) && !added.length, [applied, added])
    // ...while its pages are there all the same: in .vaultite/pages, pinned, drawn, out of the file tree.
    const st = await (await fetch(`${ownBase}api/state`)).json()
    const today = st.files.files.find((f) => f.path === ".vaultite/pages/Dashboards/Today.md")
    const pinned = (await (await call("GET", "config/pages")).json()).pinned ?? []
    check("own vault: the plugins' pages are in .vaultite/pages, pinned", today?.type === "dashboard" && pinned.includes(today.path) && !st.files.folders.some((f) => f.startsWith(".vaultite")), [today, pinned])
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    page.setDefaultNavigationTimeout(SLOW)
    await page.goto(`${ownBase}#file/${encodeURIComponent(".vaultite/pages/Dashboards/Today.md")}`)
    check("own vault: a page there draws its blocks", await page.waitForSelector("[data-block=routines]", { timeout: SLOW }).then(() => true, () => false))
    check("own vault: the sidebar lists it", await page.locator("aside >> text=Today").count() > 0)
    await ctx.close()
  }
} finally {
  await browser.close()
  stop()
}
console.log(fails.length ? `\nboot: ${fails.length} failed` : "\nboot: ok, the app starts")
process.exit(fails.length ? 1 : 0)
