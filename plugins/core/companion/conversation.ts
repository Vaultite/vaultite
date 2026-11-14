import { z } from "zod"
import { parseJson } from "../../../core/agents.ts"
import type { Act, Moment } from "./types.ts"

export type PressLine = { t: number; press: string; kind: string; ev: string; ms?: number; [k: string]: unknown }
export type Exchange = {
  t: number; seq: number; kind: string; text: string
  where: string; voice: boolean; summoned: boolean
  said: string[]; did: string[]; results?: string[]
  word?: number; total?: number
  press?: { id: string; steps: PressLine[]; cost?: number }
  shot?: string
  edit?: { added: number; removed: number }
}

const DOES: Record<string, string> = { look: "pointed", draw: "drew", highlight: "highlighted", act: "acted", open: "opened", handoff: "handed off",
  edit: "wrote", comment: "commented", suggest: "suggested", propose: "proposed", follow: "followed", see: "looked at a pane", clear: "cleared" }
const NOT_SHOWN = new Set(["next", "handed", "sent", "done", "again", "word", "say", "pass", "stopped", "result", "withdrawn", "talked"])
const ASKS = new Set(["ask", "point", "reply"])
const REACTS = new Set(["edit", "accept", "reject", "dismiss"])
const ANSWERING_MS = 120_000
const WHERE = new Set(["look", "draw"])
const Shown = z.object({ title: z.unknown().optional(), job: z.unknown().optional() })
const Talked = z.object({ heard: z.unknown().optional(), said: z.unknown().optional() })
type Heard = { t: number; seq: number; kind: string; text: string; summoned: boolean; voice: true; talked?: string; app?: undefined; title?: undefined; shot?: undefined }
const proofOf = (a: Act): Heard | null => { const x = parseJson(a.text ?? "", Shown); return x ? { t: a.t, seq: -1, kind: "shown", text: `Show me: ${String(x.title ?? x.job ?? "a job")}`, summoned: false, voice: true } : null }

const costOf = (steps: PressLine[]) => { const c = steps.reduce((s, x) => s + (typeof x.cost === "number" ? x.cost : 0), 0); return c > 0 ? c : undefined }

function editOf(ms: Moment[]) {
  const hunks = ms.flatMap((m) => m.hunks ?? []), added = hunks.flatMap((h) => h.added), removed = hunks.flatMap((h) => h.removed)
  const changes = ms.flatMap((m) => m.changes ?? []), lines = (added.length ? added : removed.length ? removed : changes).map((l) => l.trim()).filter(Boolean)
  return { text: lines.join("\n").slice(0, 600), edit: { added: added.length, removed: removed.length } }
}

type Reacted = Moment & { edit?: Exchange["edit"] }
function reactions(ms: Moment[], asks: { t: number }[], acts: Act[], o: { reactions?: boolean } | undefined): Reacted[] {
  if (!o?.reactions) return []
  const answered = (from: number, to: number) => acts.some((a) => a.t >= from && a.t < to && (a.op === "done" || a.op === "next"))
  const out: { m: Moment; burst: Moment[] }[] = []
  for (const m of ms.filter((x) => REACTS.has(x.kind) && !x.scene).sort((a, b) => a.t - b.t)) {
    const ask = asks.findLast((a) => a.t <= m.t), last = out.at(-1)
    if (ask && m.t - ask.t < ANSWERING_MS && !answered(ask.t, m.t) && (!last || last.m.t < ask.t)) continue
    if (last && m.kind === "edit" && last.m.kind === "edit" && last.m.path === m.path && m.t - last.m.t < ANSWERING_MS && !answered(last.m.t, m.t) && !asks.some((a) => a.t > last.m.t && a.t <= m.t)) { last.burst.push(m); continue }
    out.push({ m, burst: [m] })
  }
  return out.map(({ m, burst }) => (m.kind === "edit" ? { ...m, ...editOf(burst) } : m))
}

const answeredOnly = (xs: Exchange[], asks: (Moment | Heard | Reacted)[]) => xs.flatMap((e, i) => {
  const m = asks[i]
  if (REACTS.has(e.kind) && !e.said.length && !e.did.some((d) => d !== "pointed")) return []
  return "edit" in m && m.edit ? [{ ...e, edit: m.edit }] : [e]
})

