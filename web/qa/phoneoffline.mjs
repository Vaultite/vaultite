// The iPhone app's offline app (web/offline/) on a phone's copy of a vault, the shell stood in for: its files served,
// each api request passed to the page (as App/LocalScheme.swift does). The app opens, shows the notes, keeps an edit
// in the copy.   node web/qa/phoneoffline.mjs   (needs npm run build:offline)
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { qa, ROOT } from "./lib/qa.mjs"

const { browser, check, watch, done, skip } = await qa(import.meta.url)
const DIST = path.join(ROOT, "web/dist")
if (!fs.existsSync(path.join(DIST, "offline.html"))) await skip("no web/dist/offline.html: npm run build:offline")
const TYPES = { html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml", wasm: "application/wasm", png: "image/png", woff2: "font/woff2", webmanifest: "application/manifest+json" }
const files = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(new URL(req.url, "http://x").pathname))
  if (!p.startsWith(DIST) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p).slice(1)] ?? "application/octet-stream" }); fs.createReadStream(p).pipe(res)
}).listen(0, "127.0.0.1")
await new Promise((r) => files.once("listening", r))
const base = `http://127.0.0.1:${files.address().port}`
const VAULT = "c0ffee00-1111-4222-8333-444455556666"

const copy = {
  "Notes/Plan.md": "# Plan\n\n- [ ] pack\n\n![[Trip.png]]\n",
  "Notes/Ideas.md": "# Ideas\n\nwritten before going offline\n",
  ".vaultite/plugins/machines/vault.json": JSON.stringify({ id: VAULT }),
}
const native = ([vault, copy]) => {
  const enc = new TextEncoder(), files = new Map(), key = (o, p) => `${o.area}/${o.vault}/${p ?? o.path}`
  let tick = Date.now()
  for (const [p, t] of Object.entries(copy)) files.set(`vault/${vault}/${p}`, { bytes: enc.encode(t), mtime: tick })
  const b64 = (u) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  const stat = (k) => ({ size: files.get(k).bytes.length, mtime: files.get(k).mtime })
  const shell = {
    localList: (o) => ({ files: [...files.keys()].filter((k) => k.startsWith(`${o.area}/${o.vault}/`)).map((k) => ({ path: k.slice(o.area.length + o.vault.length + 2), ...stat(k) })) }),
    localRead: (o) => ({ files: Object.fromEntries(o.paths.map((p) => [p, files.has(key(o, p)) ? b64(files.get(key(o, p)).bytes) : null])) }),
    localWrite: (o) => { files.set(key(o), { bytes: unb64(o.data), mtime: ++tick }); return stat(key(o)) },
    localRemove: (o) => { files.delete(key(o)); return {} },
    localAnswer: (o) => window.__answer(o),
    localInfo: () => ({ free: 1 << 30, wifi: false, vaults: [vault] }),
  }
  window.__phone = { text: (p) => files.has(`vault/${vault}/${p}`) ? new TextDecoder().decode(files.get(`vault/${vault}/${p}`).bytes) : null,
    setPreview: (name, data) => files.set(`sync/${vault}/${name}`, { bytes: unb64(data), mtime: ++tick }) }
  files.set(`sync/${vault}/previews/index.json`, { bytes: enc.encode(JSON.stringify({ "Attachments/Trip.png": "x" })), mtime: tick })
  window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n) => n === "Shell", PluginHeaders: [{ name: "Shell", methods: Object.keys(shell).map((name) => ({ name })) }],
    nativePromise: async (plugin, method, o) => { const fn = shell[method]; return fn ? fn(o ?? {}) : {} } }
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const waiting = new Map()
await ctx.exposeFunction("__answer", (a) => { waiting.get(a.id)?.(a); waiting.delete(a.id) })
await ctx.addInitScript(native, [VAULT, copy])
const page = watch(await ctx.newPage(), { ignore: /favicon|Failed to load resource|WebSocket/ })
let n = 0
// (the shell's scheme handler: api requests to the page's window.__vaultiteLocal, answered through localAnswer)
await page.route(`${base}/api/**`, async (route) => {
  const r = route.request(), id = `r${++n}`, u = new URL(r.url())
  const answered = new Promise((ok) => waiting.set(id, ok))
  const body = r.postDataBuffer()
  const sent = await page.evaluate((m) => { const l = window.__vaultiteLocal; if (!l) return false; l.request(m); return true },
    { id, method: r.method(), url: u.pathname + u.search, headers: r.headers(), body: body ? body.toString("base64") : null }).catch(() => false)
  if (!sent) { waiting.delete(id); return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "the offline app isn't running" }) }) }
  const a = await answered
  await route.fulfill({ status: a.status, headers: a.headers ?? {}, body: a.body ? Buffer.from(a.body, "base64") : "" })
})
await page.goto(`${base}/offline.html?vault=${VAULT}`)
const opened = await page.locator("text=Plan").first().waitFor({ timeout: 60_000 }).then(() => true, () => false)
check("the offline app opens on the phone's copy, its notes listed", opened)
check("it says it's this phone's copy", (await page.locator("text=Offline: this phone's copy").count()) === 1)

// An edit through the app's own API, as typing saves: kept in the copy's file.
const saved = await page.evaluate(async () => {
  const r = await fetch("api/file?path=Notes%2FIdeas.md").then((x) => x.json())
  const w = await fetch("api/file", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "Notes/Ideas.md", text: `${r.text ?? ""}typed offline\n` }) })
  return w.status
})
check("an edit saves", saved === 200, saved)
let kept = false
for (let i = 0; i < 40 && !kept; i++) { kept = ((await page.evaluate(() => window.__phone.text("Notes/Ideas.md"))) ?? "").includes("typed offline"); if (!kept) await new Promise((r) => setTimeout(r, 250)) }
check("...into the phone's copy, for sync to send when the hub's back", kept)

await page.screenshot({ path: "/tmp/phoneoffline.png" })
files.close()
await done()
