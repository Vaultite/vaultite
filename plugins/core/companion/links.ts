import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { parseTerminal } from "../../../core/agents.ts"
import { gitEnv, logger, type Machine, MACHINE_CLIENT, type OpCtx, OpError, type Plugin } from "../../../core/plugins.ts"
import { commitsIn, type Marks, picturesIn } from "./jobs.ts"
import { branchOf, githubOf, headOf } from "./where.ts"
import type { Seen } from "./workers.ts"

const log = logger("companion")

export type Start = { agent: string; cwd: string; name: string; prompt?: string; session?: string; model?: string; effort?: string; mode?: string
  base?: string }
export type Read = { turn?: boolean; session?: string; cwd?: string; base?: string; tree?: string; branch?: string; said?: string; context?: boolean; marks?: Marks }
export type Home = { url: string; as: string }

export type Link = {
  kind: "here" | "machine" | "cloud"
  start: (ctx: OpCtx, s: Start) => Promise<string>
  seen: (terminal: string, r: Read) => Promise<Seen>
  tell: (ctx: OpCtx, terminal: string, text: string) => Promise<{ submitted?: boolean | null; why?: string }>
  land: (ctx: OpCtx, terminal: string, text: string) => Promise<{ submitted?: boolean | null; why?: string }>
  end: (ctx: OpCtx, terminal: string) => Promise<void>
  carry: (text: string) => Promise<string>
  there: (ctx: OpCtx, id: string, body: object, seconds?: number) => Promise<unknown>
}

const Answer = z.record(z.string(), z.unknown()).catch({})
const Failed = z.object({ error: z.string() })
const Started = z.object({ id: z.string() })
const Sent = z.looseObject({ submitted: z.boolean().nullable().optional(), why: z.string().optional() })
const Taken = z.object({ path: z.string() })
const Session = z.object({ session: z.string() })
const Turn = z.looseObject({ prompt: z.string(), text: z.string(), at: z.number(), final: z.boolean(), files: z.array(z.string()), background: z.number().optional(),
  asks: z.array(z.object({ question: z.string(), choices: z.array(z.string()) })).optional() })
const CloudRead = z.object({ sessions: z.record(z.string(), z.looseObject({ status: z.string(), title: z.string() }).nullable()), turns: z.record(z.string(), Turn.nullable()) })
const SeenThere = z.looseObject({ running: z.boolean(), state: z.string().optional(), kind: z.string().optional(), msg: z.string().optional(), title: z.string().optional(),
  typed: z.number().optional(), asks: z.array(z.string()).optional(), diff: z.string().optional(), unreachable: z.string().optional(), onMain: z.boolean().optional(),
  waits: z.looseObject({ kind: z.enum(["permission", "question"]), question: z.string(), choices: z.array(z.string()) }).optional(),
  turn: z.looseObject({ text: z.string(), files: z.array(z.string()), at: z.number(), final: z.boolean(), session: z.string().optional(), prompt: z.string().optional(), background: z.number().optional() }).nullable().optional(),
  exit: z.looseObject({ code: z.number(), signal: z.number(), lost: z.boolean().optional() }).optional(),
  context: z.looseObject({ tokens: z.number(), window: z.number() }).optional(),
  marks: z.looseObject({ whole: z.string(), each: z.array(z.string()) }).optional() })

