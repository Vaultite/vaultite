// The one way the app talks to the server (/api/...): every request says which app sent it, and writes are tracked
// (core/live.ts), so the change they cause isn't taken for someone else's. Imports only live.ts: prefs and commands use it.
import { tracked } from "@/core/live"

/** A request whose JSON answer is the result; a write is tracked. */
export function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const p = send<T>(method, path, body)
  return method === "GET" ? p : tracked(p)
}
/** Which app this is, as the server hears it (X-Vaultite-Client: app/<device>, for Activity). */
export const appDevice = (window as { vaultite?: unknown }).vaultite ? "desktop" : matchMedia("(pointer: coarse) and (max-width: 820px)").matches ? "phone" : "web"
const CLIENT = `app/${appDevice}`
const headers = (body: unknown): HeadersInit => ({ "X-Vaultite-Client": CLIENT, ...(body ? { "Content-Type": "application/json" } : {}) })
/** The page is going away (a reload, a closed window): writes sent now are `keepalive`, so they still get out. */
let unloading = false
if (typeof addEventListener === "function") addEventListener("pagehide", () => { unloading = true })
/** How long a read may take: one left hanging (a phone waking on a dead connection) would hold every refresh after it. */
const READ_WAIT = 60_000
export async function send<T>(method: string, path: string, body?: unknown, cache?: RequestCache): Promise<T> {
  const text = body ? JSON.stringify(body) : undefined
  let r: Response
  try {
    r = await fetch(`api/${path}`, {
      method, cache, keepalive: unloading && method !== "GET" && (text?.length ?? 0) < 60_000,
      headers: headers(body), body: text, signal: method === "GET" ? AbortSignal.timeout?.(READ_WAIT) : undefined,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") throw new Error("The server didn't answer")
    throw e
  }
  // (an error page that isn't JSON, a proxy's while the server restarts: its status, not "Unexpected token '<'")
  const j = r.ok ? await r.json() : await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText || `Error ${r.status}`), { status: r.status })
  return j
}
export const get = <T,>(path: string) => api<T>("GET", path)
export const put = <T,>(path: string, body: unknown) => api<T>("PUT", path, body)
export const post = <T,>(path: string, body: unknown) => api<T>("POST", path, body)
export const patch = <T,>(path: string, body: unknown) => api<T>("PATCH", path, body)
export const del = <T,>(path: string) => api<T>("DELETE", path)
/** Run an operation of the API (core/ops.ts: `POST /api/ops/<id>`): its result. The same catalog agents use through
 *  vau and MCP, so a plugin's frontend reaches another plugin's features without knowing its routes. */
export const op = <T,>(id: string, params: Record<string, unknown> = {}) => api<T>("POST", `ops/${encodeURIComponent(id)}`, params)
/** A request whose answer the caller reads itself (a save's 409 carries the file as it is now), sent and tracked like
 *  get/put/post. `init` adds to it (`keepalive` for a save while the page goes away). */
export function request(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<Response> {
  const p = fetch(`api/${path}`, { ...init, method, headers: headers(body), body: body ? JSON.stringify(body) : undefined })
  return method === "GET" ? p : tracked(p)
}
