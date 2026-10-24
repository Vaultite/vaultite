// HTML pages' server side: pages served sandboxed at /v/ and CDN files at /cdn/ (plugin.serve, so nothing runs while
// it's off), plus `text:html` and `looks:html`. An artifact is framed by a wrapper (frame=1 asks for the page itself).
import fs from "node:fs"
import { contentType, HTTPError, isOutside, outsidePath, Plugin, reply, Text, vaultPath } from "../../../core/plugins.ts"
import type { Item, Vault } from "../../../core/vault.ts"
import { ARTIFACT, artifactText, cdn, CSP, looks, moved, page, saveState, stat, WRAP_CSP, wrapper } from "./artifacts.ts"
import { artifactIn, dataOf, movedData, publish, sampleGrant, sampleSocket, saveData, versionOf } from "./claude.ts"

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

/** What a claude.ai artifact's runtime starts with: its data, version, whether it may ask Claude, the user's name. */
function runtimeOf(rel: string) {
  let name = ""
  try {
    const me = plugin.service("me:file") as (() => string) | null
    const fm = me ? plugin.vault.entries.get(me())?.fm : null
    if (fm && typeof fm.name === "string") name = fm.name
  } catch { /* no name */ }
  return { data: dataOf(plugin.vault, rel), version: versionOf(plugin.vault, rel), name,
    sample: typeof plugin.service("sample") === "function", sampleAllowed: plugin.allows(sampleGrant(rel)) }
}

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

plugin.route("POST", "artifact/stat", (req) => stat(plugin.vault, obj(req.body)))
plugin.route("PUT", "artifact/state", (req) => saveState(plugin.vault, obj(req.body)))

for (const ext of ["html", "htm"]) {
  plugin.provide(`text:${ext}`, (text: string, rel: string) => artifactText(plugin.vault, rel, text))
  plugin.provide(`looks:${ext}`, (vault: Vault, rel: string, mtime: number) => looks(vault, rel, mtime))
}

plugin.onMove((from, to) => {
  movedData(plugin.vault, from, to)
  moved(plugin.vault, from, to)
  if (to && plugin.allows(sampleGrant(from))) plugin.allow(sampleGrant(to))
})
