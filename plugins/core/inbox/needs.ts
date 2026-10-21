// Whether an agent's turn that ended needs the user: a question, an approval, an answer to read; or it's done with
// nothing for them. Sure cases decide by themselves; the rest ask a small fast model, and when that fails, it needs them.
import crypto from "node:crypto"
import type { SampleAnswer, SampleAsk } from "../../../core/agents.ts"

/** Why a session needs the user: what it asks before it goes on (permission, question, auth, plan), its last message
 *  (answer: a question in it, or something to read), its report, or its turn failing. */
export type Need = "permission" | "question" | "auth" | "plan" | "answer" | "report" | "error"
export type Verdict = { needs: boolean; why: Need | null; by: "rule" | "model" | "fallback"; ms?: number }

/** A turn as it ended: what the user said last, the agent's final message, and whether it ended in an error. */
export type Turn = { prompt?: string; text: string; error?: boolean }

const plain = (s: string) => s.replace(/```[\s\S]*?```/g, " ").replace(/[*_`#>|]+/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")

/** What the turn's own words settle, or null for the model to say. */
export function sure(t: Turn): Verdict | null {
  if (t.error) return { needs: true, why: "error", by: "rule" }
  const text = t.text.trim()
  if (!text) return { needs: false, why: null, by: "rule" }
  // Its last line a question (not one in a code block, a quote or a heading): it waits on the answer.
  const last = plain(text).split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? ""
  if (/\?["')\]]*$/.test(last)) return { needs: true, why: "answer", by: "rule" }
  return null
}

export const SYSTEM = `You triage the final message a coding agent wrote when its turn ended, for the user who started it and is busy elsewhere. Reply with one word: NEEDS_YOU or DONE.
NEEDS_YOU only when at least one is true:
1. It asks the user something or waits on them: a question, a choice between options, a confirmation, an approval, a login, something for them to try or do.
2. It says it couldn't finish: blocked, failed, or an error it couldn't fix.
3. The user's last message asked to be told something (a question, "tell me", "what do you think", a review, an explanation, how it's going, a result to report) and this message tells it.
DONE otherwise: a report of work done or under way (built, fixed, shipped, deployed, a report filed in the inbox, closing the session), an acknowledgement, or a plan the agent is carrying out itself.`

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.floor(n * 0.4))}\n[…]\n${s.slice(s.length - Math.floor(n * 0.6))}`)

/** The model's question: the user's last message and the agent's final one, cut to their head and tail. */
export const question = (t: Turn) =>
  `The user's last message:\n<user>\n${cut((t.prompt ?? "").trim(), 1200) || "(not known)"}\n</user>\n\nThe agent's final message:\n<agent>\n${cut(t.text.trim(), 4000)}\n</agent>`

type Sample = (a: SampleAsk) => Promise<SampleAnswer>

const cache = new Map<string, Promise<Verdict>>()
const CACHE = 300
let running = 0
const queue: (() => void)[] = []
/** At most two at once: a burst of turns ending waits its turn rather than starting a model for each. */
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => queue.push(r))
  running++
  try { return await fn() } finally { running--; queue.shift()?.() }
}

/** The verdict on a turn: its own words when they settle it, else the model's (once per turn: the same turn asked
 *  again, by a hook and the terminal both, is the same answer), else it needs the user. */
export function judge(t: Turn, sample: Sample | null, ms = 30_000): Promise<Verdict> {
  const known = sure(t)
  if (known) return Promise.resolve(known)
  if (!sample) return Promise.resolve({ needs: true, why: "answer", by: "fallback" })
  const key = crypto.createHash("sha1").update(`${t.prompt ?? ""}\0${t.text}`).digest("hex")
  const hit = cache.get(key)
  if (hit) return hit
  const p = slot(async (): Promise<Verdict> => {
    const t0 = Date.now()
    try {
      const r = await sample({ system: SYSTEM, prompt: question(t), tier: "quick", signal: AbortSignal.timeout(ms) })
      const word = r.text.trim().toUpperCase()
      if (word.startsWith("DONE")) return { needs: false, why: null, by: "model", ms: Date.now() - t0 }
      return { needs: true, why: "answer", by: word.startsWith("NEEDS") ? "model" : "fallback", ms: Date.now() - t0 }
    } catch {
      return { needs: true, why: "answer", by: "fallback", ms: Date.now() - t0 }
    }
  })
  cache.set(key, p)
  if (cache.size > CACHE) cache.delete(cache.keys().next().value!)
  return p
}
