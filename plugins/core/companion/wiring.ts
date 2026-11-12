// Its jobs (workers.ts): long work handed to a worker in a terminal, through one lifecycle (jobs.ts).
import fs from "node:fs"
import os from "node:os"
import type { AgentUse } from "../../../core/agents.ts"
import { ROOT } from "../../../core/plugins.ts"
import { inSummoned } from "./summoned.ts"
import { commitsIn, type Job, type JobState, jobSpoken, landable, onMain, terminalOf } from "./jobs.ts"
import { jobTold } from "../../../core/desktop/jobnews.ts"
import { knockOps } from "./knockops.ts"
import { readyNow } from "./proof.ts"
import { proofOps } from "./proofs.ts"
import { captureOps } from "./captures.ts"
import { liveEdits } from "./liveedit.ts"
import { talkOps } from "./talks.ts"
import { walkOps } from "./walkops.ts"
import { teachOps } from "./teachops.ts"
import { jobOps } from "./workers.ts"
import { beatOf, markOf, placeOf as tagPlace, type Tag } from "./tags.ts"
import "./next.ts"
import { plugin } from "./self.ts"
import type { Note } from "./types.ts"
import { sayMs, setting, mode, agentSetting, ownName } from "./settings.ts"
import { moments, nextSeq, agents, notes, said, did, windows, send, key, isMain, placeOf, handOut, agentOf, setAgent, putNote, dropNote } from "./state.ts"
import { keepSaid } from "./comments.ts"
import { screens, screenDrawing, tours, type ScreenRectLike, displaysOf, stopFlips, ownTour, screenOf, screenFind, lastScreen, toScreens, nearBy } from "./windows.ts"
import { paneById } from "./windowpanes.ts"
import { answersOf } from "./edits.ts"
import { AS_TOOL, itsOwn, liveCtx } from "./chat.ts"
import { lane } from "./lane.ts"
import { AS, who } from "./args.ts"

/** The ask agent `name` is answering: its summoned session's turn's, else its last. */
export const askOf = (name: string) => (inSummoned.getStore() ? lane().last() : moments).findLast((m) => (m.kind === "ask" || m.kind === "point") && (m.for ? key(m.for) === key(name) : isMain(name)))
export const jobs = jobOps(plugin, {
  askOf, own: itsOwn,
  say: (ctx, name, text) => plugin.host.call("companion.say", { text, ...(isMain(name) ? {} : { as: name }) }, ctx.who),
  saidSince: (name, since) => [...new Map([...said, ...notes.values()].flatMap((n) => (n.kind === "say" && key(n.agent) === key(name) && n.t >= since ? [[n.id, n.text ?? ""] as const] : []))).values()],
  turnEnd: (name) => (inSummoned.getStore() && isMain(name) ? lane().turnEnd() : null),
  did, who, as: AS, cards: (cards) => toScreens({ t: "jobs", jobs: cards }),
  // (a talk's turn is said by the job's cursor, a live edit's told by its ring; a job just ready knocks, its proof to
  // show; the rest is news)
  moved: (j, from) => void (talks.moved(j, from) || liveEditing.moved(j, from) || (readyNow(j, from) && j.terminal ? proofs.moved(j, from) : jobNews(j.title, j.state, from)).catch(() => {})),
  warm: (j) => liveEditing.warm(j) || talks.talking(j),
  paneTo: (id) => paneById(id)?.to ?? "",
  onScreen: (link) => [...windows.values()].some((w) => { const tab = w.panes.find((p) => p.id === w.pane)?.tab; return !!tab && w.panes.some((p) => p.tab === tab && p.to === link) }),
})
captureOps(plugin, jobs)
teachOps(plugin)
/** The terminals whose job is ready for review, as Terminal's list names them (another machine's `<id>@<machine>`):
 *  its rows keep them in view, never folded away. */
