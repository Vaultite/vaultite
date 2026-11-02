// Each page's main-frame load (status, server address, cache, a CDN's ray id) told to its window, whose trace keeps it for
// a bug report's timeline: a white page is told apart from the app's doing. No query, cookies or other headers.
import { allPages, onRequest, tell, type RequestDetails } from "./engine.ts"

const header = (d: RequestDetails, name: string) => {
  for (const [k, v] of Object.entries(d.responseHeaders ?? {})) if (k.toLowerCase() === name) return String(v[0] ?? "").slice(0, 100) || undefined
  return undefined
}
const where = (url: string) => {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? (u.host + u.pathname).slice(0, 200) : null } catch { return null }
}

function told(d: RequestDetails, error?: string) {
  const url = where(d.url), p = url ? allPages().find((x) => x.wc.id === d.webContentsId) : undefined
  if (!p || p.wc.isDestroyed()) return
  const tab = p.tab()
  tell(p.win, { type: "engine:navlog:load", page: p.id, ...(tab ? { tab } : {}), url,
    ...(error ? { error } : { status: d.statusCode }), ip: d.ip || undefined, cached: !!d.fromCache, ray: header(d, "cf-ray"), server: header(d, "server") })
}
onRequest("onCompleted", (d) => told(d), undefined, ["mainFrame"])
onRequest("onErrorOccurred", (d) => { if (d.error !== "net::ERR_ABORTED") told(d, d.error) }, undefined, ["mainFrame"])
