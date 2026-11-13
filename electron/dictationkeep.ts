// Each dictation's words, kept on this Mac (the app's userData, never the vault, never synced) for the Dictations list,
// a file a day, KEEP_DAYS of them. Written as they settle, so words a closed app never landed are kept too. No Electron.
import fs from "node:fs"
import path from "node:path"
import { joinText } from "../core/dictationtext.ts"
import { z } from "zod"

export const KEEP_DAYS = 30
/** Where its words were going: a note, a terminal or a field of the app's; another app (the helper's, `name`). */
export type Where = { kind: "note" | "terminal" | "field" | "app"; path?: string; name?: string; bundle?: string }
/** How it ended up: `in` typed where it was going; `front`/`origin` the helper put it in an app; `clipboard` copied (and
 *  in the inbox, `inbox`); `cancelled`; `lost` never landed (the app closed, it failed); `live` still listening. */
export type Landing = "in" | "front" | "origin" | "clipboard" | "cancelled" | "lost" | "live"
export type Kept = { id: string; t: number; text: string; where: Where; landing: Landing; inbox?: boolean; why?: string }

const opt = <T extends z.ZodType>(s: T) => s.optional().catch(undefined)
const LINE = z.object({ t: z.number(), id: z.string(), ev: z.enum(["start", "words", "pending", "end", "landed"]), text: opt(z.string()), in: opt(z.boolean()), reason: opt(z.string()),
  to: opt(z.string()), name: opt(z.string()), inbox: opt(z.boolean()),
  where: opt(z.object({ kind: z.enum(["note", "terminal", "field", "app"]), path: opt(z.string()), name: opt(z.string()), bundle: opt(z.string()) })) })
type Line = z.infer<typeof LINE>
const MOVED = z.enum(["front", "origin", "clipboard"])
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }
const FILE = /^dictations-(\d{4}-\d{2}-\d{2})\.jsonl$/
/** Words compared loosely: any case, no accents. */
const loose = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

/** A dictation under way: its words as they settle (`landed`: typed where they go), what's heard but not settled, and
 *  how it ended. */
export type Keeping = { words: (text: string, landed: boolean) => void; pending: (text: string) => void; end: (reason: string) => void
  landed: (o: { to: string; name?: string; text?: string; inbox?: boolean }) => void; id: string }

