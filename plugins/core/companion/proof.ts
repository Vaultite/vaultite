// A job's proof: its change shown on the real UI, not claimed: its ready knock, Show me playing its worker's tour
// (proofs.ts), then Keep and merge (its worker lands it), Needs changes (sent back) or Not yet. No Node.
import { gist, type Job, landable, live, resultLine } from "./jobs.ts"
import type { Step, Tour } from "./tour.ts"

/** The layer a step's before picture is drawn on, beside its agent's own (each flips without the other). */
const BEFORE = " (before)"
export const beforeLayer = (name: string) => `${name}${BEFORE}`
/** Whose a layer is: a before layer's agent, else itself. */
export const layerOwner = (layer: string) => (layer.endsWith(BEFORE) ? layer.slice(0, -BEFORE.length) : layer)

/** When a before picture shows (true) and goes (false) in a step, ms after it shows: before, now, before, now. */
export const FLIPS: [number, boolean][] = [[1700, false], [3100, true], [4500, false]]

/** Whether job `j`, moved from `from`, is one to show: its turn just ended with something (ready for review, done). */
export const readyNow = (j: Pick<Job, "state">, from: string) => live(from as Job["state"]) && (j.state === "ready for review" || j.state === "done")

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+[A-Z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
/** A job's ready knock, one line: what it shows (its proof's title, "the blue save button"), else its own title; one that
 *  was merging what they kept, how that went. */
export function readyLine(j: Pick<Job, "title" | "state" | "land">, change?: string) {
  const name = j.title.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "")
  if (j.land?.at !== undefined) return j.land.merged ? `Merged: ${name}` : `Didn't merge: ${name}`
  const what = (change ?? "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "")
  if (what) return `Ready to show you ${lowerFirst(what)}`
  const title = j.title.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "")
  return j.state === "done" ? `Done: ${title}` : `Ready to show you: ${title}`
}

/** What it changed, said plainly when there's nothing to show (or a step couldn't be): its words' gist, then its diff. */
export function summaryOf(j: Pick<Job, "result" | "last" | "title">) {
  const said = j.result?.text || j.last?.text || ""
  const line = resultLine(j.result ? { diff: j.result.diff } : undefined), files = j.result?.files ?? []
  const parts = [said ? gist(said, 220) : "", line ? `${line}${files.length ? `: ${files.slice(0, 3).map((f) => f.split("/").pop()).join(", ")}${files.length > 3 ? "…" : ""}` : ""}.` : ""]
  return parts.filter(Boolean).join(" ") || `It didn't say what changed for "${j.title}".`
}

/** What they can answer after a proof: keep it (and merge it, when it has a change of its own: landable), it needs
 *  changes, or not yet (it waits in Jobs). An offer to merge first (its change isn't live where they are): yes or not yet. */
export type Choice = "keep" | "broken" | "later"
export type Asked = "proof" | "offer"
/** The words of the choice for job `j`: its question and buttons, each button's words what happens. */
export function choicesFor(j: Pick<Job, "state" | "where" | "result" | "land">, asked: Asked = "proof"): { say: string; buttons: string[] } {
  if (asked === "offer") return { say: "Merge it first, then show you?", buttons: ["Merge it first", "Not yet"] }
  return landable(j) ? { say: "Keep it and merge it in, or does it need changes?", buttons: ["Keep and merge", "Needs changes", "Not yet"] }
    : { say: "Keep it, or does it need changes?", buttons: ["Keep", "Needs changes"] }
}

/** The user's answer after a proof (`asked`) in a few words: keep it (merge it), needs changes, not yet, or neither (a
 *  real ask, null). */
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

/** Words that ask to see a job's change ("show me", "let's see the header", "what did it do?"): what job-show is for. */
export const asksToSee = (text: string) => /\b(show|see|look|watch|demo|play|view|try|preview)\b|\bwhat (?:did|does|has) (?:it|that|the job)\b|\bhow (?:does|did) it look\b/i.test(text)

/** How long a step stays up in a proof's video: its words read at an easy pace, a before picture's flips through, an
 *  after's slide. */
export function holdMs(s: Pick<Step, "said" | "before" | "after">) {
  const words = s.said.split(/\s+/).filter(Boolean).length
  const read = Math.min(9000, Math.max(2800, 1600 + words * 340))
  return s.before || s.after ? Math.max(read, FLIPS.at(-1)![0] + 1400) : read
}
/** A proof video's narration: each step's words and when to say them (ms from its start), its recorded times or, without
 *  them, at a reading pace; then a beat (empty words) for its last step to end. */
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