plugin.provide("companion:review", async () => {
  const self = await plugin.ask<string | null>("machines:self", null)
  return jobs.list().filter((j) => j.state === "ready for review" && j.terminal).map((j) => {
    const t = terminalOf(j)
    return self && t.endsWith(`@${self}`) ? t.slice(0, -self.length - 1) : t
  })
})
// Knocks: background sessions asking for the user, one line at a pause, and their presences by the notch (core/desktop/knocks.ts).
export const knocks = knockOps(plugin, { toScreens, listening: () => screens.size > 0, jobs: () => jobs.list(), off: () => mode() === "off", hidden: () => plugin.settings().island === false })
export const liveEditing = liveEdits(plugin, {
  jobs,
  ctx: (from) => liveCtx(from),
  say: async (name, text, m) => {
    did(name, "say", undefined, text)
    keepSaid(putNote({ kind: "say", agent: name, text, ...placeOf(m) as Partial<Note>, ...(m.summoned ? { answers: answersOf(m) } : {}) }, sayMs(text)))
    setAgent(name, { state: "watching" })
  },
  seen: (name, why, m) => setAgent(name, { state: "watching", seen: true, why, ...placeOf(m) }),
  ring: (name, boxes) => screenDrawing.draw(name, boxes.map((b) => ({ type: "ring", at: [b.x, b.y, b.w, b.h] }))),
  fallback: (m) => void handOut(m),
  desktop: (name, args) => plugin.desktop(name, args),
})
/** Talking with a job (talks.ts): the floor handed to its worker, the Talk key's words typed into its terminal. */
export const talks = talkOps(plugin, {
  jobs, askOf,
  ctx: (from) => liveCtx(from),
  main: () => ownName(),
  say: async (name, text, m) => {
    did(name, "say", undefined, text)
    keepSaid(putNote({ kind: "say", agent: name, text, ...(m ? placeOf(m) as Partial<Note> : {}), ...(m?.summoned ? { answers: answersOf(m) } : {}) }, sayMs(text)))
    setAgent(name, { state: "watching" })
  },
  tint: (name, tint) => { agentOf(name).tint = tint },
  show: (name, m) => void setAgent(name, m ? { state: "thinking", ...placeOf(m) } : { state: "watching" }),
  gone: (name) => {
    for (const n of [...notes.values()]) if (n.agent === name && !n.by) dropNote(n.id)
    setAgent(name, { state: "away" })
    agents.delete(key(name))
  },
  sees: (name, m) => {
    nearBy.set(key(name), nearBy.get(key(ownName())) ?? [])
    if (m && !moments.includes(m)) { m.seq = nextSeq(); moments.push(m) }
  },
  tags: async (name, tags, said) => { for (const t of tags) await tagAs(name, t, said).catch(() => {}) },
  fallback: (m) => void handOut(m),
})
/** Tag `t` of words `said` by `name` (a job talking): its cursor flies to what it names, or a mark is drawn there. */
async function tagAs(name: string, t: Tag, said: string) {
  if (t.kind === "point") {
    const r = "find" in t.at && !askOf(name)?.path ? await screenFind(name, t.at.find).catch(() => null) : null
    return plugin.host.call("companion.look", { ...(r ? { sx: Math.round(r.x + r.w / 2), sy: Math.round(r.y + r.h / 2) } : tagPlace(t.at)), as: name }, AS_TOOL)
  }
  const mark = markOf(t, beatOf(said, t.offset))
  return mark ? plugin.host.call("companion.draw", { marks: [mark], as: name }, AS_TOOL) : null
}
walkOps(plugin, jobs)
/** A job's proof showing (proofs.ts): its narration said aloud or not, and the displays its helper said it has. */
export let shown: { t: number; voice: boolean; displays: ScreenRectLike[] } | null = null
/** A job's proof (proofs.ts): its ready knock, Show me playing the tour its worker saved, then Keep or Still broken. */
export const proofs = proofOps(plugin, {
  jobs, knocks, tours,
  name: () => ownName(),
  screen: (name, t) => {
    const s = screenOf(name, { vaultite: ownTour(t) })
    // (a thing it names that's gone is said plainly, never played by the model instead)
    return s && { ...s, fallback: async () => false }
  },
  say: (text, o = {}) => plugin.host.call("companion.say", { text, ...(o.ask ? { ask: true } : {}) }, AS_TOOL, { report: "companion job-show" }),
  notHere: async (j, t) => {
    if (!ownTour(t) || !j.where.repo) return ""
    // (on main, wherever it ran: here once this app runs a commit it names, as far as git can tell)
    if (onMain(j)) return ownCode(j) ? await notLive(j) : ""
    if (j.where.machine) return `it ran on ${j.where.label || j.where.machine}, not here`
    return landable(j) && ownCode(j) ? "it's on a branch, not merged into the app you're running" : ""
  },
  choices: async (_j, c) => {
    if (!screens.size || !displaysOf(ownName()).length) return false
    // (answers, no place of their own: one card, its question atop, by the pointer; placed, each was a loose chip on Clear)
    await plugin.host.call("companion.draw", { say: c.say, ...(c.hint ? { hint: c.hint } : {}), marks: c.buttons.map((label) => ({ type: "button", label, do: { ask: label } })) }, AS_TOOL, { report: "companion job-show" })
    return true
  },
  clear: () => { stopFlips(); screenDrawing.clear({ agent: ownName() }) },
  open: (where) => plugin.host.call("companion.open", { path: where }, AS_TOOL, { report: "companion job-show" }),
  // (by the notch over their screen, as the ready card it came from; with no helper, its note in the app, the video on top)
  play: async (video, title, note) => {
    if (screens.size && displaysOf(ownName()).length) {
      await plugin.host.call("companion.draw", { marks: [{ type: "video", src: video, at: { area: "top" }, size: "l", caption: title }] }, AS_TOOL, { report: "companion job-show" })
      return true
    }
    return plugin.host.call("companion.open", { path: note }, AS_TOOL, { report: "companion job-show" }).then(() => true, () => false)
  },
  has: (rel) => fs.existsSync(plugin.vault.abs(rel)),
  record: (id) => {
    const ws = lastScreen && screens.has(lastScreen) ? lastScreen : screens.size === 1 ? [...screens][0] : null
    if (!ws) return false
    send(ws, { t: "record", job: id })
    return true
  },
  urgency: async () => {
    if (setting("job_news") === "off") return "off"
    if (setting("job_news") !== "spoken" || setting("voice") === "off" || await held()) return "normal"
    const block = await plugin.host.call("block.status", {}).then((r) => r.result as { now?: unknown } | null).catch(() => null)
    return block?.now ? "normal" : "high"
  },
  showing: (on) => {
    if (!on) { shown = null; return }
    const ds = Array.isArray(on.displays) ? on.displays.filter((x): x is ScreenRectLike => !!x && typeof x === "object" && ["x", "y", "width", "height"].every((k) => typeof (x as Record<string, unknown>)[k] === "number")).slice(0, 8) : []
    shown = { t: shown?.t ?? Date.now(), voice: on.voice, displays: ds.length ? ds : shown?.displays ?? [] }
  },
  asked: () => askOf(ownName()),
  shown: (j, by) => did(ownName(), "shown", undefined, JSON.stringify({ job: j.id, title: j.title, by })),
})
/** Why job `j`'s change, on main, isn't in the app running here yet ("" when it is, or no commit it names says). */
async function notLive(j: Job) {
  const named = commitsIn([j.result?.text, j.last?.text].filter(Boolean).join("\n"))
  for (const commit of named) {
    const r = await plugin.host.call("app.version", { commit }, AS_TOOL).catch(() => null)
    const v = (r?.result as { live?: { live: boolean; why: string } } | undefined)?.live
    if (v?.live) return ""
    if (v && named.length === 1) return `it's merged, but the app here doesn't run it yet (${v.why.replace(/^[^:]*: /, "")})`
  }
  return ""
}
/** Whether job `j` works on this app's own code (its repo's package is the one running): its change shows here once merged. */
function ownCode(j: Job) {
  const name = (dir: string) => { try { return String(JSON.parse(fs.readFileSync(`${dir}/package.json`, "utf8")).name ?? "") } catch { return "" } }
  const mine = name(ROOT)
  let dir = j.where.cwd.replace(/^~(?=\/|$)/, os.homedir())
  for (let i = 0; i < 4 && dir.length > 1; i++, dir = dir.replace(/\/[^/]+\/?$/, "") || "/") if (fs.existsSync(`${dir}/package.json`)) return !!mine && name(dir) === mine
  return false
}
/** The coding agents it runs, as a terminal names them (claude_agent), and for what (the service "agents-used:companion"):
 *  its chat's while it's on, then its jobs'. `agent-limits` with `for: companion` shows these accounts first. */
