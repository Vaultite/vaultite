// The Terminal plugin: output kept over a reload, Claude Code's tab, and who gets a shell (this machine, the owner or
// allowUsers through Tailscale Serve). Runs a shell and writes its settings: throwaway server only.
//   node web/qa/terminal.mjs <base url> [out dir]
import http from "node:http"
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { apiAt, openPalette, qa, tailnet, terminalText, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/term-shots/"], browser, check, watch, done } = await qa(import.meta.url)
// The shell starts in the vault: its folder's name, as the server reports it.
const vaultPath = (await (await fetch(new URL("api/vault", B.endsWith("/") ? B : `${B}/`))).json()).path
const vaultName = vaultPath.split("/").filter(Boolean).pop()
mkdirSync(OUT, { recursive: true })
// What it uses, whatever the sandbox turned off (Codex, the Terminals panel). vau tells the served vault: a Vaultite
// terminal's VAULTITE_VAULT is the user's.
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a],
  { encoding: "utf8", env: { ...process.env, VAULTITE_URL: B, VAULTITE_VAULT: vaultPath } })
vau("plugin", "on", "codex")
for (const where of [[], ["--vault"]]) if (!vau("panels", ...where).match(/sidebar:\n(?:\s+\d+\. .*\n)*?\s+\d+\. terminal:sessions/)) vau("panels", "show", "terminals", ...where)
const id = `qa${Date.now().toString(36)}`

/** A WebSocket handshake to the terminal with these extra headers: "attached", "refused" (the server says why in the
 *  socket), or the HTTP status when it wasn't upgraded. */
function handshake(headers, sid = `${id}x`) {
  const u = new URL(`/api/terminal/${sid}?end=1`, B)
  return new Promise((resolve) => {
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: {
      Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers,
    } })
    req.on("upgrade", (res, socket, head) => {
      // The first frame (the server's are unmasked): text JSON {"t":"refused"}, or a close frame (?end=1: allowed). It
      // may come with the upgrade's response, in `head`, rather than as data.
      let buf = Buffer.alloc(0)
      const done = (v) => { socket.destroy(); resolve(v) }
      const got = (d) => {
        buf = Buffer.concat([buf, d])
        if (buf.length < 2) return
        const op = buf[0] & 15
        if (op === 8) return done("attached")
        let len = buf[1] & 127, at = 2
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4 }
        if (buf.length < at + len) return
        try { done(JSON.parse(buf.subarray(at, at + len).toString()).t) } catch { done("?") }
      }
      socket.on("data", got)
      if (head.length) got(head)
      socket.on("close", () => resolve("closed"))
      setTimeout(() => done("timeout"), 3000)
    })
    req.on("response", (res) => { res.resume(); resolve(res.statusCode === 403 ? "refused" : res.statusCode) }) // (refused before the upgrade)
    req.on("error", (e) => resolve(String(e)))
    req.end()
  })
}

