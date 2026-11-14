import fs from "node:fs"
import { agentName, parseJson } from "../../../core/agents.ts"
import { OpError } from "../../../core/plugins.ts"
import type { Follow } from "./follows.ts"
import { voiceHere, voiceHereText } from "./voice.ts"
import "./draw.ts"
import { plugin } from "./self.ts"
import type { JobAsk, Agent, Note } from "./types.ts"
import { MomentRow } from "./rows.ts"
import { str, setting, mode, ownName } from "./settings.ts"
import { moments, waiters, agents, watching, notes, log, did, windows, broadcast, key, isMain, live, focus, batches, resend, shown } from "./state.ts"
import { addMoment } from "./intake.ts"
import { realtimePaused, pausedNow, mics, calls } from "./screensocket.ts"
import { followed } from "./windowpanes.ts"
import { stopStreams, cut } from "./edits.ts"
import { session, sessionId, sessions, running, isChat, runsOf, nextCmd, start, fresh, stop } from "./alwayson.ts"
import { chat } from "./chat.ts"
import { summonedModel, summonedEffort, lane } from "./lane.ts"
import { pump, INTERRUPT, STOPPED, stopped } from "./chatturns.ts"
import { LINE, who } from "./args.ts"
import { followText } from "./opening.ts"
import { byText } from "./people.ts"

plugin.op({
  id: "companion.status",
  cli: "companion status",
  summary: "What the companion is: its mode, its sessions, the agents in the app and what they left there.",
  kind: "read",
  params: {},
  run: async () => {
    const id = sessionId()
    const all = await Promise.all(sessions().map(async (s) => ({ ...s, running: await running(s.id) })))
    return { mode: mode(), name: ownName(), session: (await running(id)) ? id : null, windows: windows.size, focus: focus(),
      sessions: all.filter((s) => s.running).map(({ name, id }) => ({ name, id, ...(isChat(id) ? { chat: true } : {}) })), summoned: lane().on() ? { id: lane().id(), model: summonedModel(), effort: summonedEffort(), ...(lane().trouble() ? { trouble: lane().trouble() } : {}) } : null,
      agents: [...agents.values()].map(shown).map((a) => ({ ...a, live: a.state !== "away" && live(a.name), watch: isMain(a.name) || watching.has(key(a.name)) })),
      notes: [...notes.values()], moments: moments.slice(-10), follows: followed.list(),
      realtime: pausedNow() ? { state: "paused" as const, ...pausedNow()! } : realtimePaused.size ? { state: "on" as const } : null, voice: voiceHere(plugin, setting, [...mics.values()].at(-1)), ...(calls.size ? { call: [...calls.values()].at(-1) } : {}) }
  },
  text: (r) => [`Mode: ${r.mode}. Session: ${r.session ?? "not running"}.${r.summoned ? ` Summoned asks: ${r.summoned.model}${r.summoned.id ? `, session ${r.summoned.id}` : ""}${r.summoned.trouble ? ` (its last trouble, at ${new Date(r.summoned.trouble.t).toTimeString().slice(0, 5)}: ${cut(r.summoned.trouble.why, 160)})` : ""}.` : ""} Windows: ${r.windows}.`,
    voiceHereText(r.voice),
    ...(r.call ? [`Quiet: ${r.call}, its answers show as text.`] : []),
    ...(r.realtime?.state === "paused" ? [`Realtime voice: paused, ${r.realtime.account === "quota" ? "the OpenAI account has no credits" : "OpenAI refused its key"} (${cut(r.realtime.why, 120)}); tries again at ${new Date(r.realtime.until).toTimeString().slice(0, 5)}.`] : []),
    ...r.agents.map((a: Agent & { live: boolean }) => {
      const s = r.sessions.find((x: { name: string }) => key(x.name) === key(a.name))
      return `- ${a.name} (${a.tint})${isMain(a.name) ? ", the companion" : ""}: ${a.live || isMain(a.name) ? a.state : "away"}${a.path ? ` at ${a.path}${a.line ? `:${a.line}` : ""}` : ""}${s ? `, session ${s.id}` : ""}`
    }),
    ...r.notes.map((n: Note) => `- ${n.id} ${n.kind} by ${byText(n)}${n.path ? ` in ${n.path}` : ""}: ${cut(n.text ?? n.replace ?? n.find ?? "", 80)}`),
    ...r.follows.map((f: Follow) => `- ${f.agent} follows ${followText(f)}`)].join("\n"),
})

plugin.op({
  id: "companion.start",
  cli: "companion start",
  owner: "a coding agent",
  summary: "Start the companion's always-on session (its agent, in a terminal on this machine), or another agent's by name.",
  help: `With --as, another agent joins under that name, with its own cursor colour: @name in a note asks it (asks sent while
it starts wait for it). The name's first part picks what it runs (the setting profiles: Opus-review runs Claude Code on
Opus, Codex runs Codex); --agent, --model and --effort override that (each moment is one of the model's turns). Other
names run the settings' agent, model and effort.

  vau companion start
  vau companion start --as Opus-review
  vau companion start --as Ada --agent codex --model gpt-6-luna --effort high`,
  kind: "write",
  lock: false,
  params: { as: { type: "string", description: "start another agent under this name (one word; default: the companion)" },
    agent: { type: "string", description: "the coding agent it runs (claude, codex, claude_personal...; default: its name's profile, else the setting)" },
    model: { type: "string", description: "the model it runs (sonnet, opus, gpt-6.1-sol, a full name; default: its name's profile, else the setting, else the agent's own)" },
    effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"], description: "its effort (default: its name's profile, else the setting, else the agent's own)" },
    path: { type: "string", format: "path", description: "the note it was called from: its cursor waits there while it starts" }, line: LINE,
    after: { type: "integer", minimum: 0, description: "the moments after this one wait for it (the ask that started it); default: those from now" } },
  run: async (p, ctx) => {
    if (mode() === "off") await plugin.patchSettings({ mode: "quiet" })
    const at = str(p.path) ? { path: str(p.path), ...(p.line ? { line: Number(p.line) } : {}) } : {}
    return await start(ctx, str(p.as), str(p.agent), str(p.model), str(p.effort), at, p.after)
  },
  text: (r) => `${r.running ? "Already running" : "Started"}: ${r.name}${"agent" in r && r.agent ? ` (${[agentName(r.agent.split("_")[0]) ?? r.agent, r.model, r.effort].filter(Boolean).join(", ")})` : ""} in ${r.id} (${isChat(r.id) ? `vau chat read ${r.id}` : `vau terminal capture ${r.id}`}).`,
})

