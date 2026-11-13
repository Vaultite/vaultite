import { followTask, gist, type Job } from "./jobs.ts"
import { isBrowser } from "./takeover.ts"
import { surfaceOf } from "./where.ts"
import type { Moment } from "./types.ts"
import { type FileEdit } from "./unedit.ts"

export type LiveAsk = { tag: string; t: number; text: string; window?: number; shot?: string; sent?: number; rung?: boolean; undone?: boolean
  handed?: boolean }
export const NOT_MINE = "(not for me)"
const UNDO = /^(?:(?:ok(?:ay)?|no|hmm|actually|wait)[,.!]?\s+)?(?:please\s+)?(?:(?:undo|revert|roll back)(?:\s+(?:that|this|it|that change|that one|the last(?:\s+(?:one|change|edit|thing))?|your last change|what you just did))?|(?:take|put)\s+(?:that|it|this)\s+back|take back(?:\s+(?:that|it|this))?)(?:\s+(?:too|as well|also|again|please))*\s*[.!]*$/i
export const isUndo = (text: string | undefined) => !!text && UNDO.test(text.trim().replace(/\s+/g, " "))

const LEAD = /^(?:(?:ok(?:ay)?|so|hey|hi|hmm+|um+|uh+|well|and|but|actually|wait|sorry|quick question|question|one thing|also)[,.!:]?\s+)+/i
const ASKING = /^(?:what|what's|whats|which|who|who's|whose|where|where's|when|why|how|how's)\b|^(?:is|isn't|are|aren't|am|was|were|does|doesn't|do|did|has|have|had|can i|could i|should i|may i|will (?:this|that|it|they|i)|would (?:this|that|it|i))\b|^(?:explain|tell me|describe|remind me (?:what|how|why|where|which)|show me (?:what|how|where|which))\b|^(?:can|could|would|will) you (?:tell|explain|show|remind) me\b/i
const PROPOSING = /^(?:what if|how about|why not|why (?:isn't|isnt|doesn't|doesnt|won't|wont|can't|cant|is it not|does it not|is there no)|is it possible|is there a way|can (?:you|we)|could (?:you|we)|would you|will you|would it be|should (?:we|it|this|that))\b(?! (?:tell|explain|show|remind) me\b)/i
const CHANGING = /\b(?:make|move|change|add|remove|delete|drop|put|turn|swap|replace|rename|resize|shrink|grow|enlarge|fix|cent(?:er|re)|align|hide|tweak|adjust|increase|decrease|reduce|bump|raise|lower|bigger|smaller|larger|wider|narrower|taller|shorter|darker|lighter|bolder|instead|undo|revert|redo)\b/i
export function isQuestion(text: string | undefined) {
  const t = (text ?? "").trim().replace(/\s+/g, " ").replace(LEAD, "").replace(/^please\s+/i, "")
  return !!t && ASKING.test(t) && !PROPOSING.test(t) && !CHANGING.test(t)
}

export function freshText(j: Pick<Job, "title" | "on" | "where" | "result">, asks: Pick<LiveAsk, "tag" | "text" | "undone">[], next: string) {
  const w = j.where, page = j.on?.replace(/^(?:site|note):/, "") || w.preview || ""
  const done = asks.map((a) => `${a.tag} "${a.text}"${a.undone ? " (they undid it)" : ""}`).join("; ")
  return [`You're taking over a job they handed off, "${j.title}", from a worker whose conversation grew long: you start fresh, with this summary.`,
    page ? `They watch its page, ${page}, and ask for changes to it one at a time by voice (live editing).` : "",
    w.tree ? `Work in its git worktree ${w.tree} (branch ${w.branch}), beside ${w.cwd}, which you never edit${w.base ? `; what it changed so far: git -C ${w.tree} diff ${w.base}` : ""}.` : w.cwd ? `It works in ${w.cwd}.` : "",
    done ? `Their live asks so far, oldest first: ${done}.` : "",
    j.result?.text && !j.result.text.includes(NOT_MINE) ? `Its last words: ${gist(j.result.text.replace(/\s+/g, " "), 300)}` : "",
    "Read only what the next ask needs.", next].filter(Boolean).join(" ")
}

export type Span = { prompt?: string; said?: string; edits: FileEdit[] }
export function editsFor(spans: Span[], tag: string): FileEdit[] {
  let on = ""
  const out: FileEdit[] = []
  for (const s of spans) {
    const t = s.prompt !== undefined ? /Live edit (L\d+):/.exec(s.prompt)?.[1] ?? null : /^\W{0,3}(L\d+)\b/.exec(s.said ?? "")?.[1] ?? undefined
    if (t === null) on = ""
    else if (t) on = t
    if (on === tag) out.push(...s.edits)
  }
  return out
}

export function liveText(tag: string, m: Moment, notes: string[]) {
  return followTask([`Live edit ${tag}: they're watching the page reload as you change it, so make this change now, the smallest that does it, and end your turn in a few words at most; no checks or summaries unless they ask.`,
    `More asks may come as you work: take them in order, and write each one's tag alone before its changes (${tag}:). Change files with your Edit and Write tools only, never a command (sed, printf, a script): that's how each ask is undone apart.`,
    `A question about the page: answer it in a sentence or two and change nothing. One not about this page or its code: change nothing and answer only ${NOT_MINE}.`,
    ...notes].join(" "), m)
}

const ADDRESS_LINE = /^\s*(?:(?:address(?: and search)? bar|url|location)\b[^:]{0,20}:\s*)?\S+\s*$/i
export function pageOf(m: Moment) {
  if (m.path || m.url) return surfaceOf(m)
  if (m.pane) return ""
  const address = (m.screen ?? "").split("\n").slice(0, 60).filter((l) => ADDRESS_LINE.test(l)).join("\n")
  return address || (m.app && isBrowser(m.app)) ? surfaceOf({ title: m.title, screen: address }) : ""
}