export function exchanges(ms: Moment[], allActs: Act[], presses: PressLine[], name: string, o?: { reactions?: boolean }): Exchange[] {
  const mine = (as: string) => as === name || as.startsWith(`${name} (`)
  const acts = allActs.filter((a) => mine(a.as))
  const talked = acts.filter((a) => a.op === "talked" && a.text).flatMap((a) => { const x = parseJson(a.text, Talked); return x ? [{ t: a.t, heard: String(x.heard ?? ""), said: String(x.said ?? "") }] : [] })
  const asked: (Moment | Heard)[] = [
    ...ms.filter((m) => ASKS.has(m.kind) && !m.again && (!m.for || m.for === name)),
    ...talked.map((x) => ({ t: x.t, seq: -1, kind: "ask", text: x.heard, summoned: true as const, voice: true as const, talked: x.said })),
    ...acts.filter((a) => a.op === "shown").flatMap((a) => proofOf(a) ?? []),
  ].sort((a, b) => a.t - b.t)
  const asks: (Moment | Heard | Reacted)[] = [...asked, ...reactions(ms, asked, acts, o)].sort((a, b) => a.t - b.t)
  const byPress = new Map<string, PressLine[]>()
  for (const l of presses) byPress.set(l.press, [...(byPress.get(l.press) ?? []), l])
  const sent = [...byPress.values()].flatMap((steps) => { const end = steps.find((s) => s.ev === "end" && s.outcome === "sent"); return end ? [{ end, steps }] : [] })
  const used = new Set<string>()
  return answeredOnly(asks.map((m, i) => {
    const until = asks[i + 1]?.t ?? Infinity, all = acts.filter((a) => a.t >= m.t && a.t < until)
    const cut = all.findLastIndex((a) => a.op === "withdrawn"), mine = cut >= 0 ? all.slice(cut + 1) : all
    const handed = all.find((a) => a.op === "handed" || a.op === "sent"), word = mine.find((a) => a.op === "word" || a.op === "say"), done = all.filter((a) => a.op === "done" || a.op === "next").at(-1)
    const win = "talked" in m ? 15_000 : 3000, p = m.summoned ? sent.find((x) => !used.has(x.end.press) && x.end.t <= m.t && m.t - x.end.t < win) : undefined
    if (p) used.add(p.end.press)
    const results = mine.filter((a) => a.op === "result" && a.text).map((a) => a.text!)
    return {
      t: m.t, seq: m.seq, kind: m.kind, text: m.text ?? "", summoned: !!m.summoned, voice: !!m.voice,
      where: m.title ? `${m.title}${m.app ? ` (${m.app})` : ""}` : "path" in m && m.path ? `${m.path.replace(/\.md$/, "")}${m.line ? `, line ${m.line}` : ""}` : "",
      said: "talked" in m ? [m.talked ?? ""] : mine.filter((a) => a.op === "say" && a.text).map((a) => a.text!),
      did: [...new Set(mine.filter((a) => !NOT_SHOWN.has(a.op)).map((a) => `${DOES[a.op] ?? a.op}${WHERE.has(a.op) && a.text ? ` ${a.text}` : ""}`))],
      ...(results.length ? { results } : {}),
      ...(handed && word ? { word: Math.max(0, (word.t - m.t) / 1000) } : {}), ...(done ? { total: (done.t - m.t) / 1000 } : {}),
      ...(p ? { press: { id: p.end.press, steps: p.steps, ...(costOf(p.steps) ? { cost: costOf(p.steps) } : {}) } } : {}),
      ...(m.shot ? { shot: m.shot } : {}),
    }
  }), asks)
}

const ago = (now: number, t: number) => { const m = Math.round((now - t) / 60_000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago` }
const one = (s: string, n: number) => { const x = s.replace(/\s+/g, " ").trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x }
export function talkSoFar(xs: Exchange[], now: number, budget = 6000, whole = 8): string {
  const lines: string[] = []
  let used = 0
  for (let i = xs.length - 1; i >= 0; i--) {
    const e = xs[i], n = xs.length - 1 - i < whole ? 600 : 160
    const did = [...(e.results ?? []).map((r) => one(r, n === 600 ? 300 : 120)), ...(e.results?.length ? [] : e.did)]
    const line = [e.kind === "shown" ? `- ${ago(now, e.t)}, a job's proof played (${one(e.text, n)}), not an answer to anything they asked` : `- ${ago(now, e.t)}${e.where ? `, in ${one(e.where, 80)}` : ""}, they ${e.voice ? "said" : "asked"}: ${one(e.text, n) || "(pointed, no words)"}`,
      ...(e.said.length ? [`  you: ${one(e.said.join(" "), n)}`] : []), ...(did.length ? [`  you did: ${did.join("; ")}`] : [])].join("\n")
    if (used + line.length > budget) break
    lines.unshift(line); used += line.length + 1
  }
  return lines.join("\n")
}

const SONIOX_PER_S = 0.12 / 3600
export type Spent = { service: string; uses: number; seconds?: number; cost?: number }
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
    const cost = l.cost
    if (typeof cost === "number" && cost > 0) add("openai", (x) => { x.uses++; x.cost = (x.cost ?? 0) + cost })
    if (l.ev === "sound" && typeof l.by === "string") add(l.by, (x) => { x.uses++ })
  }
  return [...by.values()]
}
