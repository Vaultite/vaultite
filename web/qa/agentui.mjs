// Every UI preference in a vault file, and shells that know they're inside Vaultite:
// - the sidebar's panels: sidebars.json written on disk reorders them live; dragging Terminals by its heading above the
//   pages moves it (and writes sidebars.json); right-click has Panels, Move to right sidebar and Hide; the tree still
//   grows when moved;
// - Settings > Hotkeys: one row that opens the sheet, which lists commands, filter, record a new combination for a command (hotkeys.json gets only that
//   line), the rebound keys run it, conflicts shown, restore default; hotkeys.json edited on disk applies live;
// - a terminal's environment: VAULTITE, VAULTITE_URL, VAULTITE_VAULT, VAULTITE_CLIENT, the app's bin/ on PATH, and
//   VAULTITE_REMOTE=tailscale only through Serve (an allowUsers login); "Open Claude Code" runs claude with
//   --append-system-prompt.
// Writes plugins.json, sidebars.json, hotkeys.json and the terminal's settings (put back after) and runs shells: throwaway server only.
//   node web/qa/agentui.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import WebSocket from "ws"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/agentui-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const VAULT = (await (await fetch(new URL("/api/vault", B))).json()).path
const keep = (p) => { const f = path.join(VAULT, p); let t = null; try { t = readFileSync(f, "utf8") } catch { /* none */ } return () => (t === null ? rmSync(f, { force: true }) : writeFileSync(f, t)) }
const restore = [keep(".vaultite/plugins.json"), keep(".vaultite/sidebars.json"), keep(".vaultite/hotkeys.json"), keep(".vaultite/plugins/terminal/data.json")]
const conf = (name) => { try { return JSON.parse(readFileSync(path.join(VAULT, `.vaultite/${name}.json`), "utf8")) } catch { return {} } }
const setConf = (name, patch) => writeFileSync(path.join(VAULT, `.vaultite/${name}.json`), JSON.stringify({ ...conf(name), ...patch }, null, 2) + "\n")

