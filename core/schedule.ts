// Jobs on a timer: plugin.every's and a vault plugin's manifest `schedule` (a command or any op: a note dispatched to
// Claude each morning). One machine runs each (Machines' first unless it names one); when they last ran stays on it.
import fs from "node:fs"
import { type Op, OpError } from "./ops.ts"
import { writeAtomic } from "./vault.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Item = Record<string, any>

/** When a job runs: `every` "15m", "2h", "1d", "1w"; `at` "07:00" (this machine's time) with whole days; `machine` the
 *  Machines id that runs it. */
export type When = { every: string; at?: string; machine?: string }
export type Job = When & { name: string; run: () => unknown }
/** A job as the scheduler sees it: its plugin's id with it. */
export type Listed = { plugin: string; job: Job }
/** What the last run did, kept on this machine (`for`: the time it was due, an `at` job's slot). */
type Last = { seen: number; ran?: number; for?: number; ms?: number; error?: string }

const UNIT: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }
const DAY = UNIT.d, TICK = 30_000, SLACK = 3 * 3_600_000 // (a day's slot may move an hour with summer time)

/** `every` in ms, or null. */
export function periodOf(every: unknown): number | null {
  const m = typeof every === "string" ? /^(\d+)\s*([mhdw])$/.exec(every.trim()) : null
  return m && Number(m[1]) > 0 ? Number(m[1]) * UNIT[m[2]] : null
}

/** What's wrong with a job's timing, or []. */
export function whenProblems(w: Item, where = "schedule"): string[] {
  const out: string[] = []
  const ms = periodOf(w.every)
  if (ms === null) out.push(`${where}: every is a number and a unit, m, h, d or w ("15m", "1d"), not ${JSON.stringify(w.every)}`)
  if (w.at !== undefined) {
    if (typeof w.at !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(w.at)) out.push(`${where}: at is a time of day, HH:MM ("07:00")`)
    else if (ms !== null && ms % DAY) out.push(`${where}: at needs every in whole days ("1d", "1w")`)
  }
  if (w.machine !== undefined && (typeof w.machine !== "string" || !w.machine.trim())) out.push(`${where}: machine is a Machines id ("home")`)
  return out
}

/** The first `at` (HH:MM, local) after t. */
function slotAfter(t: number, at: string) {
  const d = new Date(t)
  d.setHours(Number(at.slice(0, 2)), Number(at.slice(3)), 0, 0)
  while (d.getTime() <= t) d.setDate(d.getDate() + 1)
  return d.getTime()
}

/** The last `at` at or before t. */
function slotBefore(t: number, at: string) {
  const d = new Date(slotAfter(t, at))
  d.setDate(d.getDate() - 1)
  return d.getTime()
}

/** When a job is next due: an interval's after its last run (at once the first time), an `at` job's next slot. */
export function nextRun(w: When, last: Last) {
  const ms = periodOf(w.every)!
  if (!w.at) return last.ran === undefined ? last.seen : last.ran + ms
  return slotAfter(last.for === undefined ? last.seen : last.for + ms - SLACK, w.at)
}

export type Row = { id: string; plugin: string; name: string; every: string; at: string | null; machine: string | null
  here: boolean; next: string | null; ran: string | null; ms: number | null; error: string | null; running: boolean }

export class Scheduler {
  private file: string
  private jobs: () => Listed[]
  private here: (machine?: string) => Promise<boolean>
  private before: () => Promise<unknown>
  private state: Record<string, Last> = {}
  private running = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null

  /** `file`: where last runs are kept on this machine; `jobs`: the ones of the plugins that are on; `here`: whether this
   *  machine runs a job naming `machine`; `before`: run before each tick (load the vault's plugins). */
  constructor(o: { file: string; jobs: () => Listed[]; here: (machine?: string) => Promise<boolean>; before?: () => Promise<unknown> }) {
    this.file = o.file; this.jobs = o.jobs; this.here = o.here; this.before = o.before ?? (async () => {})
    try { this.state = JSON.parse(fs.readFileSync(this.file, "utf8")) } catch { /* none yet */ }
  }

