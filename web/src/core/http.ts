import { tracked } from "@/core/live"
import { isPhoneDevice } from "@/core/platform"
import { checkServer, untilUnreachable } from "@/core/connection"
import { errorIn, plainError } from "../../../core/plainerror.ts"

export function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const p = send<T>(method, path, body)
  return method === "GET" ? p : tracked(p)
}
/** Which app this is, as the server hears it (X-Vaultite-Client: app/<device>, for Activity). */
export const appDevice = window.vaultite ? "desktop" : isPhoneDevice() ? "phone" : "web"
const CLIENT = `app/${appDevice}`
const headers = (body: unknown): HeadersInit => ({ "X-Vaultite-Client": CLIENT, ...(body ? { "Content-Type": "application/json" } : {}) })
// A browser cancels requests made as the page goes away unless they're `keepalive`.
let unloading = false
if (typeof addEventListener === "function") addEventListener("pagehide", () => { unloading = true })
const READ_WAIT = 60_000
const early = window.__vauEarly ?? {}
const takeEarly = (path: string) => { const p = early[path]; delete early[path]; return p?.then((r) => (r.ok ? r : null), () => null) }
function readSignal(signal?: AbortSignal) {
  const wait = AbortSignal.timeout?.(READ_WAIT)
  return signal && wait ? AbortSignal.any?.([signal, wait]) ?? signal : signal ?? wait
}
export async function send<T>(method: string, path: string, body?: unknown, cache?: RequestCache, signal?: AbortSignal): Promise<T> {
  const text = body ? JSON.stringify(body) : undefined
  const write = method === "GET" ? null : untilUnreachable()
  let r: Response, j: T
  try {
    const got = method === "GET" && !cache ? await takeEarly(path) : null
    r = got ?? await fetch(`api/${path}`, {
      method, cache, keepalive: unloading && method !== "GET" && (text?.length ?? 0) < 60_000,
      headers: headers(body), body: text, signal: write?.signal ?? readSignal(signal),
    })
    j = r.ok ? await r.json() : await r.json().catch(() => ({}))
  } catch (e) {
    const thrown = write?.signal.aborted || (e instanceof DOMException && e.name === "TimeoutError") ? new Error("The server didn't answer") : e
    if (plainError(thrown).network) checkServer()
    throw thrown
  } finally {
    write?.end()
  }
  if (!r.ok) throw Object.assign(new Error(errorIn(j) || r.statusText || `Error ${r.status}`), { status: r.status })
  return j
}
export function upload(path: string, file: Blob): Promise<{ path: string }> {
  return tracked((async () => {
    const r = await fetch(`api/upload?path=${encodeURIComponent(path)}`, { method: "POST", headers: { "X-Vaultite-Client": CLIENT, "Content-Type": "application/octet-stream" }, body: file })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw Object.assign(new Error(errorIn(j) || r.statusText || `Error ${r.status}`), { status: r.status })
    return j
  })())
}
export const get = <T,>(path: string, signal?: AbortSignal) => send<T>("GET", path, undefined, undefined, signal)
export const put = <T,>(path: string, body: unknown) => api<T>("PUT", path, body)
export const post = <T,>(path: string, body: unknown) => api<T>("POST", path, body)
export const patch = <T,>(path: string, body: unknown) => api<T>("PATCH", path, body)
export const del = <T,>(path: string) => api<T>("DELETE", path)
/** Run an operation of the API (core/ops.ts: `POST /api/ops/<id>`): its result. The same catalog agents use through
 *  vau and MCP, so a plugin's frontend reaches another plugin's features without knowing its routes. */
export const op = <T,>(id: string, params: Record<string, unknown> = {}) => api<T>("POST", `ops/${encodeURIComponent(id)}`, params)
export function request(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<Response> {
  const p = fetch(`api/${path}`, { ...init, method, headers: headers(body), body: body ? JSON.stringify(body) : undefined })
  return method === "GET" ? p : tracked(p)
}