/** Runs `cmd` in a new shell over the terminal's socket and returns what it printed (then ends the shell). */
function shell(cmd, headers = {}, id = `qa${Date.now().toString(36)}`) {
  const u = new URL(`/api/terminal/${id}?cols=200&rows=50`, B)
  return new Promise((resolve) => {
    const ws = new WebSocket(u.href.replace(/^http/, "ws"), { headers: { Origin: `${u.protocol}//${headers.Host ?? u.host}`, ...headers } })
    let out = "", sent = false
    const done = () => { try { ws.send(JSON.stringify({ t: "close" })) } catch { /* gone */ } setTimeout(() => ws.close(), 200); resolve(out) }
    ws.on("message", (d, binary) => {
      if (!binary) { const m = JSON.parse(String(d)); if (m.t === "refused") { out = `refused: ${m.reason}`; ws.close(); resolve(out) } return }
      out += String(d)
      if (!sent) { sent = true; setTimeout(() => ws.send(Buffer.from(`${cmd}; echo QA-DONE\r`)), 800) }
      if (/QA-DONE\s*\r?\n[\s\S]*$/.test(out.split(`${cmd}; echo QA-DONE`).pop() ?? "")) done()
    })
    ws.on("error", (e) => resolve(String(e)))
    setTimeout(done, 15000)
  })
}

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
const panels = () => page.$$eval("aside [data-panel]", (els) => els.map((e) => e.getAttribute("data-panel")))
const DEFAULT = ["search:search", "pages:pages", "terminal:sessions", "files:files"]
const sidebarsOf = (keys) => ({ left: keys, right: [], collapsed: [] })
const saved = () => (conf("sidebars").left ?? []).join()
/** Drag a panel by its heading to (x, y). */
async function dragTo(key, x, y, shot) {
  const h = await (await page.$(`aside [data-panel='${key}'] [data-panel-handle]`)).boundingBox()
  await page.mouse.move(h.x + 30, h.y + h.height / 2); await page.mouse.down()
  await page.mouse.move(h.x + 40, h.y - 10, { steps: 5 }); await page.mouse.move(x, y, { steps: 10 }); await wait(250)
  if (shot) { check("a line shows where", !!(await page.$("aside [data-panel-line]"))); await page.screenshot({ path: `${OUT}${shot}.png` }) }
  await page.mouse.up(); await wait(600)
}
try {
  // Workspaces off (a workspace keeps sidebars of its own), and the default panels (Links, hidden until shown, isn't).
  const hadOrder = Array.isArray(conf("plugins").order)
  setConf("plugins", { disabled: ["backlinks", "workspaces"] })
  setConf("sidebars", sidebarsOf(DEFAULT))
  await page.goto(B)
  await page.waitForSelector("aside [data-panel='terminal:sessions']")
  check("default order", (await panels()).join() === DEFAULT.join(), await panels())

  // An AI edits sidebars.json: the sidebar follows, live.
  setConf("sidebars", sidebarsOf(["terminal:sessions", "search:search", "pages:pages", "files:files"]))
  check("sidebars.json on disk: Terminals first", await until(async () => (await panels())[0] === "terminal:sessions"), await panels())
  check("the rest as listed", (await panels()).join() === "terminal:sessions,search:search,pages:pages,files:files", await panels())
  const grows = await page.$eval("aside [data-panel='files:files']", (el) => el.getBoundingClientRect().height)
  check("the tree still takes the height left", grows > 300, grows)
  await page.screenshot({ path: `${OUT}1-terminals-first.png` })

  // Right-click the Terminals panel: Panels ▸, Move to right sidebar, Hide (no Move up / Move down: dragging does it).
  setConf("sidebars", sidebarsOf(DEFAULT))
  await until(async () => (await panels())[2] === "terminal:sessions")
  await page.click("aside [data-panel='terminal:sessions'] [data-panel-handle]", { button: "right" })
  const items = await page.$$eval("[role=menu] [role^=menuitem]", (els) => els.map((e) => e.textContent.trim()))
  check("menu has Panels, Move to right sidebar and Hide (no Move up)", items.includes("Panels") && items.includes("Move to right sidebar") && items.includes("Hide Terminals") && !items.includes("Move up"), items)
  await page.keyboard.press("Escape")
  // Into the gap above the pages (the nearest gap to the pointer).
  const pg = await (await page.$("aside [data-panel='pages:pages']")).boundingBox()
  await dragTo("terminal:sessions", pg.x + 60, pg.y + 3)
  check("dragged up: above the pages", await until(async () => (await panels()).join() === "search:search,terminal:sessions,pages:pages,files:files"), await panels())
  check("saved in sidebars.json", await until(() => saved() === "search:search,terminal:sessions,pages:pages,files:files"), conf("sidebars"))
  check("plugins.json's keys kept", Array.isArray(conf("plugins").disabled) && (!hadOrder || Array.isArray(conf("plugins").order)), conf("plugins"))

  // Files by its heading, up between Search and Terminals.
  const tm = await (await page.$("aside [data-panel='terminal:sessions']")).boundingBox()
  await dragTo("files:files", tm.x + 60, tm.y + 3, "2-dragging")
  check("dragged up: under Search", await until(async () => (await panels()).join() === "search:search,files:files,terminal:sessions,pages:pages"), await panels())
  check("drag saved", await until(() => saved() === "search:search,files:files,terminal:sessions,pages:pages"), conf("sidebars"))
  // Escape cancels a drag.
  const ph = await (await page.$("aside [data-panel='pages:pages'] [data-panel-handle]")).boundingBox()
  await page.mouse.move(ph.x + 10, ph.y + ph.height / 2)
  await page.mouse.down()
  await page.mouse.move(ph.x + 10, tm.y + 3, { steps: 6 })
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await wait(300)
  check("Esc cancels a drag", (await panels()).join() === "search:search,files:files,terminal:sessions,pages:pages", await panels())
  await page.screenshot({ path: `${OUT}3-dropped.png` })
  setConf("sidebars", sidebarsOf(DEFAULT))

  // Settings > Hotkeys.
  rmSync(path.join(VAULT, ".vaultite/hotkeys.json"), { force: true })
  await page.goto(`${B}#settings`)
  await page.waitForSelector("[data-hotkeys-open]")
  check("Settings has one Hotkeys row, not the list", !(await page.$("[data-hotkeys]")))
  await page.click("[data-hotkeys-open]")
  await page.waitForSelector("dialog [data-hotkeys]")
  const n = (await page.$$("[data-hotkey]")).length
  check("commands listed", n > 20, n)
  // Every word must match: "left sidebar" lists toggling and focusing it, "toggle left sidebar" only the first.
  const listed = () => page.$$eval("[data-hotkey]", (e) => e.map((x) => x.dataset.hotkey).sort().join())
  await page.fill("input[aria-label='Filter commands']", "left sidebar")
  check("filter", (await listed()) === "sidebar:focus-left,sidebar:toggle", await listed())
  await page.fill("input[aria-label='Filter commands']", "toggle left sidebar")
  check("filter narrows", (await listed()) === "sidebar:toggle", await listed())
  const row = "[data-hotkey='sidebar:toggle']"
  await page.click(`${row} button[aria-label^='Add a hotkey']`)
  check("recording", !!(await page.$(`${row} [data-recording]`)))
  await page.keyboard.press("ControlOrMeta+Shift+Y")
  check("recorded", await until(() => JSON.stringify(conf("hotkeys")) === JSON.stringify({ "sidebar:toggle": ["Mod+\\", "Mod+Shift+Y"] })), conf("hotkeys"))
  const open = () => page.$eval("aside", (a) => !a.hasAttribute("data-collapsed"))
  const was = await open()
  await page.keyboard.press("ControlOrMeta+Shift+Y")
  check("the new keys run it", await until(async () => (await open()) !== was))
  await page.keyboard.press("ControlOrMeta+Shift+Y")
  await until(async () => (await open()) === was)
  // Remove the default: ⌘\ no longer toggles.
  await page.click(`${row} button[aria-label='Remove Mod+\\\\']`)
  check("default removed", await until(() => JSON.stringify(conf("hotkeys")["sidebar:toggle"]) === '["Mod+Shift+Y"]'), conf("hotkeys"))
  await page.keyboard.press("ControlOrMeta+\\")
  await wait(300)
  check("the old keys don't", (await open()) === was)
  // A conflict: give it ⌘P too.
  await page.click(`${row} button[aria-label^='Add a hotkey']`)
  await page.keyboard.press("ControlOrMeta+P")
  check("conflict shown", !!(await until(() => page.$(`${row} [data-hotkey-conflict]`))))
  await page.screenshot({ path: `${OUT}4-hotkeys.png` })
  await page.click(`${row} button[aria-label='Restore default']`)
  check("restore default", await until(() => !("sidebar:toggle" in conf("hotkeys"))), conf("hotkeys"))
  check("default keys back", !!(await until(() => page.$(`${row} button[aria-label='Remove Mod+\\\\']`))))
  // hotkeys.json edited on disk (an AI): applies live.
  writeFileSync(path.join(VAULT, ".vaultite/hotkeys.json"), JSON.stringify({ "sidebar:toggle": ["Mod+Shift+U"] }))
  check("hotkeys.json on disk applies", !!(await until(() => page.$(`${row} button[aria-label='Remove Mod+Shift+U']`))))
  await page.click("#sheet-title") // off the filter field, inside the sheet
  await page.keyboard.press("ControlOrMeta+Shift+U")
  check("and its keys run it", await until(async () => (await open()) !== was))
  await page.keyboard.press("ControlOrMeta+Shift+U")
  await page.fill("input[aria-label='Filter commands']", "")
  await page.screenshot({ path: `${OUT}5-hotkeys-all.png` })
} catch (e) {
  check(String(e), false)
}