  start() {
    this.timer ??= setInterval(() => void this.tick().catch((e) => console.error("schedule:", e)), TICK)
    this.timer.unref()
    setTimeout(() => void this.tick().catch((e) => console.error("schedule:", e)), 5000).unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private last(key: string, now: number) {
    return (this.state[key] ??= { seen: now })
  }

  /** Run what's due here now (each once at a time). */
  async tick(now = Date.now()) {
    await this.before()
    const due: Promise<unknown>[] = []
    for (const { plugin, job } of this.jobs()) {
      const key = `${plugin}/${job.name}`
      if (this.running.has(key) || nextRun(job, this.last(key, now)) > now || !(await this.here(job.machine))) continue
      due.push(this.run(key, job, now))
    }
    this.save()
    await Promise.all(due)
  }

  private async run(key: string, job: Job, now = Date.now()) {
    this.running.add(key)
    const t0 = performance.now()
    let error: string | undefined
    try {
      await job.run()
    } catch (e) {
      error = String((e as Error)?.message ?? e).slice(0, 500)
      console.error(`schedule ${key}: ${error}`)
    } finally {
      this.running.delete(key)
    }
    this.state[key] = { seen: this.last(key, now).seen, ran: now, for: job.at ? slotBefore(now + 1, job.at) : now, ms: Math.round(performance.now() - t0), ...(error ? { error } : {}) }
    this.save()
    return error
  }

  private save() {
    try {
      writeAtomic(this.file, JSON.stringify(this.state))
    } catch (e) {
      console.error("schedule: couldn't keep its last runs:", e)
    }
  }

  async list(now = Date.now()): Promise<Row[]> {
    const iso = (t: number | undefined) => (t === undefined ? null : new Date(t).toISOString())
    return Promise.all(this.jobs().map(async ({ plugin, job }) => {
      const key = `${plugin}/${job.name}`, last = this.state[key] ?? { seen: now }
      const here = await this.here(job.machine)
      return { id: key, plugin, name: job.name, every: job.every, at: job.at ?? null, machine: job.machine ?? null, here,
        next: here ? iso(Math.max(now, nextRun(job, last))) : null, ran: iso(last.ran), ms: last.ms ?? null, error: last.error ?? null, running: this.running.has(key) }
    }))
  }

  /** Run a job now, wherever it's meant to run: its error, or null. */
  async runNow(id: string) {
    const hit = this.jobs().find(({ plugin, job }) => `${plugin}/${job.name}` === id)
    if (!hit) throw new OpError(`no job '${id}' (vau schedule list)`, 404)
    if (this.running.has(id)) throw new OpError(`${id} is running`, 409)
    return (await this.run(id, hit.job)) ?? null
  }
}

/** The scheduler's operations. */
export function scheduleOps(scheduler: () => Scheduler): Op[] {
  const when = (r: Row) => `every ${r.every}${r.at ? ` at ${r.at}` : ""}`
  return [{
    id: "schedule.list",
    cli: "schedule list",
    summary: "The jobs on a timer (plugins' schedules): when each runs, on which machine, when it last ran and how.",
    kind: "read",
    run: () => scheduler().list(),
    text: (rows: Row[]) => rows.length ? rows.map((r) => `- ${r.id}: ${when(r)}${r.machine ? ` on ${r.machine}` : ""}; ${r.running ? "running"
      : r.here ? `next ${r.next}` : "another machine runs it"}${r.ran ? `; last ${r.ran} (${r.error ? `failed: ${r.error}` : `${r.ms} ms`})` : ""}`).join("\n")
      : "No plugin has a schedule.",
  }, {
    id: "schedule.run",
    cli: "schedule run",
    summary: "Run a job of the schedule now, on this machine (to try it): its error, or null.",
    kind: "write",
    lock: false,
    owner: "scheduled jobs",
    params: { id: { type: "string", required: true, description: "the job, <plugin>/<name> (vau schedule list)" } },
    args: ["id"],
    run: ({ id }) => scheduler().runNow(id),
    text: (error: string | null, { id }) => (error ? `${id} failed: ${error}` : `Ran ${id}.`),
  }]
}
