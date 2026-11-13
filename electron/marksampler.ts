// The screen under the companion's marks (helper.ts'), sampled small and grey only while a mark that points is up:
// what changed there is told the server, a mark on a thing that moved follows it (markwatch.ts reckons both).
import type { Seen } from "../core/desktop/anchor.ts"
import type { Drawing } from "./drawing.ts"
import { type Area, followed as thingFollowed, makeWatch, type On, SAMPLE_MS, sampleFrom, sampleSize, watchedAreas } from "./markwatch.ts"
import { overlayNumbers } from "./overlaywin.ts"
import type { Point } from "./helperlogic.ts"
import type { Ask } from "./cursorplaces.ts"
import { SAMPLES } from "./screenwire.ts"

export function markSampler(o: { ask: Ask; things: (p: Point, radius: number, most: number) => Promise<Seen[]>; near: () => (Seen & { id?: string })[]; say: (m: object) => void }) {
  const watch = makeWatch(), anchored = new Map<string, On | null>(), lookedAt = new Map<string, number>(), followedTo = new Set<string>()
  let areas: Area[] = [], sampling: ReturnType<typeof setInterval> | null = null, sampleBusy = false, sampleAgain = false, layersUp: Drawing[] = []
  function layersChanged(ls: Drawing[]) {
    layersUp = ls
    areas = watchedAreas(ls, o.near(), anchored)
    watch.keep(new Set(areas.map((a) => a.key)))
    const alive = new Set(areas.map((a) => `${a.layer}/${a.mark}`))
    for (const k of anchored.keys()) if (!alive.has(k)) anchored.delete(k)
    for (const k of followedTo) if (!alive.has(k)) followedTo.delete(k)
    for (const k of lookedAt.keys()) if (!areas.some((a) => a.key === k)) lookedAt.delete(k)
    // (a new mark's first picture at once: what's compared with is the screen as it came)
    if (areas.some((a) => !watch.has(a.key))) void sampleMarks()
    if (areas.length && !sampling) sampling = setInterval(() => void sampleMarks(), SAMPLE_MS)
    if (!areas.length && sampling) { clearInterval(sampling); sampling = null }
  }
  async function sampleMarks() {
    if (sampleBusy) { sampleAgain = true; return }
    if (!areas.length) return
    sampleBusy = true
    try {
      const now = areas
      const r = await o.ask("sample", { areas: now.map((a) => ({ x: a.rect.x, y: a.rect.y, width: a.rect.w, height: a.rect.h, ...sampleSize(a.rect) })), exclude: overlayNumbers() }, SAMPLES)
      // (no screen recording: nothing to watch with, till the marks change)
      if (r.ok === false) { areas = []; if (sampling) clearInterval(sampling); sampling = null; return }
      const gone = new Map<string, string[]>(), moves = new Map<string, { mark: string; dx: number; dy: number }[]>(), told = new Set<string>()
      const add = <T,>(m: Map<string, T[]>, k: string, v: T) => { m.set(k, [...(m.get(k) ?? []), v]); }
      for (const [i, a] of now.entries()) {
        const s = sampleFrom(r.samples?.[i]), said = s && watch.saw(a, s)
        if (!said) continue
        // (on a thing: it moved, the mark follows, even mid-scroll; anything else held there, it fades)
        if (a.on && (said === "changed" || Date.now() - (lookedAt.get(a.key) ?? 0) >= 900)) {
          lookedAt.set(a.key, Date.now())
          const f = thingFollowed(a, await o.things({ x: a.rect.x + a.rect.w / 2, y: a.rect.y + a.rect.h / 2 }, 1500, 250))
          const id = `${a.layer}/${a.mark}`
          if (f.kind === "moved") { add(moves, a.layer, { mark: a.mark, dx: f.dx, dy: f.dy }); told.add(a.key); followedTo.add(id); continue }
          // (just followed there: its first picture was mid-move, this is how its place looks)
          if (f.kind === "stayed" && said === "changed" && followedTo.delete(id)) { watch.settled(a); continue }
        }
        if (said === "changed") { add(gone, a.layer, a.mark); told.add(a.key) }
      }
      // (told once: the server's answer brings the layer back as it is now)
      if (told.size) areas = areas.filter((a) => !told.has(a.key))
      for (const [id, marks] of gone) o.say({ t: "drawing-act", id, kind: "changed", marks: [...new Set(marks)] })
      for (const [id, ms] of moves) o.say({ t: "drawing-act", id, kind: "moved", moves: ms.filter((m, i) => ms.findIndex((x) => x.mark === m.mark) === i) })
    } finally {
      sampleBusy = false
      if (sampleAgain) { sampleAgain = false; if (areas.some((a) => !watch.has(a.key))) void sampleMarks() }
    }
  }

  return {
    changed: layersChanged,
    layers: () => layersUp,
    areas: () => areas,
    stop() { if (sampling) clearInterval(sampling); sampling = null },
  }
}
