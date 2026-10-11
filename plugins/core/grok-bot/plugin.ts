// Grok Bot: what Cursor's always-on cloud agent did, from Cursor's dashboard with Cursor.app's sign-in (the read it
// shares with Cursor's plugin, core/cursoraccount.ts): its week, its value by day and model, its conversations.
import { ago, codingAgent, isoOf, limitRows, limitWindow, scanDays, Tally } from "../../../core/codingagents.ts"
import { clampPct, cursorAccount, type CursorAccount, cursorModelName, forgetCursorAccount, isGrokBot, minutesBetween, NO_ACCOUNT,
  secOf } from "../../../core/cursoraccount.ts"
import { localDate, Plugin, section } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)
const GAP = 5 * 60_000 // requests further apart than this aren't one stretch of work
const dayOf = (ms: number) => localDate(new Date(ms))

/** Whether the user allowed reading their account (unset: not asked yet). */
const allowed = () => plugin.settings().account === true
async function readAccount(days: number): Promise<CursorAccount> {
  const a = await cursorAccount(days)
  return { summary: a.summary, events: a.events && a.events.filter((e) => isGrokBot(e.model)) }
}
const account = (): Promise<CursorAccount> => (allowed() ? plugin.memo(300, readAccount, scanDays()) : Promise.resolve(NO_ACCOUNT))

// The dashboard says only a conversation's id: its title is the id's start.
const titleOf = (id: string) => `Conversation ${id.slice(0, 8)}`

/** Value = the tokens at API rates as Cursor prices them. Time working is the gaps under 5 min between a conversation's
 *  requests; a request with no conversation counts on its own. */
async function summary(days: number) {
  const evs = (await account()).events ?? []
  const t = new Tally(days)
  const start = +new Date(`${t.start}T00:00:00`)
  const all = t.project("\0grok-bot", null, "Grok Bot") // (no folders: one project, no project blocks)
  const prev = new Map<string, number>()
  for (const e of evs.filter((x) => x.ts >= start)) {
    const conv = e.conversation || `request-${e.ts}`
    const gap = prev.has(conv) ? e.ts - prev.get(conv)! : GAP
    prev.set(conv, e.ts)
    const s = e.conversation ? t.session(e.conversation, () => ({ title: titleOf(e.conversation), project: "", root: "", model: e.model })) : undefined
    t.count({ ts: e.ts, day: dayOf(e.ts), cost: e.value, tokens: e.input + e.output + e.read + e.write, read: e.read, prompt: e.input + e.read + e.write,
      model: cursorModelName(e.model), min: gap < GAP ? gap / 60000 : 0 }, conv, all, s, e.model)
  }
  return t.result(cursorModelName)
}

/** A conversation as the dashboard knows it: when and with which model; what was said stays in Grok Bot. */
async function conversation(id: string) {
  const evs = ((await account()).events ?? []).filter((e) => e.conversation === id)
  if (!evs.length) return null
  return { title: titleOf(id), cwd: "", model: evs[evs.length - 1].model, first: isoOf(evs[0].ts) ?? "", last: isoOf(evs[evs.length - 1].ts) ?? "",
    branch: "", entries: [] }
}

/** Its week, as Cursor's dashboard says (`sand`: Grok Bot's internal name), or null on a plan without it. */
async function limits() {
  const acc = (await account()).summary
  const sand = acc?.sand
  if (!acc || !sand || sand.hasNonZeroIncludedLimit === false || sand.includedLimitZero === true || typeof sand.usagePercent !== "number") return null
  const w = limitWindow("week", "This week", minutesBetween(sand.currentPeriodStart, sand.nextResetTimestampUtc) || 10080, clampPct(sand.usagePercent),
    secOf(sand.nextResetTimestampUtc), Date.now() / 1000)
  return { source: "Cursor dashboard", observed: isoOf(acc.at), windows: [w] }
}

// ---------- blocks as text (GET /api/render)

plugin.block("grok-bot-limits", async () => {
  const lim = await limits()
  if (!lim) return section("Grok Bot", `_${allowed() ? "No week read yet: it comes from Cursor's dashboard, with Cursor.app signed in on this machine, on a plan with Grok Bot."
    : "Grok Bot's usage isn't read: allow it in Grok Bot's settings (Read Grok Bot's usage from your Cursor account)."}_`)
  return section("Grok Bot", limitRows(lim.windows), `_From the ${lim.source}, ${ago(lim.observed)}._`)
})

codingAgent(plugin, { id: "grok-bot", name: "Grok Bot", prefix: "grok-bot", noun: "conversation", count: "conversation", value: "estimated at list prices",
  estimate: true, cloud: true, state: () => "Working", sessionId: /^[\w.-]{4,100}$/, summary, live: async () => [],
  plan: async () => ({ plan: null, limits: await limits() }), session: conversation, modelName: cursorModelName, forget: forgetCursorAccount })
