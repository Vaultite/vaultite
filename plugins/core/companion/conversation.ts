// The Companion page's conversation: what the user asked it (a Talk key's press, an @name in a note) and what it
// answered and did, a day at a time, from its logs (moments, actions) and the helper's press log. Plain functions.
import type { Act, Moment } from "./plugin.ts"

/** A press log line (electron/presslog.ts): its steps, `end` with its outcome, `sound` once heard. */
export type PressLine = { t: number; press: string; kind: string; ev: string; ms?: number; [k: string]: unknown }
export type Exchange = {
  t: number; seq: number; kind: string; text: string
  /** Where they asked: the app and window, or the note. */
  where: string; voice: boolean; summoned: boolean
  /** What it said back, and what else it did (its ops, in order; `results`: what each tool answered, with its ids). */
  said: string[]; did: string[]; results?: string[]
  /** Seconds from their ask to its first word and to its end. */
  word?: number; total?: number
  /** The press it came from (its steps, for Details), its picture, whether its audio was kept. */
  press?: { id: string; steps: PressLine[]; cost?: number }
  shot?: string
}

/** What its acts' ops say in a word. */
const DOES: Record<string, string> = { look: "pointed", draw: "drew", highlight: "highlighted", act: "acted", open: "opened", handoff: "handed off",
  edit: "wrote", comment: "commented", suggest: "suggested", propose: "proposed", follow: "followed", see: "looked at a pane", clear: "cleared" }
const NOT_SHOWN = new Set(["next", "handed", "sent", "done", "again", "word", "say", "pass", "stopped", "result", "withdrawn", "talked"])
const ASKS = new Set(["ask", "point", "reply"])

/** A press's cost in dollars, where its steps say one (the realtime voice's turns). */
const costOf = (steps: PressLine[]) => { const c = steps.reduce((s, x) => s + (typeof x.cost === "number" ? x.cost : 0), 0); return c > 0 ? c : undefined }

/** The day's exchanges, oldest first: each ask, its answer and acts until the next ask, the press that sent it (a press
 *  ended "sent" in the 3 s before its moment). */
export function exchanges(ms: Moment[], allActs: Act[], presses: PressLine[], name: string): Exchange[] {
  // (its own: asks for it (or for no one, a point), and what it did, summoned or not; @ada's are Ada's)
  const mine = (as: string) => as === name || as.startsWith(`${name} (`)
  const acts = allActs.filter((a) => mine(a.as))
  // (small talk the realtime voice answered alone is an act, `talked`: their words and its, as JSON)
  const talked = acts.filter((a) => a.op === "talked" && a.text).flatMap((a) => { try { const x = JSON.parse(a.text!); return [{ t: a.t, heard: String(x.heard ?? ""), said: String(x.said ?? "") }] } catch { return [] } })
  const asks: (Moment | { t: number; seq: number; kind: string; text: string; summoned: true; voice: true; talked: string })[] = [
    ...ms.filter((m) => ASKS.has(m.kind) && !m.again && (!m.for || m.for === name)),
    ...talked.map((x) => ({ t: x.t, seq: -1, kind: "ask", text: x.heard, summoned: true as const, voice: true as const, talked: x.said })),
  ].sort((a, b) => a.t - b.t)
  const byPress = new Map<string, PressLine[]>()
  for (const l of presses) byPress.set(l.press, [...(byPress.get(l.press) ?? []), l])
  const sent = [...byPress.values()].flatMap((steps) => { const end = steps.find((s) => s.ev === "end" && s.outcome === "sent"); return end ? [{ end, steps }] : [] })
  const used = new Set<string>()
  return asks.map((m, i) => {
    const until = asks[i + 1]?.t ?? Infinity, all = acts.filter((a) => a.t >= m.t && a.t < until)
    // (an answer withdrawn, the realtime voice's said instead: only what came after counts)
    const cut = all.findLastIndex((a) => a.op === "withdrawn"), mine = cut >= 0 ? all.slice(cut + 1) : all
    const handed = all.find((a) => a.op === "handed" || a.op === "sent"), word = mine.find((a) => a.op === "word" || a.op === "say"), done = all.filter((a) => a.op === "done" || a.op === "next").at(-1)
    // (small talk's act comes once the realtime voice answered, seconds after the let-go)
    const win = "talked" in m ? 15_000 : 3000, p = m.summoned ? sent.find((x) => !used.has(x.end.press) && x.end.t <= m.t && m.t - x.end.t < win) : undefined
    if (p) used.add(p.end.press)
    const w = m as Moment & { app?: string; title?: string; shot?: string }, results = mine.filter((a) => a.op === "result" && a.text).map((a) => a.text!)
    return {
      t: m.t, seq: m.seq, kind: m.kind, text: m.text ?? "", summoned: !!m.summoned, voice: !!m.voice,
      where: w.title ? `${w.title}${w.app ? ` (${w.app})` : ""}` : "path" in m && m.path ? `${m.path.replace(/\.md$/, "")}${m.line ? `, line ${m.line}` : ""}` : "",
      said: "talked" in m ? [m.talked] : mine.filter((a) => a.op === "say" && a.text).map((a) => a.text!),
      did: [...new Set(mine.filter((a) => !NOT_SHOWN.has(a.op)).map((a) => DOES[a.op] ?? a.op))],
      ...(results.length ? { results } : {}),
      ...(handed && word ? { word: Math.max(0, (word.t - m.t) / 1000) } : {}), ...(done ? { total: (done.t - m.t) / 1000 } : {}),
      ...(p ? { press: { id: p.end.press, steps: p.steps, ...(costOf(p.steps) ? { cost: costOf(p.steps) } : {}) } } : {}),
      ...(w.shot ? { shot: w.shot } : {}),
    }
  })
}

