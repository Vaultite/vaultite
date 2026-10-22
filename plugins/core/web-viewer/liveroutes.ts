// The browser's tabs for their owner in the web app (no Electron there): watched live (electron/browser/live.ts), tapped
// and typed in, agents paused, an ask done. Owner only, and routes, never ops: no agent drives a page this way.
import type { IncomingMessage } from "node:http"
import type { RawData, WebSocket } from "ws"
import { HTTPError, inDesktop, type Plugin, type Request } from "../../../core/plugins.ts"
import type { LiveStep, LiveTab } from "./livetabs.ts"

const RENEW_MS = 10_000
/** A watcher behind on frames (a slow phone) skips them rather than queueing. */
const BEHIND = 1 << 20
const STEP = /\bbrowser tab (\d+)\b/

export function liveView(plugin: Plugin) {
  const what = "The browser's live view"
  const desktop = async <T>(name: string, ...args: unknown[]) => {
    try { return (await plugin.desktop(name, ...args)) as T } catch (e) { throw new HTTPError(409, (e as Error).message) }
  }
  const tabOf = (req: Request) => {
    const n = Number(req.arg(0))
    if (!Number.isInteger(n) || n <= 0) throw new HTTPError(400, "a tab is its number")
    return n
  }

  plugin.route("GET", "web-viewer/tabs", async (req) => {
    await plugin.ownerOnly(req, what)
    return { tabs: await desktop<LiveTab[]>("agent:live:tabs") }
  }, { lock: false, sync: false })

  plugin.route("POST", "web-viewer/tabs/*/pause", async (req) => {
    await plugin.ownerOnly(req, what)
    return desktop("agent:live:pause", tabOf(req), req.body?.on !== false)
  }, { lock: false, sync: false })

  plugin.route("POST", "web-viewer/tabs/*/done", async (req) => {
    await plugin.ownerOnly(req, what)
    const tab = tabOf(req)
    const r = await desktop("agent:live:done", tab)
    await plugin.ask("inbox:drop", null, "browser", `help-${tab}`)
    return r
  }, { lock: false, sync: false })

  // What agents did in the tab since it opened: Activity's events of the browser's ops that name it.
  plugin.route("GET", "web-viewer/tabs/*/steps", async (req) => {
    await plugin.ownerOnly(req, what)
    const tab = tabOf(req), since = Number(req.query.since) || Date.now() - 86400_000
    if (plugin.vault.switchedOff().has("activity")) return { steps: [], kept: false }
    type Event = { t: number; last?: number; actor: { kind: string; name: string }; action: string; text: string; route?: string }
    const got = await plugin.host.api("GET", `activity?since=${since}&limit=500`).catch(() => null) as { events?: Event[] } | null
    const steps: LiveStep[] = (got?.events ?? []).filter((e) => e.route?.startsWith("ops/web-viewer.") && Number(STEP.exec(e.text)?.[1]) === tab)
      .slice(0, 100).map((e) => ({ t: e.last ?? e.t, by: e.actor.name, text: e.text.replace(/ in browser tab \d+/, ""), failed: e.action === "failed" }))
    return { steps, kept: true }
  }, { lock: false, sync: false })

  // ---------- watching: a socket per viewer, the engine's frames to each, their input back ----------

  const watchers = new Map<number, Set<WebSocket>>()
  let renew: ReturnType<typeof setInterval> | null = null
  const each = (tab: number, fn: (ws: WebSocket) => void) => { for (const ws of watchers.get(tab) ?? []) if (ws.readyState === ws.OPEN) fn(ws) }
  const json = (ws: WebSocket, m: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }

  plugin.onDesktopEvent((name, data) => {
    const d = (data ?? {}) as { tab?: number; jpeg?: string }
    if (typeof d.tab !== "number" || !watchers.has(d.tab)) return
    if (name === "live:frame" && typeof d.jpeg === "string") {
      const frame = Buffer.from(d.jpeg, "base64")
      each(d.tab, (ws) => { if (ws.bufferedAmount < BEHIND) ws.send(frame) })
    } else if (name === "live:state") each(d.tab, (ws) => json(ws, { t: "state", ...d }))
    else if (name === "live:gone") each(d.tab, (ws) => { json(ws, { t: "gone" }); ws.close(1000, "closed") })
  })

  async function watch(tab: number, ws: WebSocket) {
    const r = await desktop<LiveTab & { frame: string }>("agent:live:watch", tab)
    const { frame, ...state } = r
    json(ws, { t: "state", ...state })
    if (frame && ws.readyState === ws.OPEN) ws.send(Buffer.from(frame, "base64"))
  }
  function leave(tab: number, ws: WebSocket) {
    const set = watchers.get(tab)
    if (!set?.delete(ws) || set.size) return
    watchers.delete(tab)
    void desktop("agent:live:unwatch", tab).catch(() => {})
    if (!watchers.size && renew) { clearInterval(renew); renew = null }
  }

  plugin.socket("web-viewer/live/*", async (ws, _req, { wild }) => {
    const tab = Number(wild[0])
    watchers.set(tab, (watchers.get(tab) ?? new Set()).add(ws))
    renew ??= setInterval(() => { for (const t of watchers.keys()) void desktop("agent:live:watch", t).catch(() => {}) }, RENEW_MS)
    ws.on("close", () => leave(tab, ws))
    ws.on("message", (raw: RawData) => {
      let m: { t?: unknown }
      try { m = JSON.parse(String(raw)) } catch { return }
      if (m?.t === "input") void desktop("agent:live:input", tab, m).catch((e) => json(ws, { t: "error", text: (e as Error).message }))
    })
    try { await watch(tab, ws) } catch (e) {
      json(ws, { t: "error", text: (e as Error).message, fatal: true })
      ws.close(4404, "unavailable")
    }
  }, {
    accept: async (req: IncomingMessage, { wild }) => {
      const why = await plugin.refusal(req, what)
      if (why) throw new HTTPError(403, why)
      if (!/^\d+$/.test(wild[0] ?? "")) throw new HTTPError(400, "a tab is its number")
      if (!inDesktop()) throw new HTTPError(409, "the live view needs this vault's server to be the desktop app's")
    },
  })

  plugin.onUnload(() => {
    if (renew) clearInterval(renew)
    for (const [tab, set] of watchers) { for (const ws of set) ws.close(1001, "unloaded"); void desktop("agent:live:unwatch", tab).catch(() => {}) }
    watchers.clear()
  })
}
