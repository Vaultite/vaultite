// Cursor's account, read for the plugins that show it (Cursor, Grok Bot): its dashboard API with Cursor.app's sign-in.
// One read serves both, kept 5 minutes here; each plugin asks only once its user allowed it.
import path from "node:path"
import { HOME, SqliteFile } from "../../../core/agents.ts"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** Cursor.app's User folder (CURSOR_USER_DIR: the tests'), and its state database (its chats, its sign-in). */
export const CURSOR_USER_DIR = process.env.CURSOR_USER_DIR || path.join(HOME, "Library", "Application Support", "Cursor", "User")
export const cursorState = new SqliteFile(path.join(CURSOR_USER_DIR, "globalStorage", "state.vscdb"))

// The JWT is read per fetch, sent only to Cursor, never logged or kept, not once expired. CURSOR_API_URL: the tests'.
const API = (process.env.CURSOR_API_URL || "https://cursor.com").replace(/\/+$/, "")
const TIMEOUT = 15_000

export const text = (v: unknown) => (v instanceof Uint8Array ? Buffer.from(v).toString("utf8") : v == null ? "" : String(v))

/** Values from the IDE's ItemTable, by key. */
export async function stored(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const k of keys) {
    const v = cursorState.all("SELECT value FROM ItemTable WHERE key = ?", k)[0]?.value
    if (v != null) out[k] = text(v)
  }
  return out
}

/** The dashboard's cookie from the IDE's session, or null (signed out, expired, unreadable). */
async function cookie(): Promise<string | null> {
  const token = (await stored(["cursorAuth/accessToken"]))["cursorAuth/accessToken"]?.trim()
  if (!token) return null
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"))
    const user = String(p.sub ?? "").split("|").pop() ?? ""
    if (!/^[\w.-]+$/.test(user) || (typeof p.exp === "number" && p.exp * 1000 < Date.now() + 60_000)) return null
    return `WorkosCursorSessionToken=${user}%3A%3A${token}`
  } catch {
    return null
  }
}

async function call(route: string, c: string, body?: unknown): Promise<Any> {
  const headers: Record<string, string> = { Accept: "application/json", Cookie: c }
  // Cursor's dashboard POSTs check the Origin (CSRF).
  if (body !== undefined) Object.assign(headers, { "Content-Type": "application/json", Origin: new URL(API).origin })
  const res = await fetch(API + route, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT) })
  if (!res.ok) throw new Error(`Cursor answered ${res.status} for ${route}`)
  return res.json()
}

/** The plan and its allowances, and Grok Bot's week (`sand`: null on a plan without it), when they were read (ms). */
export type Summary = { summary: Any; sand: Any | null; at: number }

/** The plan and its allowances now, or null when there's no session to ask with. */
async function fetchSummary(): Promise<Summary | null> {
  const c = await cookie()
  if (!c) return null
  const summary = await call("/api/usage-summary", c)
  const sand = await call("/api/dashboard/get-sand-usage-status", c, {}).catch(() => null) // not every plan has Grok Bot
  return { summary, sand, at: Date.now() }
}

/** One request Cursor metered: when (ms), which model, tokens, value at API rates (USD), which conversation. */
export type Metered = { ts: number; model: string; conversation: string; input: number; output: number; read: number; write: number
  value: number | null }

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }

