import type { IncomingMessage } from "node:http"
import type { RawData, WebSocket } from "ws"
import { z } from "zod"
import { HTTPError, inDesktop, machineSocket, pipeSockets, splitMachine, type Machine, type Plugin } from "../../../core/plugins.ts"
import { askThere, desktopOf, JSON_ANSWER, machineOf, otherBrowsers } from "./machinecalls.ts"
import type { LiveStep, LiveTab } from "./livetabs.ts"

const RENEW_MS = 10_000
const BEHIND = 1 << 20
const STEP = /\bbrowser tab (\d+)\b/
const THEIR_TABS = z.object({ tabs: z.array(z.looseObject({})) })
const EVENTS = z.object({ events: z.array(z.object({ t: z.number(), last: z.number().optional(), actor: z.object({ name: z.string() }),
  action: z.string(), text: z.string(), route: z.string().optional() })) })
const FRAME = z.looseObject({ tab: z.number(), jpeg: z.string().optional() })
const SAID = z.discriminatedUnion("t", [z.looseObject({ t: z.literal("input") }), z.object({ t: z.literal("sharp"), on: z.unknown() })])

export function liveView(plugin: Plugin) {
  const what = "The browser's live view"
  const desktop = desktopOf(plugin)
  const tabOf = async (raw: string): Promise<[number, Machine | null]> => {
    const [n, id] = splitMachine(raw)
    if (!/^\d+$/.test(n) || !Number(n)) throw new HTTPError(400, "a tab is its number")
    return [Number(n), await machineOf(plugin, id)]
  }

  plugin.route("GET", "web-viewer/tabs", async (req) => {
    await plugin.ownerOnly(req, what)
    const { self, others } = await otherBrowsers(plugin)
    const own = (tabs: LiveTab[]) => tabs.map((t) => ({ ...t, ...(self ? { machine: self.id, machineLabel: self.label } : {}) }))
    if (req.query.local) return { tabs: inDesktop() ? own(await desktop<LiveTab[]>("agent:live:tabs")) : [] }
    const theirs = await Promise.all(others.map((m) => askThere(m, "GET", "web-viewer/tabs?local=1", THEIR_TABS, undefined, 4000)
      .then((r) => r.tabs.map((t) => ({ ...t, machine: m.id, machineLabel: m.label, appTab: "" })), () => [])))
    const mine = inDesktop() || !others.length ? own(await desktop<LiveTab[]>("agent:live:tabs")) : []
    return { tabs: [...mine, ...theirs.flat()], self: self?.id ?? null }
  }, { lock: false, sync: false })

  plugin.route("POST", "web-viewer/tabs/*/pause", async (req) => {
    await plugin.ownerOnly(req, what)
    const [tab, m] = await tabOf(req.arg(0))
    if (m) return askThere(m, "POST", `web-viewer/tabs/${tab}/pause`, JSON_ANSWER, { on: req.body?.on !== false })
    return desktop("agent:live:pause", tab, req.body?.on !== false)
  }, { lock: false, sync: false })

  plugin.route("POST", "web-viewer/tabs/*/done", async (req) => {
    await plugin.ownerOnly(req, what)
    const [tab, m] = await tabOf(req.arg(0))
    if (m) return askThere(m, "POST", `web-viewer/tabs/${tab}/done`, JSON_ANSWER, {})
    const r = await desktop("agent:live:done", tab)
    await plugin.ask("inbox:drop", null, "browser", `help-${tab}`)
    return r
  }, { lock: false, sync: false })

  plugin.route("GET", "web-viewer/tabs/*/selection", async (req) => {
    await plugin.ownerOnly(req, what)
    const [tab, m] = await tabOf(req.arg(0))
    if (m) return askThere(m, "GET", `web-viewer/tabs/${tab}/selection`, JSON_ANSWER)
    return desktop<{ text: string }>("agent:live:selection", tab)
  }, { lock: false, sync: false })

  plugin.route("GET", "web-viewer/tabs/*/steps", async (req) => {
    await plugin.ownerOnly(req, what)
    const [tab, m] = await tabOf(req.arg(0))
    const since = Number(req.query.since) || Date.now() - 86400_000
    if (m) return askThere(m, "GET", `web-viewer/tabs/${tab}/steps?since=${since}`, JSON_ANSWER)
    if (plugin.vault.switchedOff().has("activity")) return { steps: [], kept: false }
    const got = EVENTS.safeParse(await plugin.host.api("GET", `activity?since=${since}&limit=500`).catch(() => null))
    const steps: LiveStep[] = (got.data?.events ?? []).filter((e) => e.route?.startsWith("ops/web-viewer.") && Number(STEP.exec(e.text)?.[1]) === tab)
      .slice(0, 100).map((e) => ({ t: e.last ?? e.t, by: e.actor.name, text: e.text.replace(/ in browser tab \d+/, ""), failed: e.action === "failed" }))
    return { steps, kept: true }
  }, { lock: false, sync: false })


  const watchers = new Map<number, Set<WebSocket>>()
  const sharp = new Set<WebSocket>()
  const sharpen = (tab: number) => void desktop("agent:live:sharp", tab, [...watchers.get(tab) ?? []].some((ws) => sharp.has(ws))).catch(() => {})
  let renew: ReturnType<typeof setInterval> | null = null
  const each = (tab: number, fn: (ws: WebSocket) => void) => { for (const ws of watchers.get(tab) ?? []) if (ws.readyState === ws.OPEN) fn(ws) }
  const json = (ws: WebSocket, m: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }

  plugin.onDesktopEvent((name, data) => {
    const d = FRAME.safeParse(data).data
    if (!d || !watchers.has(d.tab)) return
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
    const was = sharp.delete(ws)
    if (!set?.delete(ws)) return
    if (was) sharpen(tab)
    if (set.size) return
    watchers.delete(tab)
    void desktop("agent:live:unwatch", tab).catch(() => {})
    if (!watchers.size && renew) { clearInterval(renew); renew = null }
  }

  plugin.socket("web-viewer/live/*", async (ws, _req, { wild }) => {
    const [tab, m] = await tabOf(wild[0]).catch(() => [0, null] as const)
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
      let m: z.infer<typeof SAID> | undefined
      try { m = SAID.safeParse(JSON.parse(String(raw))).data } catch { return }
      if (m?.t === "input") void desktop("agent:live:input", tab, m).catch((e) => json(ws, { t: "error", text: e instanceof Error ? e.message : String(e) }))
      else if (m?.t === "sharp" && sharp.has(ws) !== (m.on === true)) {
        if (m.on === true) sharp.add(ws)
        else sharp.delete(ws)
        sharpen(tab)
      }
    })
    try { await watch(tab, ws) } catch (e) {
      json(ws, { t: "error", text: e instanceof Error ? e.message : String(e), fatal: true })
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
