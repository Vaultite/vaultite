// The browser's tabs for their owner, watched live (electron/browser/live.ts), tapped and typed in, agents paused, an ask
// done; `3@m1` is another machine's, asked there. Owner only, and routes, never ops: no agent drives a page this way.
import type { IncomingMessage } from "node:http"
import type { RawData, WebSocket } from "ws"
import { HTTPError, inDesktop, machineSocket, pipeSockets, splitMachine, type Machine, type Plugin } from "../../../core/plugins.ts"
import { askThere, machineOf, otherBrowsers } from "./machinecalls.ts"
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
  /** "3" or "3@m1": the tab, and the other machine whose browser has it (null: this server's, its own id too). */
  const tabOf = async (raw: string): Promise<[number, Machine | null]> => {
    const [n, id] = splitMachine(raw)
    if (!/^\d+$/.test(n) || !Number(n)) throw new HTTPError(400, "a tab is its number")
    return [Number(n), await machineOf(plugin, id)]
  }

  // This server's browser's tabs and the other machines' (each named); `local`: only its own, what another machine asks.
  plugin.route("GET", "web-viewer/tabs", async (req) => {
    await plugin.ownerOnly(req, what)
    const { self, others } = await otherBrowsers(plugin)
    const own = (tabs: LiveTab[]) => tabs.map((t) => ({ ...t, ...(self ? { machine: self.id, machineLabel: self.label } : {}) }))
    if (req.query.local) return { tabs: inDesktop() ? own(await desktop<LiveTab[]>("agent:live:tabs")) : [] }
    const theirs = await Promise.all(others.map((m) => askThere<{ tabs: LiveTab[] }>(m, "GET", "web-viewer/tabs?local=1", undefined, 4000)
      .then((r) => r.tabs.map((t) => ({ ...t, machine: m.id, machineLabel: m.label, appTab: "" })), () => [])))
    // (with no browser of its own and no other machine's, plugin.desktop's: an always-on machine's, or why there's none)
    const mine = inDesktop() || !others.length ? own(await desktop<LiveTab[]>("agent:live:tabs")) : []
    return { tabs: [...mine, ...theirs.flat()], self: self?.id ?? null }
  }, { lock: false, sync: false })

  plugin.route("POST", "web-viewer/tabs/*/pause", async (req) => {
    await plugin.ownerOnly(req, what)
    const [tab, m] = await tabOf(req.arg(0))
    if (m) return askThere(m, "POST", `web-viewer/tabs/${tab}/pause`, { on: req.body?.on !== false })
    return desktop("agent:live:pause", tab, req.body?.on !== false)
  }, { lock: false, sync: false })

  plugin.route("POST", "web-viewer/tabs/*/done", async (req) => {
    await plugin.ownerOnly(req, what)
    const [tab, m] = await tabOf(req.arg(0))
    if (m) return askThere(m, "POST", `web-viewer/tabs/${tab}/done`, {})
    const r = await desktop("agent:live:done", tab)
    await plugin.ask("inbox:drop", null, "browser", `help-${tab}`)
    return r
  }, { lock: false, sync: false })

  // What agents did in the tab since it opened: Activity's events of the browser's ops that name it.
  plugin.route("GET", "web-viewer/tabs/*/steps", async (req) => {
    await plugin.ownerOnly(req, what)
    const [tab, m] = await tabOf(req.arg(0))
    const since = Number(req.query.since) || Date.now() - 86400_000
    if (m) return askThere(m, "GET", `web-viewer/tabs/${tab}/steps?since=${since}`)
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
    const [tab, m] = await tabOf(wild[0]).catch(() => [0, null] as const)
    // (another machine's: joined to its same socket, which sends the frames and takes the input)
    if (m) {
      return pipeSockets(ws, machineSocket(m, `web-viewer/live/${tab}`), () => {
        json(ws, { t: "error", text: `${m.label} doesn't answer` })
        ws.close(1011, "unreachable")
      })
    }
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
      const [, m] = await tabOf(wild[0] ?? "")
      if (!m && !inDesktop()) throw new HTTPError(409, "the live view needs this vault's server to be the desktop app's")
    },
  })

  plugin.onUnload(() => {
    if (renew) clearInterval(renew)
    for (const [tab, set] of watchers) { for (const ws of set) ws.close(1001, "unloaded"); void desktop("agent:live:unwatch", tab).catch(() => {}) }
    watchers.clear()
  })
}
