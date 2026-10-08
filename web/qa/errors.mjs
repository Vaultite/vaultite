// The Errors plugin end to end: the app's errors reach the server (an uncaught error, a rejection, one kept from before
// the app started), an older build's chunk that's gone reloads the page into the new build once (and only once a
// minute), the view lists and opens them, and the server's log lines are dated. Serves web/dist from a throwaway
// server on a fresh sandbox vault (or uses <base url>, then the log isn't checked).
// WRITES: only the throwaway vault (with <base url>: that server's error record, which it clears at the end).
//   node web/qa/errors.mjs [<base url>] [--shots <dir>]
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { CHROME, ROOT, freePort, launch, qa, wait } from "./lib/qa.mjs"
const { check, done } = await qa(import.meta.url, { chrome: false })
if (!fs.existsSync(CHROME)) { console.log("errors: skipped (no Google Chrome here)"); process.exit(0) }
const args = process.argv.slice(2)
const shotsAt = args.indexOf("--shots"), shots = shotsAt >= 0 ? args.splice(shotsAt, 2)[1] : null

let base = args[0], tmp = null, server = null, port = 0, log = ""
if (!base) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vau-errors-"))
  const made = spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), "sandbox", path.join(tmp, "vault")], { encoding: "utf8" })
  if (made.status !== 0) { console.error(`errors: couldn't make the sandbox\n${made.stderr || made.stdout}`); process.exit(1) }
  port = await freePort()
  server = spawn(process.execPath, [path.join(ROOT, "server.ts")], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: path.join(tmp, "vault"), VAULTITE_LOCAL: path.join(tmp, "local") },
  })
  server.stdout.on("data", (b) => { log += b })
  server.stderr.on("data", (b) => { log += b })
  base = `http://127.0.0.1:${port}/`
  let up = false
  for (let i = 0; i < 120 && !up && server.exitCode === null; i++) { try { up = (await fetch(`${base}api/state`)).ok } catch { await wait(250) } }
  if (!up) { console.error(`errors: the server didn't start\n${log.slice(-2000)}`); stop(); process.exit(1) }
}
if (!base.endsWith("/")) base += "/"

function stop() {
  if (server && server.exitCode === null) server.kill()
  if (port) spawnSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" })
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
}

const errors = async (q = "") => (await (await fetch(`${base}api/errors${q}`)).json()).groups
const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 250) { const v = await f(); if (v) return v; await wait(250) } return null }

const browser = await launch()
try {
  await fetch(`${base}api/errors`, { method: "DELETE" })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  await page.goto(base)
  await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
  await wait(1500)

  // The window's own: an uncaught error and a rejection.
  await page.evaluate(() => {
    setTimeout(() => { throw new Error("qa: an uncaught error") })
    void Promise.reject(new Error("qa: a rejection"))
  })
  let got = await until(async () => { const g = await errors("?source=app"); return g.length >= 2 ? g : null })
  check("an uncaught error and a rejection reach the server, from this device", got?.some((g) => g.message === "qa: an uncaught error" && g.kind === "uncaught" && g.devices.includes("web")) &&
    got?.some((g) => g.message === "qa: a rejection" && g.kind === "rejection"), got)
  const one = got?.find((g) => g.message === "qa: an uncaught error")
  check("with its stack, address and build", !!one?.latest.stack && typeof one?.latest.url === "string" && /\.js$/.test(one?.latest.build ?? ""), one?.latest)

  // One from before the app started (index.html keeps it in the queue): sent once the app is up.
  await page.evaluate(() => localStorage.setItem("vaultite.errors", JSON.stringify([{ t: Date.now(), kind: "boot", fatal: true, message: "qa: before it started", url: "/" }])))
  await page.reload()
  got = await until(async () => (await errors("?source=app")).find((g) => g.message === "qa: before it started"))
  check("one kept from before the app started is sent after the reload", got?.kind === "boot" && got.fatal === 1, got)
  check("and the queue is empty after", await until(() => page.evaluate(() => localStorage.getItem("vaultite.errors") === null)), await page.evaluate(() => localStorage.getItem("vaultite.errors")))

  // An older build's chunk that's gone: the server has another build (its index.html names another entry script).
  await page.route((u) => u.href === base || u.href === `${base}./`, async (route) => {
    if (route.request().resourceType() !== "fetch") return route.continue()
    const res = await route.fetch()
    route.fulfill({ response: res, body: (await res.text()).replace(/(<script type="module"[^>]*\ssrc="[^"]*\/)([^"/]+\.js)"/, '$1index-Newer000.js"') })
  })
  const stale = () => page.evaluate(() => { const e = new Event("vite:preloadError", { cancelable: true }); e.payload = new Error("Failed to fetch dynamically imported module: assets/Gone-0000.js"); dispatchEvent(e) })
  const reloaded = page.waitForEvent("framenavigated", { timeout: 8000 }).then(() => true, () => false)
  await stale()
  check("a gone chunk of an older build reloads into the new one", await reloaded)
  await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
  got = await until(async () => (await errors("?source=app")).find((g) => g.kind === "stale"))
  check("and says so (an error of kind stale)", !!got, await errors("?source=app"))
  const again = page.waitForEvent("framenavigated", { timeout: 4000 }).then(() => true, () => false)
  await stale()
  check("but not twice in a minute (a reload that didn't fix it isn't that)", !(await again))
  await page.unroute(() => true)

  // The view: each kind once; opening one shows its stack and Copy / Forget.
  await page.goto(`${base}#view/errors`)
  const rows = await page.waitForFunction(() => document.querySelectorAll("[data-error]").length, null, { timeout: 10000 }).then((h) => h.jsonValue(), () => 0)
  check("the view lists them", rows >= 3, rows)
  await page.click("[data-error] button")
  const detail = await page.waitForSelector("[data-error-detail] pre", { timeout: 5000 }).then(() => true, () => false)
  check("opening one shows its stack", detail)
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, "errors-desktop.png") }) }
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const pp = await phone.newPage()
  await pp.goto(`${base}#view/errors`)
  await pp.waitForFunction(() => document.querySelectorAll("[data-error]").length, null, { timeout: 10000 }).catch(() => null)
  const wide = await pp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
  check("on a phone it fits the width", wide)
  if (shots) { await pp.tap("[data-error] button"); await wait(600); await pp.screenshot({ path: path.join(shots, "errors-phone.png") }) }

  if (server) {
    const lines = log.split("\n").filter(Boolean)
    check("every line of the server's log is dated", lines.length > 3 && lines.every((l) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d /.test(l)), lines.filter((l) => !/^\d{4}-/.test(l)).slice(0, 5))
  }
  await fetch(`${base}api/errors`, { method: "DELETE" })
} finally {
  await browser.close()
  stop()
}
await done()
