import { JOB_STATES, type Job, landable, live, onMain } from "./jobs.ts"
import type { Step, Tour } from "./tour.ts"

const BEFORE = " (before)"
export const beforeLayer = (name: string) => `${name}${BEFORE}`
export const layerOwner = (layer: string) => (layer.endsWith(BEFORE) ? layer.slice(0, -BEFORE.length) : layer)

export const FLIPS: [number, boolean][] = [[1700, false], [3100, true], [4500, false]]

export const readyNow = (j: Pick<Job, "state">, from: string) => JOB_STATES.some((x) => x === from && live(x)) && (j.state === "ready for review" || j.state === "done")

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+[A-Z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
export function readyLine(j: Pick<Job, "title" | "state" | "land"> & Partial<Pick<Job, "going">>, change?: string) {
  const name = j.title.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "")
  if (j.going?.state === "live") return `Live: ${(change ?? "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "") || name}`
  if (j.going?.state === "stuck" && j.state === "done") return `Merged, not live: ${name}`
  if (j.land?.at !== undefined) return j.land.merged ? `Merged: ${name}` : `Didn't merge: ${name}`
  const what = (change ?? "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "")
  if (what) return `Ready to show you ${lowerFirst(what)}`
  const title = j.title.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "")
  return j.state === "done" ? `Done: ${title}` : `Ready to show you: ${title}`
}

