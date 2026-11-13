import { HTTPError, logger, reply } from "../../../core/plugins.ts"
import { str } from "../../../core/vault.ts"
import { BLOCKED, clip, type InboxEvent, questionLine } from "./model.ts"
import * as push from "./push.ts"
import { owner, plugin, settings } from "./server.ts"
import { waitsOnYou } from "./threads.ts"

const log = logger("inbox")

export function pushBack(title: string, body?: string, data?: { event: string }) {
  if (settings().push === "off" || !push.devices().length) return
  void push.send(apns(), { title, body, thread: "inbox", ...(data ? { category: "event" as const, data } : {}) })
    .then((x) => { if (x.failed.length) log.error(`push failed: ${x.failed.join(", ")}`) }, (err) => log.error("push failed", err))
}

const apns = (): push.Apns | null => plugin.secrets().inbox?.apns ?? null

export function categoryOf(e: InboxEvent): push.Note["category"] {
  if (e.ask === "permission" && (e.terminal || e.gate || e.host) && (e.body ?? "").length <= push.BODY_MAX) return "permission"
  if (e.kind === "session" && e.ask !== "permission") return "reply"
  return "event"
}

export function pushed(e: InboxEvent) {
  const mode = settings().push
  if (e.read || mode === "off" || (mode === "waiting" && !waitsOnYou(e)) || !push.devices().length) return
  void push.send(apns(), {
    title: e.title, body: e.questions ? questionLine(e.questions, true) : [e.from && `From ${e.from.title}`, e.preview || e.body].filter(Boolean).join("\n"), category: categoryOf(e),
    thread: e.terminal || e.session || e.source, urgent: e.kind === "session" && BLOCKED.has(str(e.ask)),
    data: { event: e.id },
  }).then((r) => { if (r.failed.length) log.error(`push failed: ${r.failed.join(", ")}`) }, (err) => log.error("push failed", err))
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null
export function refreshWidgets() {
  if (refreshTimer || !push.devices().some((d) => d.widgets)) return
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void push.refresh(apns()).then((r) => { if (r.failed.length) log.error(`widget push failed: ${r.failed.join(", ")}`) }, (err) => log.error("widget push failed", err))
  }, 2000)
}

export function register() {
  plugin.onUnload(() => { if (refreshTimer) clearTimeout(refreshTimer) })
  plugin.route("POST", "inbox/devices", async (req) => {
    await owner(req)
    try {
      return reply(201, { device: push.register(req.body ?? {}), ready: push.configured(apns()) })
    } catch (e) {
      throw new HTTPError(400, (e as Error).message)
    }
  })

  plugin.route("GET", "inbox/devices", async (req) => {
    await owner(req)
    return { devices: push.devices().map((d) => ({ ...d, token: `${d.token.slice(0, 8)}…` })), ready: push.configured(apns()) }
  })

  plugin.route("DELETE", "inbox/devices/*", async (req) => {
    await owner(req)
    return { ok: push.forget(req.arg(0)) }
  })

  plugin.route("POST", "inbox/push", async (req) => {
    await owner(req)
    const b = req.body ?? {}
    const r = await push.send(apns(), { title: clip(b.title, 200) || "Vaultite", body: clip(b.body, 500), category: "event" })
    if (!r.ready) throw new HTTPError(409, "push isn't set up on this machine: data/config.json's inbox.apns (vau docs inbox)")
    return r
  })
}