/** The usage events since `since` (ms), oldest first, or null when there's no session to ask with. */
async function fetchEvents(since: number): Promise<Metered[] | null> {
  const c = await cookie()
  if (!c) return null
  const out: Metered[] = []
  const size = 500
  for (let page = 1; page <= 40; page++) {
    const r = await call("/api/dashboard/get-filtered-usage-events", c, { page, pageSize: size, startDate: String(Math.floor(since)), endDate: String(Date.now()) })
    const rows: Any[] = Array.isArray(r?.usageEventsDisplay) ? r.usageEventsDisplay : []
    for (const e of rows) {
      const ts = num(e.timestamp)
      if (!ts) continue
      const t = e.tokenUsage ?? {}
      const cents = t.totalCents == null ? null : Number(t.totalCents)
      const tok = num(t.inputTokens) + num(t.outputTokens) + num(t.cacheReadTokens) + num(t.cacheWriteTokens)
      // No tokens and no price: a request Cursor didn't meter by tokens (worth what it charged, often nothing).
      const value = cents != null && Number.isFinite(cents) && cents >= 0 ? cents / 100 : !tok ? num(e.chargedCents) / 100 : null
      out.push({ ts, model: String(e.model || "unknown"), conversation: String(e.conversationId ?? "").replace(/^null$/, ""),
        input: num(t.inputTokens), output: num(t.outputTokens), read: num(t.cacheReadTokens), write: num(t.cacheWriteTokens), value })
    }
    if (rows.length < size) break
  }
  // Pages can repeat a row at their edges: the same request twice is one.
  const seen = new Set<string>()
  return out.filter((e) => {
    const k = `${e.ts}:${e.model}:${e.conversation}:${e.input}:${e.output}:${e.read}:${e.value}`
    return seen.has(k) ? false : (seen.add(k), true)
  }).sort((a, b) => a.ts - b.ts)
}

// ---------- the account, kept 5 minutes (the last answer stays when a fetch fails)

export type CursorAccount = { summary: Summary | null; events: Metered[] | null }
export const NO_ACCOUNT: CursorAccount = { summary: null, events: null }
let lastGood: CursorAccount = NO_ACCOUNT
let kept: { at: number; days: number; got: Promise<CursorAccount> } | null = null

async function read(days: number): Promise<CursorAccount> {
  const since = Date.now() - days * 86400_000
  const [s, e] = await Promise.all([fetchSummary().catch(() => undefined), fetchEvents(since).catch(() => undefined)])
  lastGood = { summary: s === undefined ? lastGood.summary : s, events: e === undefined ? lastGood.events : e }
  return lastGood
}

/** The account's last `days`: callers in the same 5 minutes share one read (one asking for more days reads again). */
export function cursorAccount(days: number): Promise<CursorAccount> {
  if (kept && Date.now() - kept.at < 300_000 && kept.days >= days) return kept.got
  kept = { at: Date.now(), days, got: read(days) }
  return kept.got
}

/** Read it again on the next ask (a block's Refresh). */
export const forgetCursorAccount = () => { kept = null }

// ---------- what the plugins say of it

/** Grok Bot's requests (its cloud agent) are metered as models of their own: grok-bot-default, grok-bot-automation. */
export const isGrokBot = (model: string) => model.startsWith("grok-bot")

/** grok-bot-default -> Grok Bot, claude-4.5-sonnet-thinking -> Claude 4.5 Sonnet thinking, gpt-5 -> GPT-5. */
export function cursorModelName(m: string) {
  if (!m || m === "default" || m === "auto") return "Auto"
  const words = m.replace(/-default$/, "").split("-")
  const out: string[] = []
  for (const w of words) {
    const prev = out[out.length - 1]
    if (/^\d/.test(w) && prev && /^gpt|^o\d/i.test(prev)) out[out.length - 1] = `${prev}-${w}` // gpt-5, not GPT 5
    else out.push(w)
  }
  return out.map((w, i) => (/^gpt/i.test(w) ? w.toUpperCase() : i === 0 || /^(bot|sonnet|opus|haiku|flash|pro|mini|nano|codex)$/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ")
}

/** A percentage Cursor wrote, 0 to 100 to a tenth. */
export const clampPct = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.min(Math.max(n, 0), 100) * 10) / 10 : 0 }
/** Minutes between two times Cursor wrote, or 0. */
export const minutesBetween = (a: unknown, b: unknown) => { const m = (Date.parse(String(b)) - Date.parse(String(a))) / 60000; return Number.isFinite(m) && m > 0 ? Math.round(m) : 0 }
/** A time Cursor wrote (ISO or ms) as epoch s, or null. */
export const secOf = (v: unknown) => (v ? +new Date(v as string) / 1000 || null : null)
