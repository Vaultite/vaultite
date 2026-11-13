import fs from "node:fs"
import type { WebSocket } from "ws"
import { HOME } from "../../../core/agents.ts"
import { logger, type Machine, MACHINE_CLIENT, machineSocket, OpError, pipeSockets, type Plugin, splitMachine, Text } from "../../../core/plugins.ts"
import type { ChatCore } from "./chat.ts"
import { PAGE } from "./chatentries.ts"
import { type Entry, imageType } from "./chatlog.ts"
import { type Mode, MODES, type TabMessage } from "./chatprotocol.ts"
import { KEEP_IMAGE, pictureFile, pictureIn, sweep } from "./chatpictures.ts"
import { SESSION } from "./chatwire.ts"
const log = logger("chat")

export const MODE_LABELS: Record<Mode, string> = { default: "Ask for permissions", acceptEdits: "Accept edits", plan: "Plan mode", auto: "Auto mode",
  dontAsk: "Don't ask", bypassPermissions: "Bypass permissions" }
const PING_MS = 20_000, PING = JSON.stringify({ t: "ping" } satisfies TabMessage)
const say = (ws: WebSocket, m: TabMessage) => ws.send(JSON.stringify(m))

type Needs = Pick<ChatCore, "watching" | "holding" | "hosted" | "readTitle" | "hello" | "conversation" | "page" | "modelDefault" | "effortDefault" | "modeDefault" | "d">

