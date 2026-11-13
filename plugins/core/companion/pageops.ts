import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { localDate } from "../../../core/plugins.ts"
import { readText, writeNew } from "../../../core/vault.ts"
import { elevenUsage } from "./voice.ts"
import { jobTimingsText } from "./jobs.ts"
import { type Exchange, exchanges, type PressLine, type Spent, spent } from "./conversation.ts"
import "./control.ts"
import { plugin } from "./self.ts"
import type { Moment, Act } from "./types.ts"
import { str, ownName } from "./settings.ts"
import { log, acts, BOOKKEEPING } from "./state.ts"
import { cut } from "./edits.ts"
import { AS } from "./args.ts"
import { jobs } from "./wiring.ts"

export type Timing = { t: number; seq: number; kind: string; at: string; as?: string; op?: string; pause?: number; handoff?: number; sent?: number; think?: number; word?: number; total?: number }

const PressLineIn = z.looseObject({ t: z.number(), press: z.string(), kind: z.string(), ev: z.string(), ms: z.number().optional().catch(undefined) })
const Presses = z.array(z.unknown()).catch([]).transform((a): PressLine[] => a.flatMap((l) => PressLineIn.safeParse(l).data ?? []))
const Audio = z.object({ wav: z.string().nullable() })
const Shot = z.object({ png: z.string().nullable() })
const NOT_ACTS = new Set([...BOOKKEEPING, "word", "stopped"])
const WORDS = new Set(["word", "say", "comment", "suggest", "propose", "edit"])

export function timings(ms: Moment[], log: Act[]): Timing[] {
  return ms.flatMap((m, i) => {
    const until = ms.slice(i + 1).find((x) => x.seq === m.seq)?.t ?? Infinity
    const r: Timing = { t: m.t, seq: m.seq, kind: m.kind, at: m.path ? `${m.path}${m.line ? `:${m.line}` : ""}` : "", ...(m.waited !== undefined ? { pause: m.waited } : {}) }
    const hands = log.flatMap((a, hi) => (a.op === "handed" && a.t >= m.t && a.t < until && a.seqs?.includes(m.seq) ? [hi] : []))
      .filter((hi, k, all) => all.findLastIndex((x) => log[x].as === log[hi].as) === k)
    if (!hands.length) return [r]
    return hands.map((hi) => {
      const h = log[hi], after = log.slice(hi + 1).filter((a) => a.as === h.as)
      const done = after.find((a) => a.op === "next" || a.op === "done"), within = (a: Act) => !done || a.t <= done.t
      const first = after.find((a) => !NOT_ACTS.has(a.op) && within(a)), word = after.find((a) => WORDS.has(a.op) && within(a)), sent = after.find((a) => a.op === "sent" && within(a))
      return { ...r, as: h.as, handoff: h.t - m.t, ...(sent ? { sent: sent.t - h.t } : {}), ...(first ? { op: first.op, think: first.t - h.t } : {}), ...(word ? { word: word.t - h.t } : {}), ...(done ? { total: done.t - m.t } : {}) }
    })
  })
}

export function timingsText(day: string, rows: Timing[]) {
  const s = (ms?: number) => (ms === undefined ? "-" : (ms / 1000).toFixed(1)).padStart(7)
  const time = (t: number) => new Date(t).toTimeString().slice(0, 8)
  const pct = (xs: number[], q: number) => xs.sort((a, b) => a - b)[Math.max(0, Math.ceil(q * xs.length) - 1)]
  const sum = (label: string, rs: Timing[]) => `${label} (${rs.length}): ${(["pause", "handoff", "think", "word", "total"] as const).map((k) => {
    const xs = rs.flatMap((r) => r[k] ?? [])
    return `${k} ${xs.length ? `${s(pct(xs, 0.5)).trim()}/${s(pct(xs, 0.9)).trim()}` : "-"}`
  }).join(", ")} (median/p90, s)`
  if (!rows.length) return `No moments on ${day}.`
  return [`${day}, in seconds: pause (the user's, before the app sent it; a Talk key's, from letting it go), handoff (until it was handed: a next, or its chat session's message), think (to the first action), word (to the first word shown), total (to the next \`next\`, or its turn's end).`,
    `${"time".padEnd(8)} ${"pause".padStart(7)} ${"handoff".padStart(7)}${"think".padStart(7)}${"word".padStart(7)}  ${"total".padStart(7)}  moment`,
    ...rows.map((r) => `${time(r.t)} ${s(r.pause)} ${s(r.handoff)}${s(r.think)}${s(r.word)}  ${s(r.total)}  ${r.as ? `${r.as}: ` : ""}${r.kind}${r.op ? ` -> ${r.op}` : ""} ${cut(r.at, 50)}`),
    sum("asks and replies", rows.filter((r) => r.kind === "ask" || r.kind === "reply")), sum("all", rows),
    ...(new Set(rows.flatMap((r) => r.as ?? [])).size > 1 ? [...new Set(rows.flatMap((r) => r.as ?? []))].map((a) => sum(a, rows.filter((r) => r.as === a))) : [])].join("\n")
}