// Terminals: the shell's environment.
const BIN = path.resolve(import.meta.dirname, "../../bin") // the server under test runs from this checkout
// (As printed: escapes the shell's prompt draws, a cursor shape, may begin a line.)
const env = (await shell(`env | grep -E '^VAULTITE' | sort; echo "$PATH" | tr : '\\n' | grep -qx '${BIN}' && echo HAS-BIN; command -v vau || echo no-vau-yet`))
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
const has = (k, v) => new RegExp(`^${k}=${v}\\r?$`, "m").test(env)
check("VAULTITE=1", has("VAULTITE", "1"), env)
check("VAULTITE_URL is this server", has("VAULTITE_URL", `http://127\\.0\\.0\\.1:${new URL(B).port}`), env)
check("VAULTITE_VAULT", env.includes(`VAULTITE_VAULT=${VAULT}`), env)
check("VAULTITE_CLIENT=web", has("VAULTITE_CLIENT", "web"), env)
check("no VAULTITE_REMOTE locally", !env.includes("VAULTITE_REMOTE"), env)
check("the app's bin/ on PATH", /^HAS-BIN\r?$/m.test(env), env)
// Through Tailscale Serve (a login in allowUsers): VAULTITE_REMOTE=tailscale.
mkdirSync(path.join(VAULT, ".vaultite/plugins/terminal"), { recursive: true })
writeFileSync(path.join(VAULT, ".vaultite/plugins/terminal/data.json"), JSON.stringify({ allowUsers: ["qa-friend@example.com"] }))
const ts = "home-mac.example.ts.net:8447"
const remote = await shell("env | grep VAULTITE_REMOTE", { Host: ts, Origin: `https://${ts}`, "Tailscale-User-Login": "qa-friend@example.com" })
check("VAULTITE_REMOTE=tailscale through Serve", /VAULTITE_REMOTE=tailscale/.test(remote), remote)
// Claude Code gets the context.
const cid = `claude-qa${Date.now().toString(36)}`
const ws = new WebSocket(new URL(`/api/terminal/${cid}`, B).href.replace(/^http/, "ws"), { headers: { Origin: new URL(B).origin } })
await new Promise((r) => ws.on("open", r))
const args = await until(() => { try { return execFileSync("/bin/ps", ["-axww", "-o", "args="], { encoding: "utf8" }).split("\n").find((l) => /^claude --append-system-prompt .*inside Vaultite/.test(l.trim()) || /-c claude --append-system-prompt/.test(l)) } catch { return "" } }, 10000)
check("Claude Code runs with --append-system-prompt", !!args, args)
ws.send(JSON.stringify({ t: "close" }))
await wait(500)
ws.close()

restore.forEach((f) => f())
await done()