for (const dark of [false, true]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: dark ? "dark" : "light" })
  const page = watch(await ctx.newPage(), { console: true })
  const text = () => terminalText(page)
  const until = async (pred, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await pred()) return true; await wait(100) } return false }
  const sid = `${id}${dark ? "d" : "l"}`

  await page.goto(`${B}#view/terminal%2F${sid}`)
  check(`${dark ? "dark" : "light"}: terminal drawn`, await until(async () => (await page.locator(".xterm-screen").count()) > 0))
  await until(async () => /%|\$|❯/.test(await text()), 6000) // a prompt
  await page.locator(".xterm").click()
  await page.keyboard.type("echo hello-$((40+2))")
  await page.keyboard.press("Enter")
  check(`${dark ? "dark" : "light"}: command output`, await until(async () => /^hello-42\s*$/m.test(await text())), (await text()).slice(-300))
  await page.keyboard.type("pwd"); await page.keyboard.press("Enter")
  check(`${dark ? "dark" : "light"}: starts in the vault`, await until(async () => (await text()).includes(vaultName)), (await text()).slice(-300))
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".xterm-scrollable-element")).backgroundColor)
  const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  check(`${dark ? "dark" : "light"}: background follows the theme`, bg === pageBg, [bg, pageBg])
  await page.screenshot({ path: `${OUT}terminal-${dark ? "dark" : "light"}.png` })

  await page.reload()
  check(`${dark ? "dark" : "light"}: output replayed after reload`, await until(async () => /^hello-42\s*$/m.test(await text())), (await text()).slice(-300))
  await page.locator(".xterm").click()
  await page.keyboard.type("echo same-shell-$$"); await page.keyboard.press("Enter")
  await until(async () => /^same-shell-\d+/m.test(await text()))

  if (!dark) {
    // A failed exit: the bar with Restart; Restart starts a new shell in the same tab.
    await page.keyboard.type("exit 3"); await page.keyboard.press("Enter")
    check("exit 3 shows Process exited with code 3", await until(async () => (await page.getByText("Process exited with code 3").count()) > 0))
    await page.screenshot({ path: `${OUT}terminal-exited.png` })
    await page.getByRole("button", { name: "Restart" }).click()
    check("restart gives a new shell", await until(async () => !(await page.getByText("Process exited").count()) && /%|\$|❯/.test(await text())))
    await page.keyboard.type("echo again-$((1+1))"); await page.keyboard.press("Enter")
    check("the new shell answers", await until(async () => /^again-2\s*$/m.test(await text())), (await text()).slice(-300))
    // Scheme change recolours.
    const before = await page.evaluate(() => getComputedStyle(document.querySelector(".xterm-scrollable-element")).backgroundColor)
    await page.evaluate(() => { const h = document.documentElement; if (h.dataset.scheme) delete h.dataset.scheme; else h.dataset.scheme = "gruvbox" }); await wait(300)
    const after = await page.evaluate(() => getComputedStyle(document.querySelector(".xterm-scrollable-element")).backgroundColor)
    check("scheme change recolours", before !== after, [before, after])
    await page.screenshot({ path: `${OUT}terminal-other-scheme.png` })
    // A clean exit closes the tab: its terminal goes (the pane may show another one then: a tab an earlier run left in
    // the workspace).
    await page.locator(`[data-terminal="${sid}"]`).click()
    await page.keyboard.type("exit"); await page.keyboard.press("Enter")
    check("exit closes the tab", await until(async () => (await page.locator(`[data-terminal="${sid}"]`).count()) === 0 && !(await page.getByText("Process exited").count())))
  } else {
    await page.keyboard.type("exit"); await page.keyboard.press("Enter"); await wait(300)
  }
  await ctx.close()
}

// A terminal whose tab is hidden is parked, still connected: its tab comes back as it was, without a new socket (no
// replay to wait for). Closing its tab lets it go.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => {
    window.__socks = []
    const W = window.WebSocket
    window.WebSocket = class extends W {
      constructor(url, p) {
        super(url, p)
        const m = /\/api\/terminal\/([^?]+)/.exec(String(url))
        if (!m || /end=1/.test(String(url))) return
        const r = { id: decodeURIComponent(m[1]), closed: false }
        window.__socks.push(r)
        this.addEventListener("close", () => { r.closed = true })
      }
    }
  })
  const page = watch(await ctx.newPage())
  const text = () => terminalText(page)
  const until = async (pred, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await pred()) return true; await wait(100) } return false }
  const socks = (sid) => page.evaluate((sid) => window.__socks.filter((s) => s.id === sid), sid)
  const sid = `${id}p`
  await page.goto(`${B}#view/terminal%2F${sid}`)
  await until(async () => /%|\$|❯/.test(await text()), 8000)
  await page.locator(".xterm").click()
  await page.keyboard.type("echo parked-$((20+1))"); await page.keyboard.press("Enter")
  await until(async () => (await text()).includes("parked-21"))
  await page.keyboard.press("Control+Backquote") // another terminal, in a new tab: this one's is hidden
  await until(async () => (await page.evaluate(() => window.__socks.length)) > 1)
  await wait(800)
  check("a hidden terminal stays connected", (await socks(sid)).filter((s) => !s.closed).length === 1, await socks(sid))
  await page.locator(`[data-session="${sid}"]`).first().click()
  check("its tab comes back as it was", await until(async () => (await text()).includes("parked-21"), 3000), (await text()).slice(-200))
  check("without a new socket", (await socks(sid)).length === 1, await socks(sid))
  // (its view takes the keys once it's drawn: after that, not into the palette)
  check("it has the keys again", await until(() => page.evaluate((sid) => !!document.activeElement?.closest(`[data-terminal="${sid}"]`), sid), 3000))
  await openPalette(page)
  await page.locator('input[placeholder^="Select a command"]').fill("Close current tab") // (into the palette, not the terminal)
  await wait(300)
  await page.keyboard.press("Enter")
  check("closing its tab lets it go", await until(async () => (await socks(sid)).every((s) => s.closed), 3000), await socks(sid))
  await ctx.close()
}

