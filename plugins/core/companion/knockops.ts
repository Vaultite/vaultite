import { z } from "zod"
import type { OpCtx, Plugin } from "../../../core/plugins.ts"
import { OpError } from "../../../core/plugins.ts"
import { actOn, addKnock, duration, expire, type Knock, type KnockAct, makeKnock, over, type Presence, presencesOf, type PresenceState, type TermRow, URGENCIES } from "../../../core/desktop/knocks.ts"
import { type Job, terminalOf } from "./jobs.ts"
import { messageOf } from "./errors.ts"
import type { Message } from "./rooms.ts"

const str = (v: unknown) => (typeof v === "string" ? v : "")
const KEEP_MS = 86_400_000
const MUTE_MS = 12 * 3600_000
const EVERY_MS = 6000
const Listed = z.object({ sessions: z.array(z.unknown()).optional() })
const Row = z.object({ id: z.string(), agent: z.string().nullable().optional(), state: z.string().optional(), needs: z.boolean().optional(), name: z.string().optional(),
  title: z.string().optional(), msg: z.string().optional() })
const Heard = z.object({ act: z.enum(["show", "later", "told", "ignore", "open"]), id: z.unknown().optional(), mute: z.unknown().optional() })

type Deps = { toScreens: (m: object) => void; listening: () => boolean; jobs: () => Job[]; off: () => boolean; hidden: () => boolean }

