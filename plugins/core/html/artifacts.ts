// Artifacts run in an opaque-origin sandbox with no network (connect-src 'none'); the bridge through the app is their
// only way out, and it only reads. So nothing they read can leave; an outside page gets nothing of the vault.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { HTTPError, LOCAL, parseCsv } from "../../../core/plugins.ts"
import { type Item, readText, type Vault, writeAtomic } from "../../../core/vault.ts"

export const ARTIFACT = /\.html?$/i

// ---------- the sandbox ----------

/** For every file served under /v/: its own opaque origin (no allow-same-origin), no network, no popups or forms. */
export const CSP = [
  "sandbox allow-scripts allow-modals allow-downloads allow-pointer-lock",
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "worker-src blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ")

// ---------- public CDNs, through the local cache ----------

export const CDN_HOSTS = [
  "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "esm.sh", "cdn.skypack.dev", "ga.jspm.io",
  "fonts.googleapis.com", "fonts.gstatic.com", "rsms.me", "cdn.tailwindcss.com", "d3js.org", "cdn.plot.ly",
  "code.jquery.com", "cdn.observableusercontent.com",
]
const HOST_RE = new RegExp(`(?:https?:)?//(${CDN_HOSTS.map((h) => h.replaceAll(".", "\\.")).join("|")})(?=[/"'\\s)?#]|$)`, "g")

/** Links to CDN hosts pointed at /cdn/<host> (in HTML, CSS and JS). */
export const viaCache = (text: string) => text.replace(HOST_RE, "/cdn/$1")

/** Inside a file from a CDN, root-relative paths (esm.sh's `import "/react@18/..."`, a font's `url(/...)`) are that
 *  host's, not ours. */
