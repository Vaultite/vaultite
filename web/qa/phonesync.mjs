// The iPhone app's copy of the vault (device sync): the hub's page fills it in the phone's container (stood in for here,
// in the page), an edit made there offline reaches the hub, media kept by a rule comes down, Downloads lists it.
//   node web/qa/phonesync.mjs        (its own throwaway hub server; needs npm run build)
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { freePort, testServer, tempDir, waitFor } from "../../tools/test/lib.ts"
import { qa, wait } from "./lib/qa.mjs"

const { browser, check, watch, done } = await qa(import.meta.url)
const tmp = tempDir("vaultite-phonesync-"), vault = path.join(tmp, "vault"), local = path.join(tmp, "local"), id = crypto.randomUUID()
const put = (p, text) => { fs.mkdirSync(path.dirname(path.join(vault, p)), { recursive: true }); fs.writeFileSync(path.join(vault, p), text) }
put(".vaultite/plugins/machines/vault.json", JSON.stringify({ id }))
put("Notes/Idea.md", "# Idea\n\nfrom the hub\n")
fs.mkdirSync(path.join(local, "sync"), { recursive: true })
fs.writeFileSync(path.join(local, "sync", "sets.json"), JSON.stringify({ sets: [{ id, folder: vault, device: "hub", peers: [], mailbox: null, git: null }] }))
const port = await freePort(), base = `http://127.0.0.1:${port}`
testServer({ env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: vault, VAULTITE_LOCAL: local, VAULTITE_SYNC_MS: "700" }, stdio: "ignore" })
await waitFor(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok ?? false, 60_000, 200)
await waitFor(async () => (await (await fetch(`${base}/api/ops/sync.status`, { method: "POST" })).json()).result?.[0]?.lastStep, 30_000, 200)
const op = async (name, params = {}) => { const j = await (await fetch(`${base}/api/ops/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) })).json(); return j.result ?? j }

// The shell's native side, in the page: its local copy is window.__phone (area/vault/path -> bytes).
const native = () => {
  const files = new Map(), key = (o, p) => `${o.area}/${o.vault}/${p ?? o.path}`
  const b64 = (u) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  let tick = Date.now()
  const stat = (k) => ({ size: files.get(k).bytes.length, mtime: files.get(k).mtime })
  const shell = {
    localList: (o) => ({ files: [...files.keys()].filter((k) => k.startsWith(`${o.area}/${o.vault}/`)).map((k) => ({ path: k.slice(o.area.length + o.vault.length + 2), ...stat(k) })) }),
    localRead: (o) => ({ files: Object.fromEntries(o.paths.map((p) => [p, files.has(key(o, p)) ? b64(files.get(key(o, p)).bytes) : null])) }),
    localWrite: (o) => { const k = key(o), was = files.get(k)?.bytes, add = unb64(o.data); files.set(k, { bytes: o.append && was ? new Uint8Array([...was, ...add]) : add, mtime: ++tick }); return stat(k) },
    localRemove: (o) => { files.delete(key(o)); return {} },
    localMove: (o) => { const f = files.get(key(o, o.from)); files.delete(key(o, o.from)); files.set(key(o, o.to), { ...f, mtime: ++tick }); return stat(key(o, o.to)) },
    localFetch: async (o) => {
      const bytes = new Uint8Array(await (await fetch(o.url)).arrayBuffer())
      const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("")
      files.set(key(o), { bytes, mtime: ++tick })
      return { ...stat(key(o)), sha256: sha }
    },
    localInfo: () => ({ free: 50 << 30, wifi: true, vaults: [] }),
    setOffline: () => ({}), openOffline: () => ({}), localAnswer: () => ({}),
  }
  window.__phone = { files, write: (k, text) => files.set(k, { bytes: new TextEncoder().encode(text), mtime: ++tick }), text: (k) => files.has(k) ? new TextDecoder().decode(files.get(k).bytes) : null }
  window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n) => n === "Shell", PluginHeaders: [{ name: "Shell", methods: Object.keys(shell).map((name) => ({ name })) }],
    nativePromise: async (plugin, method, o) => { if (plugin !== "Shell") throw new Error("no plugin"); const fn = shell[method]; return fn ? fn(o ?? {}) : {} } }
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(native)
const page = watch(await ctx.newPage(), { ignore: /favicon|Failed to load resource|WebSocket/ })
await page.goto(base)
const phone = (p) => page.evaluate(([v, p]) => window.__phone.text(`vault/${v}/${p}`), [id, p])
check("the phone's copy fills from the hub's page", await waitFor(async () => (await phone("Notes/Idea.md")) === "# Idea\n\nfrom the hub\n", 30_000, 300))

put("Notes/Later.md", "made on the hub later\n")
check("a note made on the hub comes to the copy", await waitFor(async () => (await phone("Notes/Later.md")) === "made on the hub later\n", 30_000, 300))

// What the offline app writes is the copy's file: looked at on the next step, sent to the hub.
await page.evaluate(([v]) => { window.__phone.write(`vault/${v}/Notes/Idea.md`, "# Idea\n\nfrom the hub\nwritten on the phone offline\n"); dispatchEvent(new Event("vaultite:back")) }, [id])
check("an edit made on the phone reaches the hub", await waitFor(() => fs.readFileSync(path.join(vault, "Notes/Idea.md"), "utf8").includes("written on the phone offline"), 30_000, 300))

const clip = crypto.randomBytes(200 << 10)
fs.mkdirSync(path.join(vault, "Clips"), { recursive: true }); fs.writeFileSync(path.join(vault, "Clips/clip.mp4"), clip)
await wait(2500)
const kept = await op("sync.keep", { path: "Clips", kind: "video" })
check("sync.keep sets the phone's rule", kept?.rules?.keep?.[0]?.path === "Clips", kept)
await page.evaluate(() => dispatchEvent(new Event("vaultite:back")))
check("media a rule keeps comes down whole", await waitFor(async () => {
  const b = await page.evaluate(([v]) => { const f = window.__phone.files.get(`vault/${v}/Clips/clip.mp4`); return f ? Array.from(f.bytes.slice(0, 16)) : null }, [id])
  return b && Buffer.from(b).equals(clip.subarray(0, 16))
}, 40_000, 400))

await page.goto(`${base}/#view/phone-downloads`)
const listed = await waitFor(async () => (await page.locator("text=clip.mp4").count()) > 0, 15_000, 300)
check("Downloads lists it with its kind", listed && (await page.locator("text=/Video ·/").count()) > 0)
await done()
