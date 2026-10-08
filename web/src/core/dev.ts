// What agents ask this window for through the server (core/live.ts ask; ops in core/coreops/dev.ts, the owner's only):
// its palette's commands, and the dev tools: its console's last messages, its HTML, eval, a screenshot (desktop app).
import { available, commandList, keysOf } from "@/core/commands"
import { desktop } from "@/core/desktop"
import { answerUi } from "@/core/live"
import { trace } from "@/core/trace"

type Line = { t: number; level: string; text: string }
const MAX = 500, TEXT = 4000, HTML = 100_000
const lines: Line[] = []

/** A value as a line of text, the way the console would show it. */
function shown(v: unknown): string {
  if (typeof v === "string") return v
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`
  try { return JSON.stringify(plain(v)) ?? String(v) } catch { return String(v) }
}

function keep(level: string, args: unknown[]) {
  const text = args.map(shown).join(" ").slice(0, TEXT)
  lines.push({ t: Date.now(), level, text })
  if (level === "warn" || level === "error") trace("console", { level, text: text.slice(0, 500) })
  if (lines.length > MAX) lines.splice(0, lines.length - MAX)
}

// The console's messages and the uncaught errors, kept from as early as this module loads (main.tsx imports it first).
for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const original = console[level].bind(console)
  console[level] = (...args: unknown[]) => {
    try { keep(level, args) } catch { /* never in the way of the log */ }
    original(...args)
  }
}
addEventListener("error", (e) => keep("error", [e.error ?? e.message]))
addEventListener("unhandledrejection", (e) => keep("error", ["Unhandled rejection:", e.reason]))

/** A value made JSON: DOM nodes as their HTML, errors as their message, cycles and depth cut. */
function plain(v: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (v === undefined) return null
  if (v === null || typeof v === "string" || typeof v === "boolean") return v
  if (typeof v === "number") return Number.isFinite(v) ? v : String(v)
  if (typeof v !== "object") return String(v)
  if (v instanceof Error) return { error: v.message, stack: v.stack ?? null }
  if (typeof Element !== "undefined" && v instanceof Element) return cut(v.outerHTML)
  if (typeof Node !== "undefined" && v instanceof Node) return v.textContent
  if (seen.has(v)) return "[circular]"
  if (depth > 8) return "[...]"
  seen.add(v)
  const next = (x: unknown) => plain(x, seen, depth + 1)
  if (Array.isArray(v) || v instanceof Set || (typeof NodeList !== "undefined" && v instanceof NodeList) || (typeof HTMLCollection !== "undefined" && v instanceof HTMLCollection)) {
    return [...(v as Iterable<unknown>)].slice(0, 1000).map(next)
  }
  if (v instanceof Map) return Object.fromEntries([...v].slice(0, 1000).map(([k, x]) => [String(k), next(x)]))
  const toJSON = (v as { toJSON?: () => unknown }).toJSON
  if (typeof toJSON === "function") { try { return next(toJSON.call(v)) } catch { /* as an object */ } }
  return Object.fromEntries(Object.entries(v).slice(0, 1000).map(([k, x]) => [k, next(x)]))
}

/** Code run in the page's global scope (indirect eval): a statement list's last value, a promise's once it settles. With
 *  `await` at its top level, as an async function's body: an expression's value, else what it returns. */
async function run(code: string): Promise<unknown> {
  // eslint-disable-next-line no-eval
  const indirect = eval
  if (!/\bawait\b/.test(code)) return await indirect(code)
  try {
    return await indirect(`(async () => (${code.replace(/;\s*$/, "")}\n))()`)
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e
    return await indirect(`(async () => {${code}\n})()`) // (a SyntaxError is thrown before anything ran)
  }
}

const cut = (s: string) => (s.length > HTML ? `${s.slice(0, HTML)}... (${s.length - HTML} more characters)` : s)
const str = (x: unknown) => (typeof x === "string" ? x : "")

answerUi("commands", () => commandList().map((c) => ({ id: c.id, name: c.name, keys: keysOf(c), available: available([c]).length > 0 })))

answerUi("dev", async (m) => {
  if (m.what === "console") {
    const level = str(m.level), limit = typeof m.limit === "number" ? m.limit : 50
    const out = lines.filter((l) => !level || l.level === level).slice(-limit)
    if (m.clear) lines.length = 0
    return { entries: out, kept: lines.length }
  }
  if (m.what === "dom") {
    const selector = str(m.selector)
    const els = [...document.querySelectorAll(selector)]
    const attr = str(m.attr)
    const one = (el: Element) => (attr ? el.getAttribute(attr) : m.text ? cut(el.textContent ?? "") : m.inner ? cut(el.innerHTML) : cut(el.outerHTML))
    return { selector, count: els.length, matches: (m.all ? els : els.slice(0, 1)).map(one) }
  }
  if (m.what === "eval") return { value: plain(await run(str(m.code))) }
  if (m.what === "screenshot") {
    if (!desktop?.capture) throw new Error("screenshots need the desktop app: this window is a browser (dev dom and dev eval read it)")
    let rect: { x: number; y: number; width: number; height: number } | undefined
    if (str(m.selector)) {
      const el = document.querySelector(str(m.selector))
      if (!el) throw new Error(`nothing matches ${str(m.selector)}`)
      const b = el.getBoundingClientRect()
      rect = { x: b.left, y: b.top, width: b.width, height: b.height }
    }
    return await desktop.capture(rect)
  }
  throw new Error(`no dev tool '${String(m.what)}'`)
})
