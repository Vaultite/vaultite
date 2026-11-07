// A job's proof: its change shown on the real UI, not claimed. A job that's ready knocks ("Ready to show you …"); Show
// me plays the tour its worker saved (proofs.ts), each before flipped with how it is now, then Keep or Still broken. No Node.
import { gist, type Job, live, resultLine } from "./jobs.ts"

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
/** A job's ready knock, one line: what it shows (its proof's title, "the blue save button"), else its own title. */
export function readyLine(j: Pick<Job, "title" | "state">, change?: string) {
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

/** The user's answer after a proof: keep it, still broken, or neither (a real ask). Short words only. */
export function choiceSaid(text: string): "keep" | "broken" | null {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()
  if (!t || t.split(" ").length > 7) return null
  if (/^(?:(?:no|nope|nah) )?(?:it'?s |that'?s |its )?(?:still (?:broken|wrong|not (?:working|right|fixed))|not (?:fixed|working|right)(?: yet)?|(?:it )?(?:doesn'?t|does not|didn'?t) work|broken)(?: still)?$/.test(t)) return "broken"
  if (/^(?:(?:yes|yeah|yep|ok|okay|great|nice|perfect|good) )*(?:keep(?: it| that| this)?|looks (?:good|great|right)|that'?s (?:good|great|right|it)|ship it|(?:it )?works|good|great|perfect|lgtm)(?: thanks| thank you)?$/.test(t)) return "keep"
  return null
}