export function knockOps(plugin: Plugin, d: Deps) {
  const all = () => plugin.keptNames("knocks/").map((n) => plugin.kept<Knock | null>(n, null)).filter((k): k is Knock => !!k?.id)
  const put = (k: Knock) => plugin.keep(`knocks/${k.id}`, k, { shared: true })
  const muted = () => plugin.kept<Record<string, number>>("knocks-muted", {})
  const isMuted = (from: string) => (muted()[from] ?? 0) > Date.now()

  let self = ""
  void plugin.ask<string | null>("machines:self", null).then((id) => { self = id ?? "" }, () => {})
  const qualified = (from: string) => (!from || from.includes("@") || !self ? from : `${from}@${self}`)
  const local = (from: string) => (self && from.endsWith(`@${self}`) ? from.slice(0, -self.length - 1) : from)
  const named = (k: Knock) => (k.from ? { ...k, from: local(k.from) } : k)

  let rows: TermRow[] = []
  const seen = new Map<string, { state: PresenceState; since: number }>()
  let presences: Presence[] = []
  let sent = ""
  function tell(force = false) {
    const now = Date.now(), ks = tidy(now)
    const jobs = d.jobs(), titles = new Map(jobs.map((j) => [local(terminalOf(j)), j.title]))
    const ready = new Set(jobs.filter((j) => j.state === "ready for review").map((j) => local(terminalOf(j))))
    const none = d.off() || d.hidden()
    presences = none ? [] : presencesOf(rows, ks.map(named), seen, now, { titles, ready })
    const m = { t: "knocks", knocks: none ? [] : ks.filter((k) => !over(k)), presences }
    const text = JSON.stringify(m)
    if (text === sent && !force) return
    sent = text
    d.toScreens(m)
  }
  function tidy(now: number) {
    const ks = all()
    for (const k of expire(ks, now)) {
      if (now - k.at > KEEP_MS && over(k)) plugin.keep(`knocks/${k.id}`, null)
      else if (k.state !== ks.find((x) => x.id === k.id)?.state) put(k)
    }
    return all()
  }
  let reading = false, again = false
  async function readTerminals(): Promise<void> {
    if (reading) { again = true; return }
    if (!d.listening() || d.off() || d.hidden()) return tell()
    reading = true
    try {
      const r = await plugin.runOp("terminal.list", { machine: "all" })
      rows = (Listed.safeParse(r.result).data?.sessions ?? []).flatMap((s) => Row.safeParse(s).data ?? [])
    } catch {} finally { reading = false }
    tell()
    if (again) { again = false; return readTerminals() }
  }
  const timer = setInterval(() => void readTerminals(), EVERY_MS)
  timer.unref?.()
  plugin.onUnload(() => clearInterval(timer))
  plugin.onEvent({ types: ["terminal.state", "terminal.ended"] }, () => void readTerminals())

  function whoIs(at: string, ctx: OpCtx) {
    const from = local(at)
    const job = d.jobs().find((j) => terminalOf(j) === from)
    const row = rows.find((r) => r.id === from)
    return job?.title || row?.name || row?.title || ctx.who.agent || "A session"
  }

  function knock(p: { from: string; who: string; line: string; urgency?: string; life?: number; open?: string; hold?: number }) {
    let k: Knock
    try { k = makeKnock({ id: `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ...p, from: qualified(p.from) }, Date.now()) } catch (e) { throw new OpError(messageOf(e), 400) }
    const before = new Map(all().map((x) => [x.id, x.state])), ks = addKnock(all(), k, isMuted)
    for (const x of ks) if (x.id === k.id || x.state !== before.get(x.id)) put(x)
    tell()
    return named(ks.find((x) => x.id === k.id)!)
  }

  function act(id: string, what: KnockAct, mute = false) {
    const k = all().find((x) => x.id === id || (id.length >= 4 && x.id.endsWith(id)))
    if (!k) throw new OpError(`no knock ${id} (companion knocks lists them)`, 404)
    const now = Date.now(), next = actOn(k, what, now)
    if (next !== k) put(next)
    if (mute && k.from) {
      plugin.keep("knocks-muted", { ...Object.fromEntries(Object.entries(muted()).filter(([, t]) => t > now)), [k.from]: now + MUTE_MS }, { shared: true })
      for (const x of all()) if (x.from === k.from && !over(x)) put(actOn(x, "ignore", now))
    }
    tell()
    return named(next)
  }

  plugin.op({
    id: "companion.knock",
    home: true,
    cli: "companion knock",
    summary: "Ask for the user's attention from a background session, in one line, without interrupting them: it comes up by the notch at their next pause.",
    help: `For a session working in the background (a terminal's agent, a job, a script) with something for the user: done
and ready to look at, a question only they can answer, a failure. The line shows beside the notch at a pause (never
while the companion speaks or they talk), waits a moment for "not now" (then it comes back at their next break; --hold
keeps its card up longer to be read, as a job's ready knock does for 15s), then folds into the island by design: it
stays as its session's presence, needing them, till they open it or its life ends. A newer knock from the same session
replaces its last. Urgency: low comes at a longer pause, high at any pause in the talk. Only the companion speaks.

  vau companion knock "Lighthouse tests pass: ready for you to look"
  vau companion knock "Which account should the deploy use?" --urgency high
  vau companion knock "Backup finished" --urgency low --for 2h`,
    kind: "write",
    lock: false,
    params: {
      line: { type: "string", required: true, description: "what it wants, one line in a few words, as the user would read it at a glance" },
      urgency: { type: "string", enum: URGENCIES, description: "low, normal (the default) or high" },
      for: { type: "string", description: "how long it lives (90s, 30m, 2h; default: high 15m, normal 1h, low 4h)" },
      who: { type: "string", description: "its session's name as the user knows it (default: its job's title, its terminal's name)" },
      terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal it comes from (vau fills it in when it runs in one): what a click opens" },
      open: { type: "string", description: "what a click opens instead: a note's path, a view, a link" },
      hold: { type: "string", description: "how long its card stays up before it folds into the island (15s, up to 2m; default 3s): it then comes only at a real pause, and waits while nobody is at the Mac" },
    },
    args: ["line"],
    run: async (p, ctx) => {
      if (d.off()) throw new OpError("the companion is off: nothing comes up by the notch", 409)
      const life = str(p.for) ? duration(str(p.for)) : undefined
      if (life !== undefined && !(life > 0)) throw new OpError(`for is a duration (90s, 30m, 2h), not ${str(p.for)}`, 400)
      const hold = str(p.hold) ? duration(str(p.hold)) : undefined
      if (hold !== undefined && !(hold > 0)) throw new OpError(`hold is a duration (15s, 1m), not ${str(p.hold)}`, 400)
      const from = qualified(str(p.terminal).trim())
      if (!rows.length) await readTerminals()
      return knock({ from, who: str(p.who) || whoIs(from, ctx), line: str(p.line), urgency: str(p.urgency) || undefined, life, open: str(p.open) || undefined, hold })
    },
    text: (k: Knock) => (k.state === "ignored" ? `Knock ${k.id} kept, unshown: the user ignored ${k.who} for now.` : d.hidden() ? `Knocked (${k.id}), kept: the island by the notch is off (the setting island), so it doesn't come up.` : `Knocked (${k.id}): it comes up by the notch at their next pause.`),
  })

  plugin.op({
    id: "companion.knocks",
    cli: "companion knocks",
    summary: "The knocks of the background sessions (waiting, put off, told) and the sessions shown by the notch; or put one off or ignore it, as the user said.",
    help: `What came to the user lately from sessions in the background, and the presences by the notch (working, needs
you, done). When they say "not now" or "ignore that one" about a knock, you mark it: later (it comes back at their next
break), ignore (that one), or mute (every knock from its session, for 12 hours). "Show me" opens its session
(vau open view:terminal/<its terminal>, --split right beside, or open what it names); a job's ready knock with a tour plays
its proof (companion job-show), one without opens its terminal.

  vau companion knocks
  vau companion knocks --later k3x
  vau companion knocks --ignore k3x
  vau companion knocks --mute k3x`,
    kind: "write",
    lock: false,
    params: {
      later: { type: "string", description: "a knock's id: put off till their next break" },
      ignore: { type: "string", description: "a knock's id: ignored, never shown" },
      mute: { type: "string", description: "a knock's id: every knock from its session ignored for 12 hours" },
      opened: { type: "string", description: "a knock's id: they opened it, it's over" },
    },
    run: (p) => {
      const did = str(p.later) ? act(str(p.later), "later") : str(p.ignore) ? act(str(p.ignore), "ignore") : str(p.mute) ? act(str(p.mute), "ignore", true) : str(p.opened) ? act(str(p.opened), "open") : null
      return { ...(did ? { did } : {}), knocks: tidy(Date.now()).sort((a, b) => b.at - a.at).slice(0, 20).map(named), presences }
    },
    text: (r: { did?: Knock; knocks: Knock[]; presences: Presence[] }) => {
      const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60_000); return m < 1 ? "now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago` }
      const ks = r.knocks.map((k) => `${k.id}  ${k.state}  ${k.urgency}  ${k.who}: ${k.line}  ${ago(k.at)}${k.from ? `  from ${k.from}` : ""}`)
      const ps = r.presences.map((p) => `${p.who}: ${p.state}${p.line ? `, "${p.line}"` : ""}${p.terminal ? `  (${p.terminal})` : ""}`)
      return `${r.did ? `${r.did.id} is ${r.did.state} now.\n\n` : ""}Knocks:\n${ks.length ? ks.join("\n") : "(none lately)"}\n\nBy the notch:\n${ps.length ? ps.join("\n") : "(no session in the background)"}`
    },
  })

  return {
    heard(m: Message) {
      const h = Heard.safeParse(m).data
      if (!h) return
      try { act(str(h.id), h.act, h.mute === true) } catch {}
    },
    hello: () => { tell(true); void readTerminals() },
    presences: () => presences,
    knocks: () => all().filter((k) => !over(k)),
    knock,
    settle: (from: string) => { for (const x of all()) if (x.from === qualified(from) && !over(x)) put(actOn(x, "open", Date.now())); tell() },
  }
}