function rootRelative(text: string, host: string) {
  return text
    .replace(/((?:\bfrom|\bimport|\bexport\s*\*\s*from)\s*\(?\s*["'])\/(?!\/|cdn\/)/g, `$1/cdn/${host}/`)
    .replace(/(url\(\s*["']?)\/(?!\/|cdn\/)/g, `$1/cdn/${host}/`)
}

const CACHE = () => path.join(LOCAL, "cache", "cdn")
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"

/** A CDN file: from the cache, or fetched and cached. */
export async function cdn(host: string, rest: string): Promise<{ status: number; type: string; body: Buffer }> {
  if (!CDN_HOSTS.includes(host)) return { status: 404, type: "text/plain", body: Buffer.from(`${host} isn't a CDN artifacts may use`) }
  const url = `https://${host}/${rest}`
  const key = crypto.createHash("sha1").update(url).digest("hex")
  const file = path.join(CACHE(), key), meta = file + ".json"
  try {
    const m = JSON.parse(fs.readFileSync(meta, "utf8"))
    return { status: 200, type: m.type, body: fs.readFileSync(file) }
  } catch { /* not cached yet */ }
  let res: Response
  try {
    res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20_000) })
  } catch (e) {
    return { status: 502, type: "text/plain", body: Buffer.from(`couldn't fetch ${url}: ${(e as Error).message}`) }
  }
  const type = res.headers.get("content-type") ?? "application/octet-stream"
  let body: Buffer = Buffer.from(await res.arrayBuffer())
  if (!res.ok) return { status: res.status, type, body }
  if (/css|javascript|ecmascript|json/.test(type)) {
    const finalHost = new URL(res.url || url).host
    body = Buffer.from(rootRelative(viaCache(body.toString("utf8")), CDN_HOSTS.includes(finalHost) ? finalHost : host))
  }
  fs.mkdirSync(CACHE(), { recursive: true })
  fs.writeFileSync(file, body)
  fs.writeFileSync(meta, JSON.stringify({ url, type }))
  return { status: 200, type, body }
}

// ---------- serving an artifact ----------

/** Where an artifact's localStorage is kept. */
export const statePath = (rel: string) => `.vaultite/artifacts/${rel}.json`

function stateOf(vault: Vault, rel: string): Record<string, string> {
  try {
    const s = JSON.parse(readText(vault.abs(statePath(rel))))
    return s && typeof s === "object" && !Array.isArray(s) ? s : {}
  } catch {
    return {}
  }
}

/** The artifact's HTML with the bridge first in its <head> and CDN links pointed at the cache. An `outside` page runs
 *  the same way, but the app answers none of its vault requests and keeps none of its storage. */
export function page(vault: Vault, rel: string, query: Record<string, string>, outside = false) {
  const html = viaCache(readText(outside ? rel : vault.abs(rel)))
  const cfg = {
    path: rel, dark: query.theme === "dark", scheme: query.scheme || "default", embed: query.embed === "1",
    state: outside ? {} : stateOf(vault, rel),
  }
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c")
  const script = `<script>(${bridge.toString()})(${json}, ${parseCsv.toString()})</script>`
  const head = /<head\b[^>]*>/i.exec(html) ?? /<html\b[^>]*>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + script + html.slice(head.index + head[0].length)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  return doctype ? doctype[0] + script + html.slice(doctype[0].length) : script + html
}

type Cfg = { path: string; dark: boolean; scheme: string; embed: boolean; state: Record<string, string> }

/** Runs first inside the artifact (its source is injected as is, so it must stand alone: no imports, no outer names). */
function bridge(cfg: Cfg, parseCsv: (text: string) => string[][]) {
  const w = window as any
  const top = window.parent !== window ? window.parent : null
  const post = (m: Record<string, unknown>) => { if (top) top.postMessage({ vau: 1, ...m }, "*") }
  const root = document.documentElement
  const folder = cfg.path.includes("/") ? cfg.path.slice(0, cfg.path.lastIndexOf("/") + 1) : ""
  const listeners: Record<string, ((x: any) => void)[]> = {}
  const emit = (ev: string, x: unknown) => (listeners[ev] ?? []).forEach((f) => { try { f(x) } catch (e) { console.error(e) } })

  // Theme: the app's light or dark (data-theme, color-scheme) and scheme, and its colours as --vau-<name>.
  const style = document.createElement("style")
  const theme = { dark: cfg.dark, scheme: cfg.scheme }
  const applyTheme = (t: { dark: boolean; scheme?: string; vars?: Record<string, string> }) => {
    theme.dark = !!t.dark
    if (t.scheme) theme.scheme = t.scheme
    root.setAttribute("data-theme", theme.dark ? "dark" : "light")
    root.setAttribute("data-scheme", theme.scheme)
    root.style.colorScheme = theme.dark ? "dark" : "light"
    if (t.vars) style.textContent = `:root{${Object.entries(t.vars).map(([k, v]) => `--vau-${k}:${v}`).join(";")}}`
    if (!style.isConnected) (document.head ?? root).appendChild(style)
  }
  applyTheme(theme)

  // Storage: the sandbox has none, so localStorage is kept by the app (in the vault) and sessionStorage in memory.
  let saving: ReturnType<typeof setTimeout> | null = null
  const storage = (init: Record<string, string>, keep: boolean): Storage => {
    const m = new Map(Object.entries(init))
    const changed = () => {
      if (!keep) return
      if (saving) clearTimeout(saving)
      saving = setTimeout(() => { saving = null; post({ type: "state", data: Object.fromEntries(m) }) }, 300)
    }
    return {
      get length() { return m.size },
      key: (i: number) => [...m.keys()][i] ?? null,
      getItem: (k: string) => (m.has(String(k)) ? m.get(String(k))! : null),
      setItem: (k: string, v: string) => { m.set(String(k), String(v)); changed() },
      removeItem: (k: string) => { m.delete(String(k)); changed() },
      clear: () => { m.clear(); changed() },
    }
  }
  for (const [name, s] of [["localStorage", storage(cfg.state, true)], ["sessionStorage", storage({}, false)]] as const) {
    try { Object.defineProperty(window, name, { value: s, configurable: true }) } catch { /* keep the browser's */ }
  }

  // Asking the app: vault files (read only), the file list.
  let seq = 0
  const waits = new Map<number, { ok: (x: any) => void; fail: (e: Error) => void }>()
  const ask = (op: string, args: Record<string, unknown>) => new Promise<any>((ok, fail) => {
    if (!top) return fail(new Error("open this in Vaultite to read the vault"))
    const id = ++seq
    waits.set(id, { ok, fail })
    post({ type: "ask", id, op, args })
  })
  const resolve = (p: string) => {
    const parts: string[] = []
    for (const s of (p.startsWith("/") ? p.slice(1) : folder + p).split("/")) {
      if (s === "..") parts.pop()
      else if (s && s !== ".") parts.push(s)
    }
    return parts.map((s) => { try { return decodeURIComponent(s) } catch { return s } }).join("/")
  }
  const read = (p: string): Promise<string> => ask("read", { path: resolve(p) })
  const records = (text: string) => {
    const [head, ...rows] = parseCsv(text)
    return head ? rows.filter((r) => r.some((f) => f !== "")).map((r) => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ""]))) : []
  }
  w.vau = {
    path: cfg.path,
    theme,
    embed: cfg.embed,
    read,
    json: async (p: string) => JSON.parse(await read(p)),
    csv: async (p: string) => records(await read(p)),
    rows: async (p: string) => parseCsv(await read(p)),
    files: (prefix = "") => ask("files", { prefix: prefix.startsWith("/") ? prefix.slice(1) : prefix }),
    open: (target: string) => post({ type: "open", ...(/^[a-z][a-z0-9+.-]*:/i.test(target) ? { url: target } : { path: resolve(target) }) }),
    on: (ev: string, f: (x: any) => void) => {
      (listeners[ev] ??= []).push(f)
      if (ev === "change") post({ type: "listening" })
    },
  }

  // fetch() of a vault file (a relative URL: "Transactions.csv") is a read; anything else has no network.
  const realFetch = window.fetch.bind(window)
  w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href)
    if (url.host === location.host && url.pathname.startsWith("/v/")) {
      const text = await read("/" + url.pathname.slice(3))
      const type = /\.json$/i.test(url.pathname) ? "application/json" : /\.csv$/i.test(url.pathname) ? "text/csv" : "text/plain"
      return new Response(text, { status: 200, headers: { "Content-Type": type } })
    }
    return realFetch(input, init)
  }

  // Links and window.open go through the app: vault files open in it, web links in a new tab.
  const openHref = (href: string) => {
    const url = new URL(href, location.href)
    if (url.host === location.host && url.pathname.startsWith("/v/")) post({ type: "open", path: resolve("/" + url.pathname.slice(3)) })
    else if (/^(https?|mailto):$/.test(url.protocol)) post({ type: "open", url: url.href })
  }
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!a || e.defaultPrevented) return
    const href = a.getAttribute("href") ?? ""
    if (href.startsWith("#") || href.startsWith("javascript:") || a.hasAttribute("download")) return
    e.preventDefault()
    openHref(a.href)
  })
  w.open = (href?: string | URL) => { if (href) openHref(String(href)); return null }

  // Its height, so the app can size the frame to it (content that fills the window stays the window's height).
  let last = 0
  const measure = () => {
    const b = document.body
    const h = Math.ceil(Math.max(root.getBoundingClientRect().height, b ? b.getBoundingClientRect().bottom + parseFloat(getComputedStyle(b).marginBottom || "0") : 0))
    if (Math.abs(h - last) > 1) { last = h; post({ type: "height", h }) }
  }
  const watch = () => {
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    if (document.body) ro.observe(document.body)
    measure()
    post({ type: "ready", title: document.title })
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch)
  else watch()
  addEventListener("load", measure)

  addEventListener("message", (e: MessageEvent) => {
    if (e.source !== top || !e.data || e.data.vau !== 1) return
    const d = e.data
    if (d.type === "reply") {
      const wt = waits.get(d.id)
      waits.delete(d.id)
      if (wt) (d.error ? wt.fail(new Error(d.error)) : wt.ok(d.value))
    } else if (d.type === "theme") {
      applyTheme(d)
      emit("theme", { dark: theme.dark, scheme: theme.scheme })
    } else if (d.type === "change") emit("change", d.paths)
  })
}