/** How long ago `t` was, in words a model reads at a glance. */
const ago = (now: number, t: number) => { const m = Math.round((now - t) / 60_000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago` }
const one = (s: string, n: number) => { const x = s.replace(/\s+/g, " ").trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x }
/** The talk so far, as a fresh session is told it: exchanges (oldest first), the newest `whole` as they went, older ones
 *  cut short, the oldest left out past `budget` chars. Empty when there's none. */
export function talkSoFar(xs: Exchange[], now: number, budget = 6000, whole = 8): string {
  const lines: string[] = []
  let used = 0
  for (let i = xs.length - 1; i >= 0; i--) {
    const e = xs[i], n = xs.length - 1 - i < whole ? 600 : 160
    const did = [...(e.results ?? []).map((r) => one(r, n === 600 ? 300 : 120)), ...(e.results?.length ? [] : e.did)]
    const line = [`- ${ago(now, e.t)}${e.where ? `, in ${one(e.where, 80)}` : ""}, they ${e.voice ? "said" : "asked"}: ${one(e.text, n) || "(pointed, no words)"}`,
      ...(e.said.length ? [`  you: ${one(e.said.join(" "), n)}`] : []), ...(did.length ? [`  you did: ${did.join("; ")}`] : [])].join("\n")
    if (used + line.length > budget) break
    lines.unshift(line); used += line.length + 1
  }
  return lines.join("\n")
}

/** Soniox's real-time price, dollars a second of speech. */
const SONIOX_PER_S = 0.12 / 3600
export type Spent = { service: string; uses: number; seconds?: number; cost?: number }
/** The day's use by service, counted from its presses (what Vaultite saw itself): the ears' seconds (Soniox's priced),
 *  the realtime voice's cost as OpenAI billed it, the answers each voice spoke. */
export function spent(presses: PressLine[]): Spent[] {
  const by = new Map<string, Spent>(), add = (service: string, f: (x: Spent) => void) => { const x = by.get(service) ?? { service, uses: 0 }; f(x); by.set(service, x) }
  const engine = new Map<string, string>(), began = new Map<string, number>()
  for (const l of presses) {
    if (l.ev === "stt" && typeof l.engine === "string") engine.set(l.press, l.engine)
    if (l.ev === "stt-start") began.set(l.press, Number(l.ms) || 0)
    if (l.ev === "stt-end" && engine.has(l.press)) {
      const e = engine.get(l.press)!, s = Math.max(0, ((Number(l.ms) || 0) - (began.get(l.press) ?? 0)) / 1000)
      add(e, (x) => { x.uses++; x.seconds = (x.seconds ?? 0) + s; if (e === "soniox") x.cost = (x.cost ?? 0) + s * SONIOX_PER_S })
    }
    if (typeof l.cost === "number" && l.cost > 0) add("openai", (x) => { x.uses++; x.cost = (x.cost ?? 0) + (l.cost as number) })
    if (l.ev === "sound" && typeof l.by === "string") add(l.by, (x) => { x.uses++ })
  }
  return [...by.values()]
}
