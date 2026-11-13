// A sign-in button framed from its provider's site opens its popup, which answers its opener and closes, in any container;
// pages have no FedCM (electron/main.ts). WRITES: throwaway vault. Run: node web/qa/framepopups.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, uiAt, until } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-framepopups-"))
let PORT = 0
const page = (s) => `<!doctype html><meta charset=utf-8>${s}`
const PROVIDER_ON_LOCALHOST_ANOTHER_SITE = {
  "/button": () => page(`<title>Provider button</title><body style="margin:0">
    <button id=asks style="width:150px;height:60px" onclick="parent.postMessage('open-signin', '*')">Asks</button>
    <button id=opens style="width:150px;height:60px" onclick="window.open('/signin', 'signin', 'width=500,height=600')">Opens</button>
    <script>addEventListener('message', (e) => { if (e.data === 'signed-in') parent.postMessage('signed-in by frame', '*') })</script>`),
  "/signin": () => page(`<title>Sign in to Provider</title><body>signing in
    <script>setTimeout(() => { window.opener.postMessage('signed-in', '*'); window.close() }, 300)</script>`),
}
const server = http.createServer((q, r) => {
  r.writeHead(200, { "Content-Type": "text/html" })
  const own = PROVIDER_ON_LOCALHOST_ANOTHER_SITE[new URL(q.url, "http://x").pathname]
  if (own) return r.end(own())
  r.end(page(`<title>Site</title><body style="margin:0"><h1>Site</h1>
    <iframe src="http://localhost:${PORT}/button" style="position:absolute;left:20px;top:100px;width:320px;height:80px;border:0"></iframe>
    <script>window.got = []; addEventListener('message', (e) => {
      if (e.data === 'open-signin') window.open('http://localhost:${PORT}/signin', 'signin', 'width=500,height=600')
      else window.got.push(e.data)
    })</script>`))
})
await new Promise((ok) => server.listen(0, "127.0.0.1", ok))
PORT = server.address().port
const SITE = `http://127.0.0.1:${PORT}/`
const env = { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") }
const app = await _electron.launch({ executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT], env })
try {
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("aside[data-side=right], main", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  await app.evaluate(({ BaseWindow }) => { BaseWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1280, height: 800 }) })
  await fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ containers: [{ id: "agents", name: "Agents", color: "blue" }] }) })

  const view = () => app.evaluate(async ({ BaseWindow, session }) => {
    const w = BaseWindow.getAllWindows()[0], v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
    if (!v) return null
    const js = (s) => v.webContents.executeJavaScript(s).catch(() => null)
    return { ...v.getBounds(), url: v.webContents.getURL(), container: session.fromPartition("persist:web-c-agents") === v.webContents.session,
      got: await js("window.got"), fedcm: await js("'IdentityCredential' in window") }
  })
  const windows = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)
  const forget = () => app.evaluate(({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0], v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
    return v?.webContents.executeJavaScript("window.got = []")
  })

  for (const [where, to, inContainer] of [["in no container", `view:web/${SITE}`, false], ["in a container", `view:web/@agents/${SITE}?c`, true]]) {
    await uiAt(origin)({ action: "open", path: to, newTab: true })
    const placed = await until(async () => { const v = await view(); return v?.url.startsWith(SITE) && v.container === inContainer && v.got && v }, 30000)
    check(`${where}: the page shows`, !!placed, await view())
    if (!placed) continue
    check(`${where}: the page has no FedCM, so sites sign in with their popup`, placed.fedcm === false, placed.fedcm)
    await until(() => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((w) => w.getURL() === url)?.mainFrame.frames[0]
      ?.executeJavaScript("document.readyState === 'complete'"), placed.url), 10000)
    for (const [how, x, said] of [["the frame asks the page to open it", 95, "signed-in"], ["the frame opens it", 245, "signed-in by frame"]]) {
      const before = await windows()
      await win.mouse.click(placed.x + x, placed.y + 130)
      check(`${where}: a press on a provider's button in its frame, ${how}: its sign-in popup opens`, !!await until(async () => (await windows()) > before, 8000), await windows())
      check(`${where}: … hands its opener the result`, !!await until(async () => (await view())?.got?.includes(said), 8000), await view())
      check(`${where}: … and closes`, !!await until(async () => (await windows()) === before, 8000), await windows())
      await forget()
    }
  }
} finally {
  await app.close().catch(() => {})
  server.close()
}
done()