// ---------- what the app asks ----------

/** An artifact's name, icon and tint for the file tree and the sidebar: <title>, <meta name="vaultite:icon"> and
 *  <meta name="vaultite:tint">. Read once per version of the file. */
const looked = new Map<string, { mtime: number; out: Item }>()
export function looks(vault: Vault, rel: string, mtime: number): Item {
  const hit = looked.get(rel)
  if (hit && hit.mtime === mtime) return hit.out
  const out: Item = {}
  if (ARTIFACT.test(rel)) {
    let head = ""
    try {
      const fd = fs.openSync(vault.abs(rel), "r")
      const buf = Buffer.alloc(16384)
      head = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString("utf8")
      fs.closeSync(fd)
    } catch { /* unreadable: no looks */ }
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1].trim()
    if (title) out.title = decodeEntities(title)
    for (const k of ["icon", "tint"]) {
      const m = new RegExp(`<meta\\s+name=["']vaultite:${k}["']\\s+content=["']([^"']+)["']`, "i").exec(head)
        ?? new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+name=["']vaultite:${k}["']`, "i").exec(head)
      if (m) out[k] = m[1]
    }
  }
  looked.set(rel, { mtime, out })
  return out
}

const decodeEntities = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")

/** An artifact as text, for /api/render: its title, the words it shows before it runs, and the vault files it reads. */
export function artifactText(vault: Vault, rel: string, html = readText(vault.abs(rel))) {
  const reads = new Set<string>()
  const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : ""
  for (const m of html.matchAll(/\b(?:vau\.(?:read|json|csv|rows)|fetch)\(\s*["'`]([^"'`$]+)["'`]/g)) {
    if (/^[a-z]+:|^\/\//i.test(m[1])) continue
    reads.add(m[1].startsWith("/") ? m[1].slice(1) : path.posix.normalize(folder + m[1]))
  }
  const words = decodeEntities(html
    .replace(/<(head|script|style|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/header)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n")
  const title = looks(vault, rel, -1).title
  const out = [`_Interactive page (${rel}), drawn by its own code${title ? `: ${title}` : ""}._`]
  if (reads.size) out.push(`Reads: ${[...reads].map((r) => `\`${r}\``).join(", ")}.`)
  if (words) out.push(words)
  return out.join("\n\n")
}

/** POST /api/artifact/stat {paths}: each one's mtime (as /api/file has it), or null when it's missing or hidden. */
export function stat(vault: Vault, body: Item) {
  const paths = Array.isArray(body.paths) ? body.paths.map(String).slice(0, 200) : []
  return Object.fromEntries(paths.map((p: string) => {
    try {
      if (p.split("/").some((s) => s.startsWith(".") || s === "..")) return [p, null]
      return [p, Number(fs.statSync(vault.abs(p), { bigint: true }).mtimeNs / 1000000n)]
    } catch {
      return [p, null]
    }
  }))
}

/** PUT /api/artifact/state {path, data}: what an artifact keeps in localStorage, written only when it changed. */
export function saveState(vault: Vault, body: Item) {
  const rel = String(body.path ?? "")
  if (!ARTIFACT.test(rel) || rel.split("/").some((s) => s.startsWith(".") || s === "..") || !fs.existsSync(vault.abs(rel))) {
    throw new HTTPError(400, `not an artifact in the vault: '${rel}'`)
  }
  const data = body.data
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HTTPError(400, "data must be an object of strings")
  const text = JSON.stringify(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])), null, 2) + "\n"
  const file = vault.abs(statePath(rel))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let cur: string | null = null
  try { cur = readText(file) } catch { /* new */ }
  if (cur !== text) writeAtomic(file, text)
  return { ok: true }
}

/** When an artifact moves, its storage follows (trashed, it keeps it: restoring brings it back). */
export function moved(vault: Vault, from: string, to: string | null) {
  const pairs: [string, string | null][] = []
  const base = vault.abs(".vaultite/artifacts")
  const src = vault.abs(statePath(from))
  if (fs.existsSync(src)) pairs.push([src, to ? vault.abs(statePath(to)) : null])
  const dir = path.join(base, from) // a folder that held artifacts
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) pairs.push([dir, to ? path.join(base, to) : null])
  for (const [a, b] of pairs) {
    if (!b) continue
    fs.mkdirSync(path.dirname(b), { recursive: true })
    fs.renameSync(a, b)
  }
}