export function dictationKeep(dir: () => string, now = Date.now) {
  let n = 0, pruned = ""
  const live = new Set<string>()
  function write(line: Line) {
    try {
      const d = dir()
      fs.mkdirSync(d, { recursive: true, mode: 0o700 })
      fs.appendFileSync(path.join(d, `dictations-${day(line.t)}.jsonl`), `${JSON.stringify(line)}\n`, { mode: 0o600 })
      prune()
    } catch { /* keeping never stops a dictation */ }
  }
  function files() { try { return fs.readdirSync(dir()).filter((f) => FILE.test(f)).sort() } catch { return [] } }
  function prune() {
    const today = day(now())
    if (pruned === today) return
    pruned = today
    const oldest = day(now() - KEEP_DAYS * 86_400_000)
    for (const f of files()) if (FILE.exec(f)![1] < oldest) fs.rmSync(path.join(dir(), f), { force: true })
  }
  function lines(): Line[] {
    prune()
    return files().flatMap((f) => {
      try { return fs.readFileSync(path.join(dir(), f), "utf8").split("\n").flatMap((l) => { try { return l ? LINE.safeParse(JSON.parse(l)).data ?? [] : [] } catch { return [] } }) } catch { return [] }
    })
  }
  /** The dictations kept, newest first, each folded from its lines; none with no words. */
  function all(): Kept[] {
    const by = new Map<string, Line[]>()
    for (const l of lines()) by.set(l.id, [...(by.get(l.id) ?? []), l])
    const out: Kept[] = []
    for (const [id, ls] of by) {
      const start = ls.find((l) => l.ev === "start"), end = ls.find((l) => l.ev === "end"), landed = ls.findLast((l) => l.ev === "landed")
      const words = ls.filter((l) => l.ev === "words" && l.text)
      // (heard but never settled: what a closed app or a failure cut off)
      const lastWords = ls.findLastIndex((l) => l.ev === "words"), tail = ls.findLast((l, i) => l.ev === "pending" && i > lastWords && !!l.text)
      // (a window's that moved on to the helper before any words settled: the helper's keeps them)
      if (end?.reason === "moved" && !words.length) continue
      const settled = words.reduce((s, w) => s + joinText(s, w.text!), "")
      let landing: Landing, why: string | undefined
      if (landed) landing = MOVED.safeParse(landed.to).data ?? "in"
      else if (words.length && words.every((w) => w.in)) landing = "in"
      else if (end?.reason === "cancel") landing = "cancelled"
      else if (!end && live.has(id)) landing = "live"
      else { landing = "lost"; why = !end ? "closed" : end.reason === "error" ? "failed" : end.reason === "elsewhere" ? "elsewhere" : "nowhere" }
      const text = (landed?.text ?? ((landing === "lost" || landing === "live") && tail ? settled + joinText(settled, tail.text!) : settled)).trim()
      if (!text) continue
      const where: Where = { ...(start?.where ?? { kind: "app" }), ...(landed?.name && (landed.to === "front" || landed.to === "origin") ? { kind: "app" as const, name: landed.name } : {}) }
      out.push({ id, t: start?.t ?? ls[0].t, text, where, landing, ...(landed?.inbox ? { inbox: true } : {}), ...(why ? { why } : {}) })
    }
    return out.sort((a, b) => b.t - a.t)
  }
  return {
    /** A dictation begins, its words going to `where`. */
    start(where: Where): Keeping {
      const t0 = now(), id = `d-${t0.toString(36)}-${++n}`
      live.add(id)
      write({ t: t0, id, ev: "start", where })
      let said = "", at = 0, ended = false
      return {
        id,
        words: (text, landed) => { if (text.trim()) { said = ""; write({ t: now(), id, ev: "words", text, ...(landed ? { in: true } : {}) }) } },
        // (at most every 3 s: what a crash would cut off)
        pending: (text) => { if (text === said || now() - at < 3000) return; said = text; at = now(); write({ t: at, id, ev: "pending", text }) },
        end: (reason) => { if (ended) return; ended = true; live.delete(id); write({ t: now(), id, ev: "end", reason }) },
        landed: (o) => { live.delete(id); write({ t: now(), id, ev: "landed", to: o.to, ...(o.name ? { name: o.name } : {}), ...(o.text ? { text: o.text } : {}), ...(o.inbox ? { inbox: true } : {}) }) },
      }
    },
    /** The kept dictations, newest first: those whose words or where have every word of `q`, `limit` of them; `total`, how many match. */
    list(o: { q?: string; limit?: number } = {}) {
      const words = loose(o.q ?? "").split(/\s+/).filter(Boolean)
      const hit = all().filter((k) => { const hay = loose(`${k.text} ${k.where.name ?? ""} ${k.where.path ?? ""}`); return words.every((w) => hay.includes(w)) })
      return { items: hit.slice(0, Math.max(1, Math.min(1000, o.limit ?? 200))), total: hit.length }
    },
    /** One taken out. */
    forget(id: string) {
      for (const f of files()) {
        const p = path.join(dir(), f)
        try {
          const text = fs.readFileSync(p, "utf8"), kept = text.split("\n").filter((l) => l && !l.includes(`"id":${JSON.stringify(id)}`))
          if (kept.length !== text.split("\n").filter(Boolean).length) { if (kept.length) fs.writeFileSync(p, `${kept.join("\n")}\n`); else fs.rmSync(p, { force: true }) }
        } catch { /* gone */ }
      }
    },
    /** All of them gone. */
    clear() { for (const f of files()) fs.rmSync(path.join(dir(), f), { force: true }) },
  }
}
