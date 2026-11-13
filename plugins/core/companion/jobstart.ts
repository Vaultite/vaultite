import { type Machine, type OpCtx, type Plugin, type Who } from "../../../core/plugins.ts"
import { type Handoff, inPlace, type Job, jobTask, messageOf, type Queued, str, type Where, worktreeOf } from "./jobs.ts"
import type { JobEvent } from "./joblife.ts"
import type { Machines } from "./jobmachines.ts"
import type { jobPlaces } from "./jobplace.ts"
import type { Tell } from "./jobtell.ts"
import { COMPANION } from "./jobtold.ts"
import { cut } from "./jobword.ts"
import type { workerLinks } from "./links.ts"
import type { JobAsk } from "./types.ts"
import { surfaceOf, tilde } from "./where.ts"

const newId = () => `j${Array.from({ length: 7 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")}`

export type StartDeps = {
  all: () => Job[]; changed: () => void; move: (j: Job, ev: JobEvent, t?: number) => boolean; links: ReturnType<typeof workerLinks>
  machines: Machines; places: ReturnType<typeof jobPlaces>; appCtx: (by?: Who) => OpCtx; tell: Tell
}

export function jobStarts(plugin: Plugin, o: StartDeps) {
  const { all, changed, move, links, appCtx } = o, { away, labelOf, harnessOf, lands, proofMode } = o.machines, { route, placedWith } = o.places
  const { trust, startOf, steer, land, retitle } = o.tell
  async function accountThere(ctx: OpCtx, machine: string, p: Handoff) {
    const account = str(p.account).trim().toLowerCase()
    if (!account || account === "default") return
    await links.of({ machine }).there(ctx, "claude-code.limits", { account }, 10)
  }
  function keep(j: Job, q: Queued) {
    const same = (a: string) => a.replace(/\s+/g, " ").trim().toLowerCase()
    if (j.queued?.some((x) => x.note.split("\n").some((n) => same(n) === same(q.note)))) return false
    const start = j.queued?.find((x) => x.start)
    if (start && !q.land) start.text = `${start.text}\n\nAlso: ${q.text}`
    if (start && !q.land) start.note = `${start.note}\n${q.note}`
    else (j.queued ??= []).push(q)
    if (q.title && start) j.title = q.title.replace(/\s+/g, " ").trim().slice(0, 80)
    changed()
    return true
  }
  let flushing = false
  async function flush() {
    const waiting = all().filter((j) => j.queued?.length && j.state !== "stopped")
    if (flushing || !waiting.length) return
    flushing = true
    try {
      for (const j of waiting) {
        const m = await plugin.ask<Machine | null>("machines:machine", null, j.where.machine).catch(() => null)
        if (!m?.online) continue
        while (j.queued?.length) {
          const q = j.queued[0], ctx = appCtx(q.by)
          try {
            if (q.start) await startWaiting(ctx, j, q)
            else if (q.land) await land(ctx, j, q.text, q.shown, q.teller)
            else await steer(ctx, j, q.text, q.shown, q.teller)
            if (q.title && !q.start) await retitle(ctx, j, q.title)
            j.queued.shift()
          } catch (e) {
            if (await away(j.where.machine, e)) break
            j.queued.shift()
            const why = messageOf(e)
            if (q.start) { j.now = why; move(j, "error") } else j.now = `Couldn't pass on "${cut(q.note, 60)}": ${why}`
          }
          changed()
        }
        if (!j.queued?.length) { delete j.queued; changed() }
      }
    } finally { flushing = false }
  }
  async function startWaiting(ctx: OpCtx, j: Job, q: Queued) {
    const p = q.start ?? {}
    j.where = await placedWith(await route(q.ask, p), p)
    await accountThere(ctx, j.where.machine, p)
    await launch(ctx, j, q.text, q.ask, p)
  }
  async function begin(ctx: OpCtx, task: string | ((w: Where) => Promise<string>), m: JobAsk | undefined, p: Handoff, by = COMPANION) {
    const titleOf = (told: string) => (str(p.title).trim() || told.replace(/\s+/g, " ")).slice(0, 80).replace(/^(.{60,}?)\s.*$/, "$1…")
    const asked = str(p.machine).trim()
    let where: Where
    try {
      where = await placedWith(await route(m, p), p)
      await accountThere(ctx, where.machine, p)
    } catch (e) {
      if (typeof task === "string" && await away(asked, e)) return await waitFor(ctx, task, titleOf(task), m, p, asked, by)
      throw e
    }
    const told = typeof task === "string" ? task : await task(where)
    const now = Date.now()
    const j: Job = { id: newId(), title: titleOf(told), state: "starting", where, terminal: "", now: "", ...(m ? { asked: m.t } : {}), started: now, turn: now, at: now, seen: false, log: [], by }
    all().unshift(j)
    try { await launch(ctx, j, told, m, p) } catch (e) {
      if (typeof task !== "string" || !await away(where.machine, e)) throw e
      all().splice(all().indexOf(j), 1)
      return await waitFor(ctx, task, j.title, m, p, where.machine, by)
    }
    return j
  }
  async function waitFor(ctx: OpCtx, task: string, title: string, m: JobAsk | undefined, p: Handoff, machine: string, by: string) {
    const now = Date.now(), label = await labelOf(machine), { say: _, ...start } = p
    const where: Where = { machine, label, cwd: str(p.cwd), repo: "", why: `${label} is offline: it starts once it's back`, ...await harnessOf(p) }
    const j: Job = { id: newId(), title, state: "waiting", where, terminal: "", now: `Waiting for ${label} to come back`, ...(m ? { asked: m.t } : {}), started: now, turn: now, at: now,
      seen: false, log: [], by, queued: [{ note: task, text: task, at: now, start: { ...start, machine }, ...(m ? { ask: m } : {}), by: ctx.who, teller: by }] }
    all().unshift(j)
    j.carded = now
    changed()
    return j
  }
  async function launch(ctx: OpCtx, j: Job, told: string, m: JobAsk | undefined, p: Handoff) {
    const where = j.where
    const on = typeof p.on === "string" ? p.on : surfaceOf(m)
    if (on) j.on = on
    if (inPlace(where) && !where.cloud) where.watched = true
    else if (where.repo) Object.assign(where, where.cloud ? {} : worktreeOf(where.cwd, where.repo, j.id), lands() ? { lands: true } : {})
    j.now = `starting in ${tilde(where.cwd)}`
    await trust(ctx, j)
    const task = jobTask(told, m, where, j.id, { land: lands(), proof: proofMode() })
    try {
      const link = links.of(where)
      j.terminal = await link.start(ctx, startOf(j, { prompt: await link.carry(task) }))
    } catch (e) {
      if (!await away(where.machine, e)) { j.now = messageOf(e); move(j, "error"); changed() }
      throw e
    }
    move(j, "start")
    j.carded = Date.now()
    changed()
    return j
  }
  return { keep, flush, begin }
}
