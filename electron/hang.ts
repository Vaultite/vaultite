export type HangSample = { at: number; stack: string; cpuSeconds: number | null; memoryMB: number | null }
import { z } from "zod"

export const LONG_FRAME_LIST = z.array(z.object({ ms: z.number(), blockingMs: z.number(), scripts: z.array(z.object({ ms: z.number(), where: z.string() })) }))
export type LongFrame = z.infer<typeof LONG_FRAME_LIST>[number]
export type Machine = { load: number; freeMB: number; totalMB: number }
export type HangEnd = "recovered" | "reloaded" | "gone" | "still"
export type Hang = { since: number; samples: HangSample[] }

export const SAMPLE_EVERY_MS = 3000
export const MAX_SAMPLES = 10

export const hangStarted = (now: number): Hang => ({ since: now, samples: [] })
export const sampled = (h: Hang, s: HangSample): Hang => (h.samples.length >= MAX_SAMPLES ? h : { ...h, samples: [...h.samples, s] })

const cause = (stacks: string[], cpu: number | null) =>
  stacks.length ? "in its script" : cpu === null ? "its script's stack unknown" : cpu >= 50 ? "busy outside its script: layout, style or garbage collection" : "idle: waiting on something"

const ENDS: Record<HangEnd, string> = { recovered: "then came back", reloaded: "until it was reloaded", gone: "until its window closed", still: "and still not" }

export function hangReport(name: string, h: Hang, end: { at: number; how: HangEnd }, machine: Machine, frames: LongFrame[]) {
  const counts = new Map<string, number>()
  for (const s of h.samples) if (s.stack.trim()) counts.set(s.stack.trim(), (counts.get(s.stack.trim()) ?? 0) + 1)
  const stacks = [...counts].sort((a, b) => b[1] - a[1]).map(([stack]) => stack)
  const timed = h.samples.filter((s) => s.cpuSeconds !== null)
  const first = timed[0], last = timed.at(-1)
  const cpu = first && last && last.at - first.at >= 1000 ? Math.round((100 * ((last.cpuSeconds ?? 0) - (first.cpuSeconds ?? 0))) / ((last.at - first.at) / 1000)) : null
  const memory = Math.max(0, ...h.samples.map((s) => s.memoryMB ?? 0))
  const seconds = Math.round((end.at - h.since) / 1000)
  const lines = [
    ...stacks.flatMap((s, i) => [...(i ? [`also, ${counts.get(s)} of ${h.samples.length} times:`] : []), s]),
    `${seconds} s, ${ENDS[end.how]}; ${h.samples.length} looks, ${stacks.length ? `a script running in ${[...counts.values()].reduce((a, b) => a + b, 0)}` : "no script running in any"}`,
    `its renderer: ${cpu === null ? "CPU unknown" : `${cpu}% CPU`}${memory ? `, ${memory} MB` : ""}`,
    `this machine: load ${machine.load.toFixed(1)}, ${machine.freeMB} of ${machine.totalMB} MB free`,
    ...frames.slice(0, 3).flatMap((f) => [`a ${Math.round(f.ms)} ms frame (${Math.round(f.blockingMs)} ms blocking)${f.scripts.length ? ":" : ", no script in it"}`,
      ...f.scripts.slice(0, 5).map((s) => `  ${Math.round(s.ms)} ms ${s.where}`)]),
  ]
  return { message: `${name}'s page stopped responding (${cause(stacks, cpu)})`, stack: lines.join("\n") }
}

export const LONG_FRAMES = `new Promise((done) => {
  if (!PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) return done([])
  const seen = []
  const o = new PerformanceObserver((l) => seen.push(...l.getEntries()))
  o.observe({ type: "long-animation-frame", buffered: true })
  setTimeout(() => {
    o.disconnect()
    done([...seen, ...o.takeRecords()].filter((f) => f.duration >= 1000).sort((a, b) => b.duration - a.duration).slice(0, 3)
      .map((f) => ({ ms: f.duration, blockingMs: f.blockingDuration, scripts: [...f.scripts].sort((a, b) => b.duration - a.duration)
        .map((s) => ({ ms: s.duration, where: [s.invoker, s.sourceFunctionName, s.sourceURL && s.sourceURL + ":" + s.sourceCharPosition].filter(Boolean).join(" ") })) })))
  }, 200)
})`
