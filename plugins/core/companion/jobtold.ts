import { type OpCtx, userSurface } from "../../../core/plugins.ts"
import { requestWriter } from "../../../core/vault.ts"
import type { JobDeps } from "./workers.ts"

export const COMPANION = "the companion"
export const THEM = "you, in the app"
export function tellerOf(ctx: OpCtx, companion: string) {
  if (userSurface(ctx.who)) return THEM
  if (companion) return `the companion (${companion})`
  const t = requestWriter.getStore()?.terminal
  return ctx.who.agent ? `another agent, not the companion: ${ctx.who.label}${t ? ` in terminal ${t}` : ""}` : `not the companion: ${ctx.who.label === "vau" ? "vau from a shell or script" : ctx.who.label}`
}
export type Told = { kind: "new" | "follow" | "land" | "kept"; title: string; line: string; say?: string }
const TELL_MS = 400, TURN_END_MAX_MS = 20_000
const NUMBER = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
export function jobName(title: string) {
  const words = title.replace(/[.:,;…]+$/, "").replace(/\s+/g, " ").trim().split(" ").slice(0, 4)
  while (words.length > 1 && /^(the|a|an|on|of|to|in|for|and|with|at|by|from)$/i.test(words.at(-1)!)) words.pop()
  return words.join(" ").replace(/[.:,;]+$/, "")
}
const HANDOFF_WORDS = /\bhand(?:ed|ing|s)?\b[^.!?]{0,40}\boff\b|\bhand-?offs?\b|\bbackground (?:agent|job)s?\b|\bpass(?:ed|ing)?\b[^.!?]{0,40}\bon\b|\b(?:start(?:ed|ing)?|made|opened|spun up|sent|gave|put|told)\b[^.!?]{0,30}\b(?:a|an|its|their|new|one|two|three|four|\d+) (?:new )?(?:\w+ )?jobs?\b|\bjobs?(?:'s| is| are)? on (?:it|that|them)\b|\bkicked (?:it |that |this )?off\b|\bto merge\b/i
export const announces = (text: string) => HANDOFF_WORDS.test(text)
export function toldLine(items: Told[], turnWords = "") {
  if (!items.length) return ""
  let announced = announces(turnWords)
  const out: string[] = []
  for (const s of new Set(items.flatMap((x) => (x.say ? [x.say] : [])))) {
    if (!announces(s)) out.push(s)
    else if (!announced) { out.push(s); announced = true }
  }
  const rest = items.filter((x) => !x.say)
  const kept = [...new Set(rest.flatMap((x) => (x.kind === "kept" ? [x.line] : [])))]
  if (announced) return [...out, ...kept].join(" ")
  if (items.length === 1 && rest.length) return rest[0].line
  const names = (xs: Told[]) => { const n = [...new Set(xs.map((x) => jobName(x.title)))]; return n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n.at(-1)}` : n[0] ?? "" }
  const count = (n: number, one: string) => `${NUMBER[n] ?? n} ${one}${n === 1 ? "" : "s"}`
  const of = (k: Told["kind"]) => rest.filter((x) => x.kind === k)
  const lines = [
    of("new").length ? `Handed off ${count(of("new").length, "job")} to background agents: ${names(of("new"))}.` : "",
    of("follow").length ? `Passed that on to ${of("follow").length === 1 ? names(of("follow")) : `${count(of("follow").length, "job")}: ${names(of("follow"))}`}.` : "",
    of("land").length ? `Told ${of("land").length === 1 ? names(of("land")) : `${count(of("land").length, "job")}, ${names(of("land"))},`} to merge.` : "",
    ...kept,
  ].filter(Boolean)
  return [...out, ...lines].join(" ")
}

type Held = { ctx: OpCtx; calls: number; items: Told[]; since: number; ends: Promise<void> | null; timer?: ReturnType<typeof setTimeout>; waiting?: boolean }
export function toldTogether(d: Pick<JobDeps, "say" | "saidSince" | "turnEnd">) {
  const told = new Map<string, Held>(), mine = new Set<string>()
  function holding(name: string, ctx: OpCtx, since: number) {
    const t = told.get(name) ?? { ctx, calls: 0, items: [], since, ends: d.turnEnd?.(name) ?? null }
    clearTimeout(t.timer)
    t.calls++
    t.ctx = ctx
    told.set(name, t)
  }
  const heldTold = (name: string, item: Told) => told.get(name)?.items.push(item)
  const after = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.())
  function release(name: string) {
    const t = told.get(name)
    if (!t || --t.calls > 0) return
    const tell = () => {
      if (told.get(name) !== t) return
      told.delete(name)
      const line = toldLine(t.items, (d.saidSince?.(name, t.since) ?? []).filter((x) => !mine.has(x)).join(" "))
      if (line) { mine.add(line); if (mine.size > 50) mine.delete(mine.values().next().value!) }
      if (line) void d.say(t.ctx, name, line).catch((e) => console.error("companion: jobs:", e))
    }
    if (t.ends) { if (!t.waiting) { t.waiting = true; void Promise.race([t.ends.then(() => after(TELL_MS)), after(TURN_END_MAX_MS)]).then(tell) } return }
    t.timer = setTimeout(tell, TELL_MS)
    t.timer.unref?.()
  }
  return { holding, heldTold, release }
}
