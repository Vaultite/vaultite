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

const plain = (s: string) => s.replace(/```[\s\S]*?```/g, " ").replace(/^\s*(#{1,6}\s|>).*$/gm, "").replace(/[*_`#|]+/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")

const lines = (s: string) => plain(s).split("\n").map((l) => l.trim()).filter(Boolean)
const asks = (l = "") => /\?["')\]]*$/.test(l)
/** A question the user wants answered, not a request put as one ("Can you fix it?"). */
const wondering = (l = "") => asks(l) && /^(what|why|how|which|who|where|when|is|are|does|do|did|was|were|has|have|should)\b/i.test(l) &&
  !/^(can|could|would|will) you\b/i.test(l)

/** What the turn's own words settle, or null for the model to say. */
export function sure(t: Turn): Verdict | null {
  if (t.error) return { needs: true, why: "error", by: "rule" }
  const said = lines(t.text)
  if (!said.length) return { needs: false, why: null, by: "rule" }
  // Its last line a question (not one in a code block, a quote or a heading), or one just before a short closing line
  // ("Take your time."): it waits on the answer.
  const [before, last] = [said.at(-2), said.at(-1)]
  if (asks(last) || (asks(before) && last!.length <= 60)) return { needs: true, why: "answer", by: "rule" }
  // The user asked a question: what it says is their answer to read.
  if (wondering(lines(t.prompt ?? "").at(-1))) return { needs: true, why: "answer", by: "rule" }
  return null
}

export const SYSTEM = `You triage the final message a coding agent wrote when its turn ended, for the user who started it and is busy elsewhere. Reply with exactly one word: NEEDS_YOU or DONE.
NEEDS_YOU when any of these is true:
1. The user's last message asked to know something (a question, "tell me", "look and tell me", "what do you think", a review, an explanation, how it's going) and this message tells it: that answer is for them to read, even when it's short or reads like a report.
2. It asks the user something or waits on them: a question, options to choose from, a confirmation, an approval, a login, something for them to try or do.
3. It couldn't do what was asked: blocked, failed, something missing, or an error it couldn't fix.
DONE when none is true: the user asked for work and this says it's done or under way (built, fixed, created, shipped, deployed, a report filed in the inbox, the session closing), an acknowledgement, or a plan the agent is carrying out itself. An offer to do more ("let me know if...") doesn't change that.
When unsure, NEEDS_YOU.

Examples:
User: "What's in this folder? Look and tell me." Agent: "Mostly Markdown notes: daily notes, logs and the Lighthouse project." -> NEEDS_YOU
User: "Read config.yaml and tell me its port." Agent: "config.yaml doesn't exist, so I can't tell its port." -> NEEDS_YOU
User: "Create notes.txt with the word hi." Agent: "Created notes.txt containing hi." -> DONE
User: "Fix the login bug and push." Agent: "Fixed the token refresh and pushed to main; tests pass. Let me know if you want a release." -> DONE`

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
      const word = r.text.trim().toUpperCase().replace(/^[^A-Z]+/, "")
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
