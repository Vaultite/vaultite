// Every UI preference in a vault file (sidebars.json, hotkeys.json, live from disk) and shells that know they're in
// Vaultite (env, PATH). Writes settings (put back) and runs shells: throwaway server only.
//   node web/qa/agentui.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import WebSocket from "ws"
import { apiAt, qa, tailnet, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/agentui-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const VAULT = (await (await fetch(new URL("/api/vault", B))).json()).path
const keep = (p) => { const f = path.join(VAULT, p); let t = null; try { t = readFileSync(f, "utf8") } catch {} return () => (t === null ? rmSync(f, { force: true }) : writeFileSync(f, t)) }
const restore = [keep(".vaultite/plugins.json"), keep(".vaultite/sidebars.json"), keep(".vaultite/hotkeys.json"), keep(".vaultite/plugins/terminal/data.json")]
const conf = (name) => { try { return JSON.parse(readFileSync(path.join(VAULT, `.vaultite/${name}.json`), "utf8")) } catch { return {} } }
const setConf = (name, patch) => writeFileSync(path.join(VAULT, `.vaultite/${name}.json`), JSON.stringify({ ...conf(name), ...patch }, null, 2) + "\n")

function shell(cmd, headers = {}, id = `qa${Date.now().toString(36)}`) {
  const u = new URL(`/api/terminal/${id}?cols=200&rows=50`, B)
  return new Promise((resolve) => {
    const ws = new WebSocket(u.href.replace(/^http/, "ws"), { headers: { Origin: `${u.protocol}//${headers.Host ?? u.host}`, ...headers } })
    let out = "", sent = false
    const done = () => { try { ws.send(JSON.stringify({ t: "close" })) } catch {} setTimeout(() => ws.close(), 200); resolve(out) }
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
async function dragTo(key, x, y, shot) {
  const h = await (await page.$(`aside [data-panel='${key}'] [data-panel-handle]`)).boundingBox()
  await page.mouse.move(h.x + 30, h.y + h.height / 2); await page.mouse.down()
  await page.mouse.move(h.x + 40, h.y - 10, { steps: 5 }); await page.mouse.move(x, y, { steps: 10 }); await wait(250)
  if (shot) { check("the panels make way", !!(await page.$("aside [data-sidebar-body][data-drop-preview]"))); await page.screenshot({ path: `${OUT}${shot}.png` }) }
  await page.mouse.up(); await wait(600)
}
try {
  setConf("plugins", { disabled: ["backlinks"] })
  setConf("sidebars", sidebarsOf(DEFAULT))
  await page.goto(B)
  await page.waitForSelector("aside [data-panel='terminal:sessions']")
  check("default order", (await panels()).join() === DEFAULT.join(), await panels())

  setConf("sidebars", sidebarsOf(["terminal:sessions", "search:search", "pages:pages", "files:files"]))
  check("sidebars.json on disk: Terminals first", await until(async () => (await panels())[0] === "terminal:sessions"), await panels())
  check("the rest as listed", (await panels()).join() === "terminal:sessions,search:search,pages:pages,files:files", await panels())
  const grows = await page.$eval("aside [data-panel='files:files']", (el) => el.getBoundingClientRect().height)
  check("the tree still takes the height left", grows > 300, grows)
  await page.screenshot({ path: `${OUT}1-terminals-first.png` })

  setConf("sidebars", sidebarsOf(DEFAULT))
  await until(async () => (await panels())[2] === "terminal:sessions")
  await page.click("aside [data-panel='terminal:sessions'] [data-panel-handle]", { button: "right" })
  const items = await page.$$eval("[role=menu] [role^=menuitem]", (els) => els.map((e) => e.textContent.trim()))
  check("menu has Panels, Move to right sidebar and Hide (no Move up)", items.includes("Panels") && items.includes("Move to right sidebar") && items.includes("Hide Terminals") && !items.includes("Move up"), items)
  await page.keyboard.press("Escape")
  const pg = await (await page.$("aside [data-panel='pages:pages']")).boundingBox()
  await dragTo("terminal:sessions", pg.x + 60, pg.y + 3)
  check("dragged up: above the pages", await until(async () => (await panels()).join() === "search:search,terminal:sessions,pages:pages,files:files"), await panels())
  check("saved in sidebars.json", await until(() => saved() === "search:search,terminal:sessions,pages:pages,files:files"), conf("sidebars"))
  check("plugins.json's keys kept", Array.isArray(conf("plugins").disabled), conf("plugins"))

  const tm = await (await page.$("aside [data-panel='terminal:sessions']")).boundingBox()
  await dragTo("files:files", tm.x + 60, tm.y + 3, "2-dragging")
  check("dragged up: under Search", await until(async () => (await panels()).join() === "search:search,files:files,terminal:sessions,pages:pages"), await panels())
  check("drag saved", await until(() => saved() === "search:search,files:files,terminal:sessions,pages:pages"), conf("sidebars"))
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

  rmSync(path.join(VAULT, ".vaultite/hotkeys.json"), { force: true })
  await page.goto(`${B}#settings`)
  await page.waitForSelector('[data-settings-nav="hotkeys"]')
  await page.click('[data-settings-nav="hotkeys"]')
  await page.waitForSelector("[data-hotkeys]")
  const n = (await page.$$("[data-hotkey]")).length
  check("commands listed", n > 20, n)
  const listed = () => page.$$eval("[data-hotkey]", (e) => e.map((x) => x.dataset.hotkey).sort().join())
  await page.fill("input[aria-label='Filter commands']", "left sidebar")
  check("filter", (await listed()) === "sidebar:focus-left,sidebar:toggle", await listed())
  await page.fill("input[aria-label='Filter commands']", "hide left sidebar")
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
  await page.click(`${row} button[aria-label='Remove Mod+\\\\']`)
  check("default removed", await until(() => JSON.stringify(conf("hotkeys")["sidebar:toggle"]) === '["Mod+Shift+Y"]'), conf("hotkeys"))
  await page.keyboard.press("ControlOrMeta+\\")
  await wait(300)
  check("the old keys don't", (await open()) === was)
  await page.click(`${row} button[aria-label^='Add a hotkey']`)
  await page.keyboard.press("ControlOrMeta+P")
  check("taken keys ask first", !!(await until(() => page.$(`${row} [data-hotkey-taken]`))) && !(conf("hotkeys")["sidebar:toggle"] ?? []).includes("Mod+P"))
  await page.click(`${row} [data-hotkey-taken] button:has-text("Keep both")`)
  check("conflict shown", !!(await until(() => page.$(`${row} [data-hotkey-conflict]`))))
  await page.screenshot({ path: `${OUT}4-hotkeys.png` })
  await page.click(`${row} button[aria-label='Restore default']`)
  check("restore default", await until(() => !("sidebar:toggle" in conf("hotkeys"))), conf("hotkeys"))
  check("default keys back", !!(await until(() => page.$(`${row} button[aria-label='Remove Mod+\\\\']`))))
  writeFileSync(path.join(VAULT, ".vaultite/hotkeys.json"), JSON.stringify({ "sidebar:toggle": ["Mod+Shift+U"] }))
  check("hotkeys.json on disk applies", !!(await until(() => page.$(`${row} button[aria-label='Remove Mod+Shift+U']`))))
  await page.click("#sheet-title")
  await page.keyboard.press("ControlOrMeta+Shift+U")
  check("and its keys run it", await until(async () => (await open()) !== was))
  await page.keyboard.press("ControlOrMeta+Shift+U")
  await page.fill("input[aria-label='Filter commands']", "")
  await page.screenshot({ path: `${OUT}5-hotkeys-all.png` })
} catch (e) {
  check(String(e), false)
}

const BIN = path.resolve(import.meta.dirname, "../../bin")
// (what shells print: prompt escapes, a cursor shape, systemd's OSC 3008 on Ubuntu, a grep alias's colours)
const plain = (s) => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
const env = plain(await shell(`env | grep -E '^VAULTITE' | sort; echo "$PATH" | tr : '\\n' | grep -qx '${BIN}' && echo HAS-BIN; command -v vau || echo no-vau-yet`))
const has = (k, v) => new RegExp(`^${k}=${v}\\r?$`, "m").test(env)
check("VAULTITE=1", has("VAULTITE", "1"), env)
check("VAULTITE_URL is this server", has("VAULTITE_URL", `http://127\\.0\\.0\\.1:${new URL(B).port}`), env)
check("VAULTITE_VAULT", env.includes(`VAULTITE_VAULT=${VAULT}`), env)
check("VAULTITE_CLIENT=web", has("VAULTITE_CLIENT", "web"), env)
check("no VAULTITE_REMOTE locally", !env.includes("VAULTITE_REMOTE"), env)
check("the app's bin/ on PATH", /^HAS-BIN\r?$/m.test(env), env)
await apiAt(B)("PATCH", "config/plugin/terminal", { allowUsers: ["qa-friend@example.com"] })
const { name } = tailnet(), ts = `${name}:8447`
if (name) {
  const remote = plain(await shell("env | grep VAULTITE_REMOTE", { Host: ts, Origin: `https://${ts}`, "Tailscale-User-Login": "qa-friend@example.com" }))
  check("VAULTITE_REMOTE=tailscale through Serve", /VAULTITE_REMOTE=tailscale/.test(remote), remote)
} else console.log("skip VAULTITE_REMOTE=tailscale through Serve (no Tailscale)")
const cid = `claude-qa${Date.now().toString(36)}`
const ws = new WebSocket(new URL(`/api/terminal/${cid}`, B).href.replace(/^http/, "ws"), { headers: { Origin: new URL(B).origin } })
await new Promise((r) => ws.on("open", r))
const installed = (() => { try { return /claude/.test(execFileSync(process.env.SHELL || "/bin/sh", ["-ilc", "command -v claude"], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] })) } catch { return false } })()
if (installed) {
  const args = await until(() => { try { return execFileSync("/bin/ps", ["-axww", "-o", "args="], { encoding: "utf8" }).split("\n").find((l) => /^claude --append-system-prompt .*inside Vaultite/.test(l.trim()) || /-c claude --append-system-prompt/.test(l)) } catch { return "" } }, 10000)
  check("Claude Code runs with --append-system-prompt", !!args, args)
} else console.log("skip Claude Code runs with --append-system-prompt: no claude on this machine")
ws.send(JSON.stringify({ t: "close" }))
await wait(500)
ws.close()

restore.forEach((f) => f())
await done()