// Ended from outside (vau terminal end: an agent closing itself, another device's x): its tab closes, shown or hidden,
// rather than staying with "Process exited" or "the session has ended".
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = watch(await ctx.newPage())
  const text = () => terminalText(page)
  const until = async (pred, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await pred()) return true; await wait(100) } return false }
  const tabs = () => page.locator('[role="tab"]').count()
  const hid = `${id}h`
  await page.goto(`${B}#view/terminal%2F${hid}`)
  await until(async () => /%|\$|❯/.test(await text()), 8000)
  await page.locator(".xterm").click()
  await page.keyboard.press("Control+Backquote") // another terminal in a new tab: the first one's is hidden
  const shown = await until(async () => !!(await page.evaluate((h) => [...document.querySelectorAll("[data-terminal]")].some((e) => e.dataset.terminal !== h), hid))) &&
    await page.evaluate((h) => [...document.querySelectorAll("[data-terminal]")].find((e) => e.dataset.terminal !== h)?.dataset.terminal, hid)
  await until(async () => /%|\$|❯/.test(await text()), 8000)
  const n = await tabs()
  vau("terminal", "end", hid)
  check("ended from outside, a hidden terminal's tab closes", await until(async () => (await tabs()) === n - 1), [n, await tabs()])
  vau("terminal", "end", shown)
  // (the last tab closing leaves a new tab)
  check("ended from outside, the shown terminal's tab closes", await until(async () => (await page.locator("[data-terminal]").count()) === 0 &&
    (await tabs()) <= n - 1 && !(await page.getByText(/Process exited|session has ended/).count())), [n, await tabs()])
  await ctx.close()
}

// Claude Code: a terminal tab that types `claude` into its shell.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = watch(await ctx.newPage())
  const text = () => terminalText(page)
  const until = async (pred, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await pred()) return true; await wait(100) } return false }
  // From the app (its button in the Terminals panel, the palette): only the page that makes a terminal's id starts its agent (a tab put back
  // by its address only attaches, and a session that isn't there is "gone").
  await page.goto(B)
  await page.locator('button[data-agent="claude"]').first().click()
  const mine = page.locator(`[data-terminal^="claude-"]`).last()
  await mine.waitFor()
  const sid = await mine.getAttribute("data-terminal")
  check("Claude Code tab runs claude", await until(async () => /Claude Code|Accessing workspace|claude/i.test(await text()), 15000), (await text()).slice(-300))
  check("its tab is named Claude Code", await until(async () => (await page.getByRole("tab", { name: /Claude Code/ }).count()) > 0 || (await page.getByText("Claude Code").count()) > 0))
  await page.screenshot({ path: `${OUT}terminal-claude.png` })
  await ctx.close()
  await handshake({ Host: new URL(B).host }, sid) // ends that session (and Claude Code with it)
}