const NOT_CHANGE = /^(?:(?:not )?merged|landed|where it landed|files?(?: changed)?|changed files|commits?|checks?|tests?|verify)\b[^.\n]{0,40}:/i
const COUNTS = /\(?\b\d+ files? changed\b(?:,? ?\+\d+ -\d+)?\)?|\(?\+\d+ -\d+\)?|\b\d+ (?:insertions?|deletions?)\([+-]\)|\b\d+ (?:new files?|commits?)\b/gi
const ID = /(?:\b(?:as|at|now)\s+)?(?<![\w/.-])(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}(?![\w/-]|\.\w)/g
const bare = (l: string) => l.replace(/\*\*|__|`/g, "").replace(/^\s*(?:#+|>|[-*•]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim()
export function changeSaid(text: string, n = 260) {
  const lines = text.replace(/```[\s\S]*?(?:```|$)/g, "").split("\n").map(bare)
    .filter((l) => l && !NOT_CHANGE.test(l) && !l.endsWith(":") && !/^(?:remote:|\$ |[\w./-]+\.\w+(?:,\s*[\w./-]+\.\w+)*$)/i.test(l))
  const sentences = lines.flatMap((l) => {
    const said = l.replace(/\bhttps?:\/\/\S+/g, "").replace(COUNTS, "").replace(ID, "").replace(/\(\s*\)|\[\s*\]/g, "")
      .replace(/\s+([,.;:!?])/g, "$1").replace(/([,;:])(?=[,.;:])/g, "").replace(/^[-,;:\s]+/, "").replace(/\s+/g, " ").trim()
    return said.split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/).map((x) => (/[.!?]$/.test(x) ? x : `${x}.`))
  }).filter((x) => /[A-Za-z]{3}/.test(x) && x.split(" ").length > 1)
  let out = ""
  for (const x of sentences) { if (out && out.length + x.length + 1 > n) break; out = out ? `${out} ${x}` : x }
  return out.length > n ? `${out.slice(0, n - 1)}…` : out
}
export function seenAt(open = "") {
  const o = open.trim()
  if (/\.md$/i.test(o)) return `To see it, open the note ${o.split("/").pop()!.replace(/\.md$/i, "")}.`
  const host = /^https?:\/\/([^/:]+)/i.exec(o)?.[1]
  return host && !/^(?:127\.|localhost)/.test(host) ? `To see it, open ${host.replace(/^www\./, "")}.` : ""
}
export function summaryOf(j: Pick<Job, "result" | "last" | "title">, open = "") {
  const said = changeSaid(j.result?.text || j.last?.text || ""), at = seenAt(open)
  const title = j.title.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "")
  return [said || `It finished "${title}", but didn't say what changed.`, at].filter(Boolean).join(" ")
}

export type Choice = "keep" | "broken" | "later"
export type Asked = "proof" | "offer"
export function choicesFor(j: Pick<Job, "state" | "where" | "result" | "land"> & Partial<Pick<Job, "log" | "title">>, asked: Asked = "proof"): { say: string; buttons: string[]; hint?: string } {
  if (asked === "offer") return { say: "Merge it first, then show you?", buttons: ["Merge it first", "Not yet"] }
  const title = (j.title ?? "").replace(/\s+/g, " ").trim(), short = title.length > 48 ? `${title.slice(0, 47)}…` : title
  const hint = `Or hold your Talk key and say what to change: it goes to ${short ? `"${short}"` : "this job"}.`
  if (landable(j)) return { say: "Keep it and merge it in, or does it need changes?", buttons: ["Keep and merge", "Needs changes", "Not yet"], hint }
  return { say: j.where.repo && onMain(j) ? "It's already in. Keep it, or does it need changes?" : "Keep it, or does it need changes?", buttons: ["Keep", "Needs changes"], hint }
}

export function choiceSaid(text: string, asked: Asked = "proof"): Choice | null {
  const t = text.toLowerCase().replace(/[’]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()
  if (!t || t.split(" ").length > 7) return null
  if (/^(?:(?:no|nope|nah|ok|okay) )?(?:not (?:yet|now)|later|maybe later|leave it(?: for now)?|(?:keep it )?(?:but )?(?:don'?t|do not) merge(?: it)?(?: yet)?|keep it but don'?t merge(?: it)?|hold (?:on|off)|wait)$/.test(t)) return "later"
  if (/^(?:(?:no|nope|nah) )?(?:it'?s |that'?s |its )?(?:still (?:broken|wrong|not (?:working|right|fixed))|not (?:fixed|working|right)(?: yet)?|(?:it )?(?:doesn'?t|does not|didn'?t) work|broken|needs? (?:changes|work|fixing|a change)|change (?:something|it)|fix (?:it|something))(?: still)?$/.test(t)) return "broken"
  if (/^(?:(?:yes|yeah|yep|ok|okay|great|nice|perfect|good|sure) )*(?:keep(?: it| that| this)?(?: and merge(?: it)?)?|merge(?: it)?(?: first| in)?|land it|looks (?:good|great|right)|that'?s (?:good|great|right|it)|ship it|(?:it )?works|good|great|perfect|lgtm)(?: thanks| thank you| please)?$/.test(t)) return "keep"
  if (asked === "offer" && /^(?:yes|yeah|yep|ok|okay|sure|please|do it|go ahead)(?: please| do it| go ahead)?$/.test(t)) return "keep"
  if (asked === "offer" && /^(?:no|nope|nah)(?: thanks)?$/.test(t)) return "later"
  return null
}

export const asksToSee = (text: string) => /\b(show|see|look|watch|demo|play|view|try|preview)\b|\bwhat (?:did|does|has) (?:it|that|the job)\b|\bhow (?:does|did) it look\b/i.test(text)

export function holdMs(s: Pick<Step, "said" | "before" | "after">) {
  const words = s.said.split(/\s+/).filter(Boolean).length
  const read = Math.min(9000, Math.max(2800, 1600 + words * 340))
  return s.before || s.after ? Math.max(read, FLIPS.at(-1)![0] + 1400) : read
}
export function narration(t: Pick<Tour, "steps" | "times">): [number, string][] {
  const out: [number, string][] = []
  let at = 900
  t.steps.forEach((s, i) => {
    const when = t.times?.[i] !== undefined ? t.times[i] * 1000 : at
    out.push([when, s.said])
    at = when + holdMs(s)
  })
  out.push([at, ""])
  return out
}
