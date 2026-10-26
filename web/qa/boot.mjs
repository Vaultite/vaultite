// Does the built app start (before packaging, and `npm run smoke`): no error, no blank window on desktop and phone, and
// a vault of the user's own gets nothing written outside .vaultite/. WRITES: only the throwaway vault it makes.
//   node web/qa/boot.mjs [<base url>]
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { CHROME, ROOT, freePort, launch, qa, wait } from "./lib/qa.mjs"
import { officialBundles, officialRepos } from "../../tools/test/official.ts"
import { stopTerminals, testServer } from "../../tools/test/lib.ts"
const { check, fails } = await qa(import.meta.url, { chrome: false })
if (!fs.existsSync(CHROME)) { console.log("boot: skipped (no Google Chrome here)"); process.exit(0) }
if (!process.argv[2] && !fs.existsSync(path.join(ROOT, "web/dist/index.html"))) { console.error("boot: no web/dist (npm run build first)"); process.exit(1) }

// The server: the one given, else this checkout's on a sandbox vault of its own (stopped by its own handle, and its
// terminals by its port, at the end).
const servers = []
async function serve(vault, local) {
  const port = await freePort()
  const server = testServer({
    cwd: ROOT, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: vault, VAULTITE_LOCAL: local, ...(github ? { VAULTITE_GITHUB: github, VAULTITE_BUNDLES: bundles } : {}) },
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
let base = process.argv[2], tmp = null, github = null, bundles = null
if (!base) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vau-boot-"))
  // (a bundle installing Vaultite's own plugins gets them from a made-up Vaultite/plugins here, never GitHub)
  github = officialRepos(path.join(tmp, "official"))
  bundles = officialBundles(path.join(tmp, "official"))
  const made = spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), "sandbox", path.join(tmp, "vault")], { encoding: "utf8" })
  if (made.status !== 0) { console.error(`boot: couldn't make the sandbox\n${made.stderr || made.stdout}`); process.exit(1) }
  base = await serve(path.join(tmp, "vault"), path.join(tmp, "local"))
}
if (!base.endsWith("/")) base += "/"

function stop() {
  for (const { server, port } of servers) {
    if (server.exitCode === null) server.kill()
    stopTerminals(port)
  }
  // (a server just killed may still be writing its last files: retried)
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
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
    if (!f.startsWith(".vaultite") && fs.statSync(p).isFile()) out[f.split(path.sep).join("/")] = fs.readFileSync(p, "latin1")
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
    // Set up Vaultite's way (electron/main.ts): a setup picked, its plugins write their pages (core/pages.ts).
    const call = (method, route, body) => fetch(`${ownBase}api/${route}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) })
    const applied = []
    // (Days, as the directory's Life OS, installs Vaultite's own plugins, Today and Books among them: as the user's yes in the app)
    fs.cpSync(path.join(ROOT, "tools/fixtures/bundles/days"), path.join(own, ".vaultite/bundles/days"), { recursive: true })
    for (const id of ["standard", "days"]) applied.push((await call("POST", `bundles/${id}/apply`, { allowCode: true })).status)
    await fetch(`${ownBase}api/state`)
    await wait(500)
    const later = files(own)
    const changed = Object.keys(before).filter((f) => before[f] !== later[f]), added = Object.keys(later).filter((f) => !(f in before))
    check("own vault: a setup picked changes none of the user's files (their own Today too)", applied.every((c) => c === 200) && !changed.length, [applied, changed])
    const guide = (await (await call("GET", "bundles/days")).json()).bundle?.guide
    check("own vault: ...and adds only its plugins' pages, in Dashboards/, and its guide", added.length > 0 && added.includes(guide) &&
      added.every((f) => f === guide || (f.startsWith("Dashboards/") && /^type: dashboard$/m.test(later[f]))), added)
    // ...its pages pinned and drawn, the user's files now.
    const st = await (await fetch(`${ownBase}api/state`)).json()
    const people = st.files.files.find((f) => f.path === "Dashboards/People.md")
    const pinned = (await (await call("GET", "config/pages")).json()).pinned ?? []
    check("own vault: a plugin's page is the user's file, pinned", people?.type === "dashboard" && pinned.includes(people.path) && pinned.includes("Dashboards/Today.md"), [people, pinned])
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    page.setDefaultNavigationTimeout(SLOW)
    await page.goto(`${ownBase}#file/${encodeURIComponent("Dashboards/People.md")}`)
    check("own vault: the page draws its blocks", await page.waitForSelector("[data-block=people-due]", { timeout: SLOW }).then(() => true, () => false))
    check("own vault: the sidebar lists it", await page.locator("aside >> text=People").count() > 0)
    await ctx.close()
    // Every plugin on, the app running a while and every schedule run (as its plugin does, on its own): nothing outside
    // .vaultite/ changes but what the user did, until a plugin is allowed to write there.
    const list = await (await call("GET", "plugins")).json()
    // (Activity and the agents' plugins too, off by default)
    const agents = ["activity", "token-count", "workspaces", "codex"]
    await call("PATCH", "config/plugins", { disabled: [], enabled: [...list.filter((p) => p.optIn || p.tier === "vault").map((p) => p.id), ...agents] })
    await fetch(`${ownBase}api/state`)
    await call("PUT", "file", { path: "Notes/Plain.md", text: "Just a thought, edited.\n" }) // (the user's own: Activity's recap has a day to write)
    const edited = files(own)
    await wait(6000) // (the scheduler's first turn, timers, the change heard)
    const jobs = await (await call("POST", "ops/schedule.list", {})).json()
    const runs = await Promise.all(jobs.map((j) => call("POST", "ops/schedule.run", { id: j.id }).then((r) => r.json(), () => null)))
    await wait(2000)
    const later2 = files(own)
    const wrote = Object.keys({ ...edited, ...later2 }).filter((f) => edited[f] !== later2[f])
    const grants = await (await call("POST", "ops/plugin.writes", {})).json()
    check("own vault: every plugin on, schedules run: nothing written outside .vaultite/ without a grant", jobs.length > 0 && !wrote.length, [jobs.map((j) => j.id), wrote, runs])
    check("own vault: ...the refused write asks the user (Activity's recaps)", grants.writes.some((g) => g.plugin === "activity" && g.answer === "ask"), grants)
    await call("POST", "ops/plugin.grant", { id: "activity" })
    await call("POST", "ops/schedule.run", { id: "activity/recaps" })
    const recaps = fs.existsSync(path.join(own, "Recaps")) ? fs.readdirSync(path.join(own, "Recaps")) : []
    check("own vault: allowed, Activity writes its recap", recaps.length === 1, recaps)
  }
} finally {
  await browser.close()
  stop()
}
console.log(fails.length ? `\nboot: ${fails.length} failed` : "\nboot: ok, the app starts")
process.exit(fails.length ? 1 : 0)