export function chatTab(plugin: Plugin, c: Needs) {
  const { watching, holding, hosted, readTitle, hello, conversation, page, modelDefault, effortDefault, modeDefault, d } = c
  // A phone back from the background has a socket that went quiet: each is pinged, one that stops answering ended.
  const answered = new Map<WebSocket, boolean>(), told = new WeakSet<WebSocket>()
  function alive(ws: WebSocket, tell: boolean) {
    answered.set(ws, true)
    ws.on("pong", () => { if (answered.has(ws)) answered.set(ws, true) })
    ws.on("close", () => answered.delete(ws))
    if (tell) told.add(ws)
  }
  const pinging = setInterval(() => {
    for (const [ws, ok] of answered) {
      if (ws.readyState !== ws.OPEN) continue
      if (!ok) { ws.terminate(); continue }
      answered.set(ws, false)
      try { ws.ping(); if (told.has(ws)) ws.send(PING) } catch { ws.terminate() }
    }
    sweep()
  }, PING_MS)
  pinging.unref?.()
  plugin.onUnload(() => clearInterval(pinging))

  plugin.socket("claude-code/chat/*", async (ws, req, { wild }) => {
    const [id, at] = splitMachine(wild[0] ?? "")
    const why = await plugin.refusal(req, "Claude Code's chat")
    const m = !why && at ? await plugin.ask<Machine | null>("machines:machine", null, at) : null
    if (m && !m.self) {
      const away = () => { if (ws.readyState === ws.OPEN) { say(ws, { t: "unreachable", reason: `${m.label} isn't answering` }); ws.close(1013, "unreachable") } }
      if (!m.online) return away()
      const up = machineSocket(m, `claude-code/chat/${encodeURIComponent(id)}`)
      alive(ws, true)
      up.once("open", () => alive(up, false))
      return pipeSockets(ws, up, away)
    }
    if (why || !SESSION.test(id) || (at && !m)) {
      if (ws.readyState === ws.OPEN) say(ws, { t: "refused", reason: why || (at ? `no machine '${at}'` : "not a session id") })
      return ws.close(4003, "refused")
    }
    let set = watching.get(id)
    if (!set) watching.set(id, (set = new Set()))
    const held: string[] = []
    holding.set(ws, held)
    set.add(ws)
    alive(ws, true)
    const sent = new Map<string, Entry>()
    let tui: string | null = null
    const poll = setInterval(async () => {
      if (hosted.has(id) || ws.readyState !== ws.OPEN) return
      const t = await readTitle(id).catch(() => null)
      for (const e of t?.list.slice(-PAGE) ?? []) if (sent.get(e.id) !== e) { sent.set(e.id, e); say(ws, { t: "put", e }) }
      const now = await d.tuiOf(id)
      if (now !== tui) { tui = now; say(ws, { t: "tui", tui, title: t?.title ?? "" }) }
    }, 2500)
    ws.on("close", () => { clearInterval(poll); set!.delete(ws); if (!set!.size) watching.delete(id) })
    try {
      const h = await hello(id)
      for (const e of h.history.entries) sent.set(e.id, e)
      tui = h.tui
      if (ws.readyState === ws.OPEN) { say(ws, h); for (const text of held) ws.send(text) }
    } catch (e) {
      log.error("hello failed", e, { id })
      if (ws.readyState === ws.OPEN) { say(ws, { t: "error", reason: (e instanceof Error ? e.message : String(e)) }); ws.close(1011, "hello failed") }
    } finally { holding.delete(ws) }
  })

  plugin.route("GET", "claude-code/chat/*/history", async (req) => {
    await plugin.ownerOnly(req, "Claude Code's chat")
    const [id, at] = splitMachine(req.arg(0))
    const m = at ? await plugin.ask<Machine | null>("machines:machine", null, at) : null
    if (m && !m.self) {
      const r = await fetch(`${m.url}/api/claude-code/chat/${encodeURIComponent(id)}/history?${new URLSearchParams(req.query)}`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(15000) }).catch(() => null)
      if (!r?.ok) throw new OpError(`${m.label} doesn't answer`, 502)
      return await r.json()
    }
    if (!SESSION.test(id)) throw new OpError(`'${id}' isn't a session id`, 404)
    const { list } = await conversation(id)
    return page(list, req.query.before !== undefined ? Math.trunc(Number(req.query.before)) || 0 : undefined, Math.min(1000, Math.max(1, Number(req.query.limit) || PAGE)))
  }, { sync: false })

  plugin.route("GET", "claude-code/chat/*/image/*/*", async (req) => {
    await plugin.ownerOnly(req, "Claude Code's chat")
    const [id, at] = splitMachine(req.arg(0)), entry = req.arg(1), n = req.arg(2)
    if (!SESSION.test(id) || !SESSION.test(entry) || !/^\d{1,3}$/.test(n)) throw new OpError("no such picture", 404)
    const m = at ? await plugin.ask<Machine | null>("machines:machine", null, at) : null
    if (at && !m) throw new OpError(`no machine '${at}' (Machines lists them)`, 404)
    if (m && !m.self) {
      const r = await fetch(`${m.url}/api/claude-code/chat/${encodeURIComponent(id)}/image/${encodeURIComponent(entry)}/${n}`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(30000) }).catch(() => null)
      if (r?.status === 404) throw new OpError("no such picture", 404)
      if (!r?.ok) throw new OpError(`${m.label} doesn't answer`, 502)
      return new Text(Buffer.from(await r.arrayBuffer()), r.headers.get("content-type") ?? "application/octet-stream", KEEP_IMAGE)
    }
    const b = pictureFile(entry, Number(n)) ?? await pictureIn(d.sessionFile(id)?.file, entry, Number(n))
    const type = b && imageType(b)
    if (!b || !type) throw new OpError("no such picture", 404)
    return new Text(b, type, KEEP_IMAGE)
  }, { sync: false })

  // a vault reached through a link (iCloud's) is named by its real path, as sessions' cwd is
  const realVault = () => { try { return fs.realpathSync(plugin.vault.path) } catch { return plugin.vault.path } }
  plugin.route("GET", "claude-code/chat/options", async (req) => {
    await plugin.ownerOnly(req, "Claude Code's chat")
    const m = d.models()
    return { models: m.models, efforts: m.efforts, modes: MODES.map((id) => ({ id, label: MODE_LABELS[id] })),
      accounts: d.accounts().filter((a) => !a.private).map((a) => { const model = modelDefault(a.id); return { id: a.id, label: a.label, model, effort: effortDefault(a.id, model), mode: modeDefault(a.id) } }),
      folders: (await d.folders()).slice(0, 12), vault: realVault(), home: HOME }
  }, { sync: false })
}