plugin.op({
  id: "companion.stop",
  cli: "companion stop",
  owner: "the terminal",
  summary: "End the companion's session (or another agent's, by name); its cursor goes away until it starts again.",
  kind: "write",
  lock: false,
  params: { as: { type: "string", description: "the agent started with start --as (default: the companion)" }, all: { type: "boolean", description: "every session" } },
  run: async (p) => await stop(str(p.as), !!p.all),
  text: (r) => (r.id ? `Ended ${r.id}.` : "It wasn't running."),
})

plugin.op({
  id: "companion.interrupt",
  cli: "companion interrupt",
  summary: "Stop the companion mid-answer (Esc in a note): its turn ends where it is, and what it typed stays.",
  kind: "write",
  lock: false,
  params: { as: { type: "string", description: "the agent started with start --as (default: the companion)" } },
  run: async (p) => {
    const name = str(p.as) ? who(p) : ownName(), s = session(name), k = key(name)
    stopStreams(name)
    broadcast({ t: "hush", agent: name })
    const asks = (batches.get(k) ?? []).flatMap((n) => moments.find((m) => m.seq === n && m.kind === "ask")?.text ?? [])
    const keys = s && !isChat(s.id) ? INTERRUPT[runsOf(s).split("_")[0]] : undefined
    let ok = isMain(name) && await lane().interrupt()
    if (!ok && s && isChat(s.id)) {
      ok = !!(await chat()?.interrupt(s.id).catch(() => false))
      if (ok) { stopped.set(k, asks); resend.delete(k) }
    } else if (!ok && s && keys && !waiters.has(k) && await running(s.id)) {
      ok = !!(await plugin.runOp("terminal.key", { id: s.id, keys }).catch(() => null))
      if (ok) setTimeout(() => void plugin.runOp("terminal.send", { id: s.id, text: `${STOPPED(asks)} Then run \`${nextCmd(name)}\` again, and never end your turn.` }).catch(() => {}), 1000).unref?.()
    }
    if (ok) did(name, "stopped")
    return { name, stopped: ok }
  },
  text: (r) => (r.stopped ? `Stopped ${r.name}.` : `${r.name} wasn't answering.`),
})

plugin.op({
  id: "companion.fresh",
  cli: "companion fresh",
  owner: "the terminal",
  summary: "Have the companion (or another agent, by name) hand over to a fresh session: once it's free, it writes what the next should know, which starts with that and its threads.",
  kind: "write",
  lock: false,
  params: { as: { type: "string", description: "the agent started with start --as (default: the companion)" } },
  run: async (p) => {
    const name = str(p.as).trim() || ownName(), k = key(name), s = session(name)
    if (!s || !(await running(s.id))) throw new OpError(`${name} isn't running`, 404)
    fresh.add(k)
    const wait = waiters.get(k)
    if (wait) { waiters.delete(k); wait([]) }
    if (isChat(s.id)) void pump(name)
    return { name, id: s.id }
  },
  text: (r) => `${r.name} hands over to a fresh session once it's free.`,
})

const Recorded = MomentRow.omit({ seq: true })

plugin.op({
  id: "companion.replay",
  cli: "companion replay",
  summary: "Replay moments recorded on a day (or from a file of JSON lines) to the companion, to see how it answers.",
  help: `The test harness: moments are logged on this machine each day; replaying a day's sends them again, spaced as they
came (faster with speed), so you can watch what the session makes of them.

  vau companion replay --day 2026-10-16 --speed 4
  vau companion replay --file /tmp/moments.jsonl`,
  kind: "read",
  lock: false,
  params: { day: { type: "string", description: "a day (YYYY-MM-DD) of the log" }, file: { type: "string", description: "a file of moments, one JSON per line" },
    speed: { type: "number", minimum: 0.1, default: 1, description: "how much faster than they came" }, limit: { type: "integer", minimum: 1, default: 50, description: "at most this many" } },
  run: async (p) => {
    let ms: JobAsk[] = []
    if (p.file) ms = fs.readFileSync(String(p.file), "utf8").split("\n").flatMap((l) => parseJson(l, Recorded) ?? [])
    else if (p.day) ms = log.read(String(p.day))
    else throw new OpError("give `day` or `file`")
    ms = ms.slice(-p.limit)
    const t0 = ms[0]?.t ?? 0
    void (async () => {
      for (const m of ms) {
        const wait = Math.min(30_000, Math.max(0, (m.t - t0) / p.speed))
        await new Promise((r) => setTimeout(r, wait))
        addMoment({ ...m, t: Date.now() })
      }
    })()
    return { replaying: ms.length }
  },
  text: (r) => `Replaying ${r.replaying} moments.`,
})