plugin.op({
  id: "companion.timings",
  cli: "companion timings",
  summary: "How fast the companion answered on a day: per moment, its wait to be handed, the think to its first action, to its first word shown, total; per job, to its card and its worker's first step.",
  help: `  vau companion timings
  vau companion timings --day 2026-10-16`,
  kind: "read",
  params: { day: { type: "string", description: "a day (YYYY-MM-DD); default: today" } },
  run: async (p) => {
    const day = str(p.day) || localDate(Date.now())
    return { day, rows: timings(log.read(day), acts.read(day)), jobs: jobs.timings(day, localDate) }
  },
  text: (r) => [timingsText(r.day, r.rows), jobTimingsText(r.jobs)].filter(Boolean).join("\n\n"),
})

plugin.op({
  id: "companion.conversation",
  cli: "companion conversation",
  summary: "The user's talk with the companion on a day: each ask (a Talk key's press, an @name), its answer and what it did, its timings and press; and what its services used.",
  help: `What the Companion page and the Conversations panel's Talk show. Each exchange's press has its steps (mic,
recognizer, the key's up and down, its end), as the menu-bar helper logged them on this machine.

  vau companion conversation
  vau companion conversation --day 2026-11-05`,
  kind: "read",
  params: { day: { type: "string", description: "a day (YYYY-MM-DD); default: today" } },
  run: async (p) => {
    const day = str(p.day) || localDate(Date.now())
    const presses = Presses.parse(await plugin.desktop("talk:presses", { day }).catch(() => []))
    return { day, exchanges: exchanges(log.read(day), acts.read(day), presses, ownName()), spent: spent(presses), jobs: jobs.cards().map((j) => ({ ...j, at: j.started, ...(j.ended ? { ended: j.ended } : {}) })) }
  },
  text: (r) => [`${r.day}: ${r.exchanges.length} ${r.exchanges.length === 1 ? "ask" : "asks"}.`, ...r.exchanges.map((e: Exchange) => `${new Date(e.t).toTimeString().slice(0, 5)} ${e.kind === "shown" ? "proof played" : e.voice ? "said" : "asked"}${e.where ? ` (${e.where})` : ""}: ${e.text.replace(/\s+/g, " ").slice(0, 160)}${e.said.length ? `\n  -> ${e.said.join(" ").replace(/\s+/g, " ").slice(0, 200)}` : ""}`),
    ...(r.spent.length ? [`Used: ${r.spent.map((x: Spent) => `${x.service} ${x.uses}${x.seconds ? `, ${Math.round(x.seconds)} s` : ""}${x.cost ? `, $${x.cost.toFixed(3)}` : ""}`).join("; ")}`] : [])].join("\n"),
})
/** What the user said to it aloud in the last `days` days (a Talk key's asks), newest first, with its answer: the
 *  Dictations list shows them beside dictation's, from this log, never copied. */
plugin.provide("voice:asks", (days: number) => {
  const name = ownName()
  return Array.from({ length: Math.max(1, Math.min(60, days)) }, (_, i) => localDate(Date.now() - i * 86_400_000))
    .flatMap((day) => exchanges(log.read(day), acts.read(day), [], name).filter((e) => e.voice && e.kind !== "shown" && e.text.trim()).reverse())
    .map((e) => ({ t: e.t, text: e.text, where: e.where, said: e.said.join(" ").slice(0, 600), who: name }))
})

