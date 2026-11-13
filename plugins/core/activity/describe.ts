import { LOADED, type RequestEnd } from "../../../core/plugins.ts"
import type { Action } from "./model.ts"
import { plugin, settings } from "./store.ts"

type Did = { action: Action; text: string; paths: string[]; by?: string } | null
export const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "")
export const strip = (p: string) => p.replace(/\.md$/, "")
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

export function failed(method: string, route: string, end: RequestEnd): Did {
  const what = route.startsWith("ops/") ? route.slice(4) : `${method} /api/${route}`
  return { action: "failed", text: `${what} failed: ${(end.error || `status ${end.status}`).slice(0, 200)}`, paths: [] }
}

export function describe(method: string, route: string, query: Record<string, string>, body: unknown, byApp: boolean): Did {
  const parts = route.split("/")
  const b = isObj(body) ? body : {}
  const p = str(b.path) || str(query.path)
  if (parts[0] === "activity" || parts[0] === "events" || parts[0] === "mcp") return null
  if (parts[0] === "ops" && parts[1] && method === "POST") return describeOp(parts[1], b, byApp)
  if (method === "GET" || method === "HEAD") {
    if (byApp || !settings().reads) return null
    if (route === "render") return { action: "read", text: p ? `Read ${p} as text` : "Read a page as text", paths: p ? [p] : [] }
    if (route === "file") return { action: "read", text: `Read ${p || "a file"}`, paths: p ? [p] : [] }
    if (route === "raw") return { action: "read", text: `Downloaded ${p || "a file"}`, paths: p ? [p] : [] }
    if (route === "search") return { action: "search", text: `Searched for "${(query.q ?? "").slice(0, 80)}"`, paths: [] }
    if (route === "state") return { action: "read", text: "Read everything the app shows (state)", paths: [] }
    if (route === "ui") return null
    return { action: "read", text: `Read /api/${route}${p ? ` for ${p}` : ""}`, paths: p ? [p] : [] }
  }
  if (route === "artifact/state") return null
  if (route === "history/keep") return null
  if (route === "file") {
    if (method === "PUT") return { action: "edit", text: `Edited ${p}`, paths: p ? [p] : [] }
    if (method === "POST") return { action: "create", text: `Created ${p}`, paths: p ? [p] : [] }
    if (method === "DELETE") return { action: "delete", text: `Deleted ${p}`, paths: p ? [p] : [] }
  }
  if (route === "file/move") { const f = str(b.from), t = str(b.to); return { action: "move", text: `Moved ${f} to ${t}`, paths: [f, t].filter(Boolean) } }
  if (route === "file/restore") return { action: "create", text: `Restored ${p} from the trash`, paths: p ? [p] : [] }
  if (route === "file/copy") return { action: "create", text: `Duplicated ${p}`, paths: p ? [p] : [] }
  if (route === "file/open") return { action: "ui", text: `${b.reveal ? "Showed" : "Opened"} ${p} in ${b.reveal ? (process.platform === "darwin" ? "Finder" : process.platform === "win32" ? "Explorer" : "its folder") : "its app"}`, paths: p ? [p] : [] }
  if (route === "folder") return { action: "create", text: `Made the folder ${p}`, paths: p ? [p] : [] }
  if (route === "upload") return { action: "create", text: `Added ${p}`, paths: p ? [p] : [] }
  if (route === "upload/name") return null
  if (route === "pins") return { action: "pin", text: `${b.pinned === false ? "Unpinned" : "Pinned"} ${p}`, paths: p ? [p] : [] }
  if (parts[0] === "config" && parts[1]) {
    const keys = Object.keys(b)
    const what: Record<string, string> = { plugins: "plugins and the sidebar", appearance: "the appearance", files: "the file tree's settings", pages: "the pinned pages", hotkeys: "hotkeys" }
    return { action: "settings", text: `Changed ${what[parts[1]] ?? parts[1]}${keys.length ? ` (${keys.slice(0, 4).join(", ")})` : ""}`, paths: [`.vaultite/${parts[1]}.json`] }
  }
  if (route === "ui") {
    const a = str(b.action)
    if (a === "open") return { action: "ui", text: `Opened ${str(b.path)} in the app`, paths: str(b.path) && !str(b.path).startsWith("view:") ? [str(b.path)] : [] }
    if (a === "command") return { action: "ui", text: `Ran the command ${str(b.id)} in the app`, paths: [] }
    if (a === "notify") return { action: "ui", text: `Showed "${str(b.text).slice(0, 80)}"`, paths: [] }
    return null
  }
  if (parts[0] === "workspaces") {
    if (parts[1] === "move") return { action: "move", text: "Moved tabs between workspaces", paths: [] }
    return { action: "settings", text: parts[1] ? `Changed workspace ${parts[1]}` : "Changed the workspaces", paths: [] }
  }
  if (route === "clip") return { action: "create", text: `Clipped ${str(b.url).slice(0, 120) || "a web page"}`, paths: [] }
  if (route === "interactions") return { action: "save", text: `Added to ${str(b.person)}'s timeline${str(b.kind) ? ` (${str(b.kind)})` : ""}`, paths: [] }
  if (route === "calendar/refresh") return { action: "request", text: "Refreshed the calendar", paths: [] }
  if (plugin.vault.has(parts[0])) {
    const kind = plugin.vault.kind(parts[0]).type
    const items = Array.isArray(body) ? body.filter(isObj) : [b]
    const name = (x: Record<string, unknown>) => str(x.title) || str(x.name) || str(x.ext_id)
    const ref = parts.slice(1).join("/")
    const names = items.map(name).filter(Boolean)
    const who = names.length > 1 ? `${names.length} ${kind}s` : names[0] || strip(ref) || `a ${kind}`
    if (method === "DELETE") return { action: "delete", text: `Deleted the ${kind} ${strip(ref)}`, paths: [] }
    if (method === "PUT") return { action: "save", text: `Changed the ${kind} ${who}`, paths: [] }
    return { action: "save", text: `${kind === "log" ? "Logged" : "Saved"} ${kind === "log" ? who : `the ${kind} ${who}`}`, paths: [] }
  }
  return { action: "request", text: `${method} /api/${route}${p ? ` for ${p}` : ""}`, paths: p ? [p] : [] }
}

export function opKind(id: string): "read" | "write" | "destructive" | null {
  for (const p of LOADED) for (const o of p.ops) if (o.id === id) return o.kind
  if (/^(ops|docs)\./.test(id) || id === "ui.windows") return "read"
  if (id.startsWith("ui.")) return "write"
  return null
}

function describeOp(id: string, b: Record<string, unknown>, byApp: boolean): Did {
  const kind = opKind(id)
  if (kind === "read") {
    if (byApp || !settings().reads) return null
    const p = str(b.path)
    if (id === "docs.read") return { action: "read", text: `Read the docs${str(b.topic) ? ` on ${str(b.topic)}` : ""}`, paths: [] }
    return { action: "read", text: `Read ${id}${p ? ` for ${p}` : ""}`, paths: p ? [p] : [] }
  }
  const own = plugin.host.did(id, b)
  if (own) return { action: own.action ?? (kind === "destructive" ? "delete" : "request"), text: own.text, paths: own.paths ?? [], ...(own.by ? { by: own.by } : {}) }
  const p = str(b.path)
  const about = str(b.path) || str(b.title) || str(b.name) || str(b.person) || str(b.url) || str(b.id) || str(b.key)
  return { action: kind === "destructive" ? "delete" : "request", text: `Ran ${id}${about ? ` (${about.slice(0, 100)})` : ""}`, paths: p ? [p] : [] }
}