plugin.provide("agents-used:companion", (): AgentUse[] => [
  ...(mode() === "off" ? [] : [{ agent: agentSetting(), as: "Companion chat" }]),
  { agent: jobs.jobsAgent(), as: "Jobs" },
])
/** Muted (the inbox held: the menu bar's Mute for an hour): nothing said on its own. */
const held = () => plugin.ask<boolean>("inbox:held", false).catch(() => false)
/** How recent their last Talk key ask must be for a job's news to be said aloud. */
const AROUND_MS = 15 * 60_000
/** A job's news said in its voice, one line, only while they're at this Mac (a Talk key ask to its helper lately: never
 *  aloud at home from a phone's ask) and not in a focus block; else the menu bar's notification waits for them, silent. */
async function jobNews(title: string, state: string, from: string) {
  const text = jobSpoken({ title, state: state as JobState }, from), last = moments.findLast((m) => m.summoned)?.t ?? 0
  if (!text || setting("job_news") !== "spoken" || !jobTold(state, "spoken") || mode() === "off" || setting("voice") === "off" || Date.now() - last > AROUND_MS || await held()) return
  const block = await plugin.host.call("block.status", {}).then((r) => r.result as { now?: unknown } | null).catch(() => null)
  if (block?.now) return
  await plugin.desktop("voice:sample", { text, after: true })
}