plugin.op({
  id: "companion.press-media",
  owner: "The companion's presses",
  summary: "A Talk key press's kept audio (WAV) and its ask's picture of the screen (PNG), base64, for its Details on the Companion page.",
  kind: "read",
  mcp: false,
  params: { press: { type: "string", description: "the press's id (companion conversation)" }, shot: { type: "string", description: "its ask's picture (companion conversation)" } },
  run: async (p) => {
    const wav = str(p.press) ? Audio.safeParse(await plugin.desktop("talk:audio", { press: str(p.press) }).catch(() => null)).data?.wav ?? null : null
    const png = str(p.shot) ? Shot.safeParse(await plugin.desktop("talk:shot", { name: path.basename(str(p.shot)) }).catch(() => null)).data?.png ?? null : null
    return { wav, png }
  },
  text: (r) => [r.wav ? "Its audio is kept." : "No audio kept.", r.png ? "Its picture is kept." : "No picture kept."].join(" "),
})

type UsageRow = { service: string; today: Spent; week: Spent; left?: { used: number; limit: number; resets?: number; unit: string }; billing?: string }
const BILLING: Record<string, string> = { openai: "https://platform.openai.com/settings/organization/billing/overview", soniox: "https://console.soniox.com", elevenlabs: "https://elevenlabs.io/app/subscription" }
plugin.op({
  id: "companion.usage",
  cli: "companion usage",
  summary: "What the companion's services used today and this week (counted by Vaultite from its presses), and what's left where the provider says.",
  help: `Per service: its uses, seconds heard and cost today and over the last 7 days; ElevenLabs' characters left this
month from its API (with this machine's key); for the others, where to see the balance. The Claude plans' limits are
Claude Code's (vau claude-code limits).

  vau companion usage`,
  kind: "read",
  run: async (): Promise<{ services: UsageRow[] }> => {
    const days = Array.from({ length: 7 }, (_, i) => localDate(Date.now() - i * 86_400_000))
    const got = await Promise.all(days.map((day) => plugin.desktop("talk:presses", { day }).catch(() => [])))
    const lines = got.map((x) => Presses.parse(x))
    const today = spent(lines[0]), week = spent(lines.flat()), eleven = await elevenUsage(plugin)
    const services = [...new Set([...week.map((x) => x.service), ...(eleven ? ["elevenlabs"] : [])])]
    return { services: services.map((service) => ({ service, today: today.find((x) => x.service === service) ?? { service, uses: 0 }, week: week.find((x) => x.service === service) ?? { service, uses: 0 },
      ...(service === "elevenlabs" && eleven ? { left: { ...eleven, unit: "characters" } } : {}), ...(BILLING[service] ? { billing: BILLING[service] } : {}) })) }
  },
  text: (r) => (r.services.length ? r.services.map((x: UsageRow) => `${x.service}: today ${x.today.uses}${x.today.cost ? ` ($${x.today.cost.toFixed(3)})` : ""}, this week ${x.week.uses}${x.week.cost ? ` ($${x.week.cost.toFixed(3)})` : ""}${x.left ? `; ${x.left.limit - x.left.used} of ${x.left.limit} ${x.left.unit} left` : ""}`).join("\n") : "Nothing used this week."),
})

plugin.op({
  id: "companion.page",
  cli: "companion page",
  summary: "Open the Companion page: your talk with it (asks, answers, jobs, each press's details) and what its services used.",
  help: `Written into the pages folder first when the vault doesn't have it yet (its blocks: companion-conversation,
companion-usage).

  vau companion page
  vau companion page --split right`,
  kind: "write",
  lock: false,
  params: { split: { type: "string", enum: ["right", "down"], description: "in a pane beside (right) or below (down)" }, newTab: { type: "boolean", description: "in a new tab" }, as: AS },
  run: async (p, ctx) => {
    const home = plugin.vault.pagesHome(), at = home ? `${home}/Companion.md` : "Companion.md"
    if (!fs.existsSync(plugin.vault.abs(at))) writeNew(plugin.vault.abs(at), readText(path.join(plugin.dir, "pages", "Companion.md")))
    const shown = await ctx.op("ui.open", { path: at, ...(p.split ? { split: p.split } : {}), ...(p.newTab ? { newTab: true } : {}) }).then(() => true, () => false)
    return { path: at, shown, split: str(p.split) }
  },
  text: (r) => (r.shown ? `Opened ${r.path}${r.split ? ` in a split ${r.split}` : ""}.` : `${r.path} is ready, but no window of the app is open to show it in.`),
})

plugin.block("companion-conversation", async (ctx) => (await plugin.host.call("companion.conversation", { day: ctx.today })).text)
plugin.block("companion-usage", async () => (await plugin.host.call("companion.usage", {})).text)
