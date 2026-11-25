import { z } from "zod"
import type { Presence } from "../../../core/desktop/knocks.ts"
import { type Machine, MACHINE_CLIENT, NOT_THE_USER, type OpCtx, OpError, type Plugin, quoted, splitMachine, userSurface } from "../../../core/plugins.ts"

type Deps = { presences: () => Presence[]; read: () => Promise<void>; settle: (p: Presence) => void; answered: (p: Presence) => void }
const Events = z.object({ events: z.array(z.looseObject({ id: z.string(), kind: z.string().optional(), state: z.string().optional(), terminal: z.string().optional(), session: z.string().optional() })) })
const Refused = z.object({ error: z.string() })
const MOVED_ON = "it moved on from that: look at what it asks now"

export function islandOps(plugin: Plugin, d: Deps) {
  async function answerTerminal(ctx: OpCtx, terminal: string, body: { answer: "approve" | "deny"; agent?: string }) {
    const [id, at] = splitMachine(terminal), route = `terminals/${encodeURIComponent(id)}/answer`
    if (!at) return void await ctx.api("POST", route, body)
    const m = await plugin.ask<Machine | null>("machines:machine", null, at)
    if (!m) throw new OpError(`no machine '${at}' (Machines lists them)`, 404)
    const r = await fetch(`${m.url}/api/${route}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }).catch(() => null)
    if (!r) throw new OpError(`${m.label} doesn't answer`, 502)
    if (!r.ok) throw new OpError(Refused.safeParse(await r.json().catch(() => null)).data?.error ?? `${m.label} answered ${r.status}`, r.status)
  }

  async function settleThread(ctx: OpCtx, p: Presence) {
    const { events } = Events.parse(await ctx.api("GET", "inbox/events?open=1&limit=200"))
    const its = events.find((e) => e.kind === "session" && e.state === "open" && (p.chat ? e.session === splitMachine(p.chat)[0] : !!p.terminal && e.terminal === p.terminal))
    if (its) await ctx.op("inbox.settle", { item: its.id })
  }

  plugin.op({
    id: "companion.presence-answer",
    owner: "the agents' sessions",
    summary: "Approve or decline the permission a session by the notch asks, as its card's buttons do.",
    help: "The user's alone, from the app: never an agent nor vau. `what` is what its card showed: asking something else since, it's refused.",
    kind: "write",
    lock: false,
    params: {
      id: { type: "string", required: true, description: "the presence's id (companion knocks lists them)" },
      answer: { type: "string", enum: ["approve", "deny"], required: true, description: "approve or deny" },
      what: { type: "string", required: true, description: "what it asked, as its card showed it" },
    },
    args: ["id", "answer"],
    run: async (p, ctx) => {
      if (!userSurface(ctx.who)) throw new OpError(NOT_THE_USER, 403)
      await d.read()
      const it = d.presences().find((x) => x.id === p.id)
      if (!it?.ask || it.ask.what !== p.what) throw new OpError(MOVED_ON, 409)
      if (it.chat) await ctx.op("claude-code.chat-answer", { id: it.chat, ask: it.ask.id, allow: p.answer === "approve" })
      else if (it.terminal) await answerTerminal(ctx, it.terminal, { answer: p.answer === "approve" ? "approve" : "deny", agent: it.agent })
      else throw new OpError("it's answered in its session", 409)
      d.answered(it)
      await d.read()
      return { id: it.id, who: it.who, answer: p.answer }
    },
    text: (r) => `${r.answer === "approve" ? "Approved" : "Declined"}: ${r.who}.`,
    did: (p) => ({ action: "run", text: `${p.answer === "approve" ? "Approved" : "Declined"} by the notch: ${quoted(p.what, 80)}` }),
  })

  plugin.op({
    id: "companion.presence-settle",
    owner: "the agents' sessions",
    summary: "Settle a session by the notch that's ready or done: it leaves the island till it works or asks again, and its inbox thread is settled.",
    kind: "write",
    lock: false,
    params: { id: { type: "string", required: true, description: "the presence's id (companion knocks lists them)" } },
    args: ["id"],
    run: async (p, ctx) => {
      const it = d.presences().find((x) => x.id === p.id)
      if (it && it.state !== "ready" && it.state !== "done") throw new OpError(`${it.who} is ${it.state} now: only one ready or done is settled`, 409)
      d.settle(it ?? { id: String(p.id), who: "", tint: "", state: "done", since: 0 })
      if (it) await settleThread(ctx, it).catch(() => {})
      return { id: p.id, who: it?.who ?? "" }
    },
    text: (r) => `Settled: ${r.who || r.id}.`,
  })
}
