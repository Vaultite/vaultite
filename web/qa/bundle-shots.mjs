// The app's bundles' card pictures (bundles/<id>/preview.png, preview-dark.png): each bundle applied on a sandbox vault
// of its own, a throwaway server on it, the app on a page showing what it's for, shot in light and dark.
// WRITES bundles/<id>/preview*.png in this checkout (its vaults and servers are its own; PORT=<n> picks the port).
// Fetches the plugins Life OS installs from GitHub. Re-run when a bundle's look changes (bundles/CLAUDE.md).
//   node web/qa/bundle-shots.mjs [<bundle id>...]
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, freePort, qa, until, wait } from "./lib/qa.mjs"

const { args: ids, browser, check, watch, done } = await qa(import.meta.url)
const BUNDLES = path.join(ROOT, "bundles")
/** The page each is shot on: a note showing what it's for, else its first pinned page, else NOTE. */
const OPENS = { standard: "Notes/How this vault works.md", zen: "Notes/Reading notes - Thinking in Systems.md" }
const NOTE = "Notes/How this vault works.md"
/** What a bundle's picture shows it doing: Zen with its sidebar hidden, only the note on the window. */
const HIDE_SIDEBAR = new Set(["zen"])
/** A small window (its text still reads on a card a third of the page wide), as a 16:10 picture: the card's
 *  (web/src/pages/Bundles.tsx Thumb), sharp in the preview sheet. */
const WINDOW = { width: 1088, height: 680 }, PICTURE = { width: 960, height: 600 }

async function serve(vault, local) {
  const port = Number(process.env.PORT) || await freePort()
  const proc = spawn(process.execPath, [path.join(ROOT, "server.ts")], {
    cwd: ROOT, stdio: "ignore", env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: vault, VAULTITE_LOCAL: local },
  })
  const base = `http://127.0.0.1:${port}/`
  const up = await until(async () => (await fetch(`${base}api/state`)).ok, 40_000, 250)
  if (!up) throw new Error(`the server on ${port} didn't start`)
  return { base, port, proc }
}
function stop({ port, proc }) {
  if (proc.exitCode === null) proc.kill()
  try { process.kill(Number(fs.readFileSync(path.join(os.tmpdir(), `vaultite-ptyd1-vaultite-${port}.sock.pid`), "utf8"))) } catch { /* none */ }
  spawnSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" })
}

/** The window as a picture at PICTURE's size (scaled in the page, so it's smoothed as a browser draws it). */
async function picture(page) {
  const png = await page.screenshot({ type: "png" })
  return Buffer.from(await page.evaluate(async ({ b64, width, height }) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = Object.assign(document.createElement("canvas"), { width, height })
    const g = c.getContext("2d")
    g.imageSmoothingQuality = "high"
    g.drawImage(img, 0, 0, width, height)
    return c.toDataURL("image/png").split(",")[1]
  }, { b64: png.toString("base64"), ...PICTURE }), "base64")
}

async function shoot(id) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-shots-"))
  const vault = path.join(tmp, "Personal") // (its name is the vault's, bottom left)
  const made = spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), "sandbox", vault], { encoding: "utf8" })
  if (made.status !== 0) throw new Error(made.stderr || made.stdout)
  fs.rmSync(path.join(vault, ".vaultite/sandbox.json")) // (not the playground: no notice, its own name)
  // (plugins' writes on their own answered "not now": no "wants to write" dialog over the page)
  fs.writeFileSync(path.join(vault, ".vaultite/grants.json"), JSON.stringify(Object.fromEntries(fs.readdirSync(path.join(ROOT, "plugins/core")).flatMap((p) => {
    const writes = JSON.parse(fs.readFileSync(path.join(ROOT, "plugins/core", p, "manifest.json"), "utf8")).writes ?? []
    return writes.length ? [[p, Object.fromEntries(writes.map((w) => [w.folder ?? w.file, "not now"]))]] : []
  }))))
  const server = await serve(vault, path.join(tmp, "local"))
  try {
    const r = await fetch(`${server.base}api/bundles/${id}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowCode: true }) })
    const applied = await r.json()
    if (!check(`${id}: applied`, r.ok, applied)) return
    const at = OPENS[id] ?? applied.plan?.pins?.want?.[0] ?? NOTE
    const ctx = await browser.newContext({ viewport: WINDOW, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" })
    const page = watch(await ctx.newPage(), { label: id })
    await page.goto(`${server.base}#file/${encodeURIComponent(at)}`)
    await until(() => page.locator("main").count(), 10_000)
    await page.waitForLoadState("networkidle").catch(() => {})
    await wait(2500)
    if (HIDE_SIDEBAR.has(id)) {
      await page.locator("[data-sidebar-toggle='']").click()
      await page.mouse.move(WINDOW.width / 2, WINDOW.height / 2)
      await wait(800)
    }
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme })
      await wait(800)
      const toasts = await page.locator("[data-sonner-toast], dialog[open]").count()
      check(`${id} ${scheme}: nothing over the page`, !toasts, toasts)
      const file = path.join(BUNDLES, id, scheme === "light" ? "preview.png" : "preview-dark.png")
      fs.writeFileSync(file, await picture(page))
      console.log(`     ${path.relative(ROOT, file)}: ${Math.round(fs.statSync(file).size / 1024)} KB`)
    }
    await ctx.close()
  } finally {
    stop(server)
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

for (const id of ids.length ? ids : fs.readdirSync(BUNDLES).filter((d) => fs.existsSync(path.join(BUNDLES, d, "bundle.json")))) await shoot(id)
await done()
