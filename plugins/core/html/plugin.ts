// HTML pages' server side: pages served sandboxed at /v/ and CDN files at /cdn/ (plugin.serve, so nothing runs while
// it's off), plus `text:html` and `looks:html`. An artifact is framed by a wrapper (frame=1 asks for the page itself).
import crypto from "node:crypto"
import fs from "node:fs"
import { contentType, HTTPError, isOutside, type Machine, machineSocket, OpError, outsidePath, pipeSockets, Plugin, reply, Text, vaultPath } from "../../../core/plugins.ts"
import type { Item, Vault } from "../../../core/vault.ts"
import { ARTIFACT, artifactText, cdn, CSP, looks, moved, page, saveState, stat, WRAP_CSP, wrapper } from "./artifacts.ts"
import { artifactIn, dataOf, movedData, publish, sampleGrant, sampleSocket, saveData, versionOf } from "./claude.ts"
import { sharedPages } from "./shared.ts"
import type { RawData, WebSocket } from "ws"

export const plugin = new Plugin(import.meta.url)

const obj = (body: unknown) => (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Item

plugin.serve("v", (req) => {
  const vault = plugin.vault
  const headers = { "Content-Security-Policy": CSP, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }
  if (ARTIFACT.test(req.arg(0)) && req.query.frame !== "1") {
    // (what the page would refuse, the wrapper refuses too)
    if (!isOutside(req.arg(0))) vaultPath(req.arg(0), true, vault)
    else try { outsidePath(req.arg(0)) } catch { throw new HTTPError(404, "not found") }
    return new Text(wrapper(req.rawPath, req.query.theme === "dark"), "text/html; charset=utf-8", { ...headers, "Content-Security-Policy": WRAP_CSP })
  }
  // A page from outside the vault, one the desktop app allowed (only the .html itself: nothing next to it).
  if (isOutside(req.arg(0))) {
    const abs = outsidePath(req.arg(0))
    if (!ARTIFACT.test(abs)) throw new HTTPError(404, "not found")
    try {
      return new Text(page(vault, abs, req.query, { outside: true }), "text/html; charset=utf-8", headers)
    } catch {
      throw new HTTPError(404, "not found")
    }
  }
  const rel = vaultPath(req.arg(0), true, vault)
  try {
    if (ARTIFACT.test(rel)) return new Text(page(vault, rel, req.query, runtimeOf(rel)), "text/html; charset=utf-8", headers)
    return new Text(fs.readFileSync(vault.abs(rel)), contentType(rel), headers)
  } catch {
    throw new HTTPError(404, "not found")
  }
})

// Anyone may read these (they're public files), which fonts and modules loaded from a sandboxed artifact need.
plugin.serve("cdn", async (req) => {
  const q = req.rawPath.indexOf("?")
  const [where, search] = q < 0 ? [req.rawPath, ""] : [req.rawPath.slice(0, q), req.rawPath.slice(q)]
  const [host, ...rest] = where.split("/")
  const out = await cdn(host, rest.join("/") + search)
  return reply(out.status, new Text(out.body, out.type, {
    "Access-Control-Allow-Origin": "*", "Cache-Control": out.status === 200 ? "public, max-age=86400" : "no-cache",
    // (a package's HTML or SVG opened as a page would run on the app's origin: sandboxed, it has none)
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
  }))
})

/** The user's name, as ME.md has it ("" when it doesn't). */
function ownerName() {
  try {
    const me = plugin.service("me:file") as (() => string) | null
    const fm = me ? plugin.vault.entries.get(me())?.fm : null
    return fm && typeof fm.name === "string" ? fm.name : ""
  } catch { return "" }
}

/** What a claude.ai artifact's runtime starts with: its data, version, whether it may ask Claude, the user's name. */
function runtimeOf(rel: string) {
  return { data: dataOf(plugin.vault, rel), version: versionOf(plugin.vault, rel), name: ownerName(),
    sample: typeof plugin.service("sample") === "function", sampleAllowed: plugin.allows(sampleGrant(rel)) }
}

/** A page as a shared folder's guest gets it (plugins/core/share), at their path for it, nothing of the user's (name,
 *  Claude, what it kept), and the wrapper framing it: the guest's gateway serves both, with its own policies. */
plugin.provide("html:guest", (rel: string, shown: string, query: Record<string, string>) => ({
  page: page(plugin.vault, rel, query, { guest: true, version: versionOf(plugin.vault, rel), shown }),
  wrapper: (rawPath: string) => wrapper(rawPath, query.theme === "dark"),
}))

plugin.route("POST", "artifact/data", (req) => saveData(plugin.vault, obj(req.body)))
plugin.route("POST", "artifact/publish", (req) => publish(plugin.vault, obj(req.body)))
// The owner's yes to a page asking Claude (its first call asks, in the app).
plugin.route("POST", "artifact/allow", async (req) => {
  await plugin.ownerOnly(req, "Asking Claude")
  plugin.allow(sampleGrant(artifactIn(plugin.vault, obj(req.body).path)))
  return { ok: true }
})
plugin.socket("artifact/sample", (ws) => sampleSocket(plugin, ws), {
  accept: async (req) => {
    const why = await plugin.refusal(req, "Asking Claude")
    if (why) throw new HTTPError(403, why)
  },
})

// Shared state (vau.shared()): a socket per view of a page; the user's devices are one person each.
export const shared = sharedPages(() => plugin.vault)
plugin.onUnload(() => shared.flush())
const DEVICES: [RegExp, string][] = [[/iPhone/, "iPhone"], [/iPad/, "iPad"], [/Android/, "Android"], [/Macintosh/, "Mac"], [/Windows/, "Windows"], [/Linux|CrOS/, "Linux"]]
const deviceOf = (ua: string) => DEVICES.find(([re]) => re.test(ua))?.[1]
/** A shared folder's guest joins a page's shared state (plugins/core/share's gateway: the page in their folder, as them). */
plugin.provide("html:shared", (ws: WebSocket, rel: string, v: { shown: string; id: string; name: string; ua: string; watch?: string }) =>
  shared.join(ws, artifactIn(plugin.vault, rel), { shown: v.shown, person: { id: v.id, name: v.name, device: deviceOf(v.ua) }, watch: v.watch }))
type Host = { m: Machine; folders: string[] }
const inside = (rel: string, folder: string) => rel.startsWith(`${folder}/`)
/** The machine whose rooms a page's shared state is in: another of the vault's that shares its folder (its guests are
 *  there), unless this one shares it too. */
async function hostOf(rel: string) {
  if (((plugin.service("share:folders")?.() ?? []) as string[]).some((f) => inside(rel, f))) return null
  return (await plugin.ask<Host[]>("share:hosts", [])).find((h) => (down.get(h.m.id) ?? 0) < Date.now() && h.folders.some((f) => inside(rel, f)))?.m ?? null
}
const down = new Map<string, number>()
plugin.socket("artifact/shared", (ws, req, { query }) => {
  const rel = artifactIn(plugin.vault, query.path), ua = String(req.headers["user-agent"] ?? query.ua ?? "")
  const id = /^[a-z0-9]{8,32}$/.test(query.device ?? "") ? query.device : `w${crypto.randomUUID().slice(0, 8)}`
  const here = () => shared.join(ws, rel, { shown: rel, person: { id, name: ownerName() || "Owner", device: deviceOf(ua) } })
  // (another machine's view, here: never sent on again)
  if (String(req.headers["x-vaultite-client"] ?? "").startsWith("machine/")) return here()
  const early: RawData[] = [], hold = (d: RawData) => void early.push(d)
  ws.on("message", hold)
  void hostOf(rel).then((m) => {
    ws.off("message", hold)
    if (ws.readyState !== ws.OPEN) return
    if (!m) here()
    else pipeSockets(ws, machineSocket(m, "artifact/shared", { path: rel, device: id, ua }, { handshakeTimeout: 8000 }), () => {
      down.set(m.id, Date.now() + 15_000)
      ws.close(1011, "unreachable")
    })
    for (const d of early) ws.emit("message", d, false)
  })
}, { accept: (_req, { query }) => void artifactIn(plugin.vault, query.path) })

// A page in a shared folder (here or on another machine): the folder its views may read in, since its guests set
// what the page does. The innermost, when folders in folders are shared.
plugin.route("GET", "artifact/scope", async (req) => {
  const rel = artifactIn(plugin.vault, req.query.path)
  const folders = [...(plugin.service("share:folders")?.() ?? []) as string[], ...(await plugin.ask<Host[]>("share:hosts", [])).flatMap((h) => h.folders)]
  return { folder: folders.filter((f) => inside(rel, f)).sort((a, b) => b.length - a.length)[0] ?? null }
}, { lock: false, sync: false })

/** An op's page: an artifact in the vault, else an OpError. */
const pageOf = (p: unknown) => { try { return artifactIn(plugin.vault, p) } catch (e) { throw new OpError((e as Error).message) } }
const pageParam = { type: "string", format: "path", required: true, description: "the page (.html), a vault path" } as const
plugin.op({
  id: "html.shared",
  cli: "html shared",
  summary: "A page's shared state (what vau.shared() keeps, the same for everyone who has it open) and who has it open now.",
  help: "  vau html shared \"Music/Duel.html\"",
  kind: "read",
  params: { path: pageParam },
  args: ["path"],
  run: ({ path }) => shared.read(pageOf(path)),
})
plugin.op({
  id: "html.shared-set",
  cli: "html shared-set",
  summary: "Set keys of a page's shared state (null deletes one): everyone who has it open sees them at once.",
  help: "  vau html shared-set \"Music/Duel.html\" --values '{\"round\": 1}'",
  kind: "write",
  params: { path: pageParam, values: { type: "object", required: true, description: "the keys to set, each to a JSON value (null deletes it)" } },
  args: ["path"],
  run: ({ path, values }, ctx) => {
    const rel = pageOf(path)
    try { return { state: shared.set(rel, values, ctx.who.label) } } catch (e) { throw new OpError((e as Error).message) }
  },
})

plugin.route("POST", "artifact/stat", (req) => stat(plugin.vault, obj(req.body)))
plugin.route("PUT", "artifact/state", (req) => saveState(plugin.vault, obj(req.body)))

for (const ext of ["html", "htm"]) {
  plugin.provide(`text:${ext}`, (text: string, rel: string) => artifactText(plugin.vault, rel, text))
  plugin.provide(`looks:${ext}`, (vault: Vault, rel: string, mtime: number) => looks(vault, rel, mtime))
}

plugin.onMove((from, to) => {
  movedData(plugin.vault, from, to)
  shared.moved(from, to)
  moved(plugin.vault, from, to)
  if (to && plugin.allows(sampleGrant(from))) plugin.allow(sampleGrant(to))
})