// Codex: another plugin's agent, run the same way (codex-<id>: the service "agent:codex").
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = watch(await ctx.newPage())
  const text = () => terminalText(page)
  const until = async (pred, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await pred()) return true; await wait(100) } return false }
  // From the app (its button in the Terminals panel, the palette): only the page that makes a terminal's id starts its agent (a tab put back
  // by its address only attaches, and a session that isn't there is "gone").
  await page.goto(B)
  await page.locator("[data-agent]").first().waitFor() // the app is up
  await openPalette(page)
  await page.locator('input[placeholder^="Select a command"]').fill("Open Codex") // (into the palette, not the terminal)
  await wait(300)
  await page.keyboard.press("Enter")
  const mine = page.locator(`[data-terminal^="codex-"]`).last()
  await mine.waitFor()
  const sid = await mine.getAttribute("data-terminal")
  check("Codex tab runs codex", await until(async () => /OpenAI Codex|Trust this folder|codex/i.test(await text()), 15000), (await text()).slice(-300))
  check("its tab is named Codex", await until(async () => (await page.getByRole("tab", { name: /Codex/ }).count()) > 0 || (await page.getByText("Codex").count()) > 0))
  await page.screenshot({ path: `${OUT}terminal-codex.png` })
  await ctx.close()
  await handshake({ Host: new URL(B).host }, sid) // ends that session (and Codex with it)
}

// Refused through a proxy: the page says why and stops (no "Reconnecting…" forever).
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, extraHTTPHeaders: { "X-Forwarded-For": "100.64.0.1" } })
  const page = await ctx.newPage()
  await page.goto(`${B}#view/terminal%2F${id}r`)
  const shown = await page.getByText(/No shell here/).waitFor({ timeout: 8000 }).then(() => true, () => false)
  check("a refused page says why", shown)
  await wait(1500)
  check("and doesn't reconnect", !(await page.getByText("Reconnecting").count()))
  await page.screenshot({ path: `${OUT}terminal-refused.png` })
  await ctx.close()
}
await browser.close()

const { name, owner = "" } = tailnet()
const host = new URL(B).host, ts = `${name || "home-mac.example.ts.net"}:8447`, other = "home-mac.example.ts.net:8447"
const before = (await apiAt(B)("GET", "config/plugin/terminal")).allowUsers ?? null // (this machine's, set by its owner)
await apiAt(B)("PATCH", "config/plugin/terminal", { allowUsers: ["qa-friend@example.com"] })
check("local handshake accepted", (await handshake({ Host: host, Origin: `http://${host}` })) === "attached")
check("X-Forwarded-For refused", (await handshake({ Host: host, "X-Forwarded-For": "100.64.0.1" })) === "refused")
check("an unknown tailnet login refused", (await handshake({ Host: ts, Origin: `https://${ts}`, "Tailscale-User-Login": "someone@example.com" })) === "refused")
check("a login in allowUsers on a name not this machine's refused", (await handshake({ Host: other, Origin: `https://${other}`, "Tailscale-User-Login": "qa-friend@example.com" })) === "refused")
check("a Tailscale header without a login refused", (await handshake({ Host: ts, Origin: `https://${ts}`, "Tailscale-User-Name": "Someone" })) === "refused")
if (name) {
  check("a login in allowUsers accepted", (await handshake({ Host: ts, Origin: `https://${ts}`, "Tailscale-User-Login": "qa-friend@example.com" })) === "attached")
  check("this machine's owner accepted through Serve", (await handshake({ Host: ts, Origin: `https://${ts}`, "Tailscale-User-Login": owner })) === "attached")
} else console.log("skip a login in allowUsers and this machine's owner accepted (no Tailscale)")
check("the owner from another site refused", (await handshake({ Host: ts, Origin: "https://evil.example", "Tailscale-User-Login": owner || "qa-friend@example.com" })) === "refused")
check("another site refused", (await handshake({ Host: host, Origin: "http://evil.example" })) === "refused")
check("a rebinding Host refused", (await handshake({ Host: "evil.example:80", Origin: "http://evil.example:80" })) === "refused")
await apiAt(B)("PATCH", "config/plugin/terminal", { allowUsers: before })

await done()
