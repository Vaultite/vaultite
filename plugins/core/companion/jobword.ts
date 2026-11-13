import { KNOWN_AGENTS, parseTerminal } from "../../../core/agents.ts"
import { type OpCtx, type Plugin, whoOf } from "../../../core/plugins.ts"
import { requestWriter } from "../../../core/vault.ts"
import { HANDED } from "./jobs.ts"
import type { Moment } from "./types.ts"

export const NOT_THEIRS = "only on the user's own words: answer it while answering their ask (Talk key) or their message to you that names the choice (made after it began waiting), with said quoting them; else ask them which"
const CLOSES = /\b(close|stop|drop|cancel|discard|scrap|abandon|kill|end|forget|done with|don'?t need|throw)\b/
const ASKED_MS = 3 * 60_000
const TYPED_MS = 15 * 60_000
export const plainWords = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
const holds = (text: string, said: string) => !!said && ` ${plainWords(text)} `.includes(` ${said} `)
export const cut = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
export const BY_THEIR_WORD = { ...whoOf("app/companion", null), label: "the user, through their companion" }
const theirs = (by: string) => by === "the user" || by.startsWith("app/") || by.startsWith("machine/") || by === "iphone" || by === "watch"

export function wordsOf(plugin: Plugin) {
  async function typedTo(ctx: OpCtx): Promise<{ text: string; at: number; sentBy: string } | null> {
    const w = requestWriter.getStore(), terminal = w?.terminal ?? "", session = w?.session ?? ""
    if (!terminal && !session) return null
    const agent = parseTerminal(terminal)?.agent ?? KNOWN_AGENTS.find((k) => k.id === ctx.who.agent)?.terminal ?? ""
    const said = agent ? await plugin.ask<{ text: string; at: number } | null>(`agent-said:${agent}`, null, terminal, session).catch(() => null) : null
    if (!said?.text) return null
    const sq = (s: string) => s.replace(/…$/, "").replace(/\s+/g, " ").trim().slice(0, 120)
    const r = terminal ? await ctx.api("GET", `terminals/${encodeURIComponent(terminal)}/inputs`).catch(() => null) as { inputs?: { by: string; text?: string }[] } | null : null
    const sent = (r?.inputs ?? []).findLast((x) => !!x.text && sq(x.text) === sq(said.text))
    return { text: said.text, at: said.at, sentBy: said.text.includes(HANDED) ? "the companion, as your job's task" : sent && !theirs(sent.by) ? sent.by : "" }
  }
  async function theirWord(ctx: OpCtx, m: Moment | undefined, said: string, o: { since?: number; closes?: boolean } = {}): Promise<{ by: string } | { why: string }> {
    const since = o.since ?? 0
    if (!said) return { why: "said is missing: quote their words, as they said them" }
    if (o.closes && !CLOSES.test(said)) return { why: `"${said}" doesn't close it: quote their words that do ("close it", "drop it")` }
    if (m?.text && m.t >= since && Date.now() - m.t <= ASKED_MS && holds(m.text, said)) return { by: "the user, through their companion" }
    const t = await typedTo(ctx)
    if (!t) return { why: m?.text ? `"${said}" isn't in their latest ask to the companion, and your session's messages can't be read (only a Claude Code session's)` : "no message of theirs to quote: their ask to the companion, or their latest message in your session (a Claude Code session's, read from its transcript)" }
    if (t.sentBy) return { why: `their latest message in your session was typed into its terminal by ${t.sentBy}, not by them` }
    if (!holds(t.text, said)) return { why: `"${said}" isn't in their latest message to you ("${cut(t.text, 80)}")` }
    if (t.at && t.at < since) return { why: "their latest message to you came before it began waiting: ask them" }
    if (Date.now() - t.at > TYPED_MS) return { why: `their latest message to you is ${Math.round((Date.now() - t.at) / 60_000)} min old: ask them again` }
    return { by: "the user, in their message to you" }
  }
  return theirWord
}