export function workerLinks(plugin: Plugin, o: { seenHere: (terminal: string, r: Read) => Promise<Seen>
  landing: (cwd: string, base: string, text: string, branch: string, kept?: Marks) => Promise<Pick<Seen, "onMain" | "marks">> }) {
  async function atMachine(machine: string, id: string, body: object, seconds = 15) {
    const m = await plugin.ask<Machine | null>("machines:machine", null, machine)
    if (!m || m.self) throw new OpError(`no machine '${machine}' (Machines lists them)`, 404)
    if (!m.online) throw new OpError(`${m.label} is offline`, 502)
    const r = await fetch(`${m.url}/api/ops/${id}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(seconds * 1000) }).catch(() => null)
    if (!r) throw new OpError(`${m.label} doesn't answer`, 502)
    const out = Answer.parse(await r.json().catch(() => ({})))
    if (!r.ok) throw new OpError(`${m.label}: ${Failed.safeParse(out).data?.error || `answered ${r.status}`}`, r.status)
    return out
  }

  const KEY = "workers-here"
  const ids = () => plugin.kept<{ ids: string[] }>(KEY, { ids: [] }).ids ?? []
  async function startHere(ctx: OpCtx, s: Start, home?: Home) {
    const r = Started.parse(await ctx.op("terminal.start", { agent: s.agent, name: s.name, cwd: s.cwd, ...(s.prompt ? { prompt: s.prompt } : {}), ...(s.session ? { session: s.session } : {}),
      ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}), ...(s.mode ? { mode: s.mode } : {}), ...(home ? { home } : {}) }))
    plugin.keep(KEY, { ids: [...ids().filter((x) => x !== r.id), r.id].slice(-200) })
    return r.id
  }
  async function running() {
    const all = ids(), up = await Promise.all(all.map((id) => plugin.ask<boolean>("terminal:runs", false, id).catch(() => false)))
    if (up.some((x) => !x)) plugin.keep(KEY, { ids: all.filter((_, i) => up[i]) })
    return up.filter(Boolean).length
  }

  const here: Link = {
    kind: "here",
    start: (ctx, s) => startHere(ctx, s),
    seen: (terminal, r) => o.seenHere(terminal, r),
    tell: async (ctx, terminal, text) => Sent.parse(await ctx.op("terminal.send", { id: terminal, text })),
    land: (ctx, terminal, text) => here.tell(ctx, terminal, text),
    end: async (ctx, terminal) => { await ctx.op("terminal.end", { id: terminal }) },
    carry: async (text) => text,
    there: (ctx, id, body) => ctx.op(id, { ...body }),
  }

  const homeUrl = async () => ((await plugin.ask<Machine[]>("machines", [])).find((m) => m.self)?.url ?? "").replace(/\/+$/, "")
  const machineLinks = new Map<string, Link>()
  function machineLink(machine: string): Link {
    const hit = machineLinks.get(machine)
    if (hit) return hit
    const link: Link = {
      kind: "machine",
      start: async (_ctx, s) => {
        const url = await homeUrl()
        const id = Started.safeParse(await atMachine(machine, "companion.worker-start", { ...s, ...(url ? { home: { url, as: machine } } : {}) }, 30)).data?.id
        if (!id) throw new OpError(`${machine} didn't say which terminal it started`, 502)
        return id
      },
      seen: async (terminal, r) => SeenThere.parse(await atMachine(machine, "companion.worker", { id: terminal, ...r }, 10)),
      tell: async (ctx, terminal, text) => Sent.parse(await ctx.op("terminal.send", { id: `${terminal}@${machine}`, text })),
      land: (ctx, terminal, text) => link.tell(ctx, terminal, text),
      end: async (ctx, terminal) => { await ctx.op("terminal.end", { id: `${terminal}@${machine}` }) },
      carry: (text) => carry(machine, text),
      there: (_ctx, id, body, seconds = 10) => atMachine(machine, id, body, seconds),
    }
    machineLinks.set(machine, link)
    return link
  }

  async function carry(machine: string, text: string) {
    const files = picturesIn(text).filter((f) => fs.existsSync(f))
    const m = files.length ? await plugin.ask<Machine | null>("machines:machine", null, machine) : null
    if (!m || m.self || !m.online) return text
    const there = await Promise.all(files.map(async (f) => {
      const r = await fetch(`${m.url}/api/ops/companion.picture-take?name=${encodeURIComponent(path.basename(f))}`, { method: "POST",
        headers: { ...MACHINE_CLIENT, "Content-Type": "image/png" }, body: fs.readFileSync(f), signal: AbortSignal.timeout(15_000) }).catch(() => null)
      const to = (r?.ok ? Taken.safeParse(await r.json().catch(() => null)).data?.path : "") ?? ""
      if (!to) log.error(`jobs: couldn't copy ${path.basename(f)} to ${m.label}${r ? ` (${r.status})` : ""}`)
      return to || f
    }))
    return files.reduce((t, f, i) => t.split(f).join(there[i]), text)
  }

  const cloudSay = async <T>(name: string, answer: z.ZodType<T>, ...args: unknown[]) => {
    const fn = plugin.service(`cloud-${name}:claude`)
    if (typeof fn !== "function") throw new OpError("cloud sessions need Claude Code's plugin on", 409)
    return answer.parse(await fn(...args))
  }
  const accountOf = (agent: string) => parseTerminal(`${agent}-x`)?.profile || "default"
  const fetched = new Map<string, number>()
  const fetchMain = (cwd: string) => {
    if (Date.now() - (fetched.get(cwd) ?? 0) < 60_000) return Promise.resolve()
    fetched.set(cwd, Date.now())
    return new Promise<void>((ok) => execFile("git", ["fetch", "-q", "--no-tags", "origin"], { cwd, timeout: 60_000, env: gitEnv() }, () => ok()))
  }
  function cloudLink(agent: string): Link {
    const account = accountOf(agent)
    const link: Link = {
      kind: "cloud",
      start: async (_ctx, s) => {
        const repo = await githubOf(s.cwd)
        if (!repo) throw new OpError(`${s.cwd} isn't a checkout of a GitHub repo: a cloud session clones from GitHub`, 409)
        const r = await cloudSay("start", Session, account, { repo, branch: await branchOf(s.cwd) || "main", base: s.base || await headOf(s.cwd), from: s.cwd, prompt: s.prompt ?? "" })
        return r.session
      },
      seen: async (session, r) => {
        const got = await cloudSay("read", CloudRead, account, [session], r.turn ? [session] : [])
        const st = got.sessions[session], t = got.turns[session] ?? null
        if (!st || st.status === "archived") return { running: false, exit: { code: 0, signal: 1 }, ...(r.turn ? { turn: t } : {}) }
        const ask = t?.asks?.[0], blocked = st.status === "requires_action"
        const seen: Seen = { running: true, state: st.status === "failed" ? "error" : blocked ? "blocked" : st.status === "idle" ? "idle" : "working",
          ...(blocked ? { kind: ask ? "question" : "permission", msg: ask?.question ?? "Waits on you in its session on claude.ai",
            waits: ask ? { kind: "question" as const, question: ask.question, choices: t!.asks!.length === 1 ? ask.choices : [] } : { kind: "permission" as const, question: "Waits on a permission in its session on claude.ai", choices: [] } } : {}),
          ...(r.turn ? { turn: t, ...(t?.asks?.length ? { asks: t.asks.map((x) => x.question) } : {}) } : {}) }
        const said = [t?.text, r.said].filter(Boolean).join("\n")
        if (r.cwd && r.base && (r.turn || r.said)) {
          if (commitsIn(said).length) await fetchMain(r.cwd)
          Object.assign(seen, await o.landing(r.cwd, r.base, said, "", r.marks))
        }
        return seen
      },
      tell: (_ctx, session, text) => cloudSay("tell", Sent, account, session, text),
      land: (ctx, session, text) => link.tell(ctx, session, text),
      end: async (ctx, session) => {
        const s = await link.seen(session, {}).catch(() => null)
        if (s?.running && s.state !== "idle") await link.tell(ctx, session, "Stop here: they stopped this job. Do nothing more.").catch(() => {})
      },
      carry: async (text) => picturesIn(text).reduce((t, f) => t.split(f).join("(a picture of their screen, on their machine only)"), text),
      there: (ctx, id, body) => ctx.op(id, { ...body }),
    }
    return link
  }
  const cloudLinks = new Map<string, Link>()

  return {
    of: (w: { machine: string; cloud?: boolean; agent?: string }): Link => {
      if (!w.cloud) return w.machine ? machineLink(w.machine) : here
      const agent = w.agent ?? "claude"
      if (!cloudLinks.has(agent)) cloudLinks.set(agent, cloudLink(agent))
      return cloudLinks.get(agent)!
    },
    atMachine, startHere, running,
  }
}
