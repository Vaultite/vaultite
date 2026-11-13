// OSC 7501, the Program Status Protocol (rev 0.4): a program says it's idle, working, blocked on the user, done or failed,
// and why. Everything in a report is untrusted.

export type SessionState = "idle" | "working" | "blocked" | "done" | "error"
export type Kind = "permission" | "question" | "auth"
/** One report, checked: `id` "" is the root record. */
export type Report = { state: SessionState | "clear"; id: string; kind?: Kind; progress?: number; app?: string; title?: string; msg?: string }
export type Status = { state: SessionState; kind?: Kind; msg?: string; app?: string }
export type Said = { seen: boolean; status: Status | null }

/** The answer to `OSC 7501 ; ?`: unlike the probe, so a pty that echoes it back doesn't make it a new probe. */
export const REPLY = "\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\"

const STATES = ["idle", "working", "blocked", "done", "error", "clear"] as const
const KINDS = ["permission", "question", "auth"] as const
const MAX_SEQUENCE = 4096 // OSC through ST
const MAX_BODY = MAX_SEQUENCE - "\x1b]7501;".length - 1
const MAX_RECORDS = 256
const KEY = /^[a-z]+$/
const VALUE = /^[A-Za-z0-9_.,+/=-]*$/
const APP = /^[A-Za-z0-9_.+-]{1,32}$/
const SEGMENT = /^[A-Za-z0-9_.+-]{1,32}$/
// (C0, DEL and C1: a msg or title is one line of plain text)
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/

function text(v: string, maxEnc: number, maxDec: number): string | null {
  if (v.length > maxEnc || !BASE64.test(v)) return null
  const bytes = Buffer.from(v, "base64")
  if (bytes.length > maxDec) return null
  let s: string
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(bytes) } catch { return null }
  return CONTROL.test(s) ? null : s
}

const validId = (id: string) => id.length <= 128 && id.split("/").length <= 8 && id.split("/").every((s) => SEGMENT.test(s))

/** A report's body (between `7501;` and ST): the probe, a report, or null when it's to be ignored whole. */
export function parse(body: string): Report | "probe" | null {
  if (body === "?") return "probe"
  if (body.length > MAX_BODY) return null
  const pairs = new Map<string, string>()
  for (const pair of body.split(":")) {
    const eq = pair.indexOf("=")
    if (eq < 0) continue
    const k = pair.slice(0, eq).trim(), v = pair.slice(eq + 1).trim()
    if (!k || k.length > 16 || !KEY.test(k) || !VALUE.test(v)) continue
    pairs.set(k, v)
  }
  const state = STATES.find((s) => s === pairs.get("state"))
  if (!state) return null
  const r: Report = { state, id: "" }
  const id = pairs.get("id")
  if (id !== undefined) {
    if (!validId(id)) return null
    r.id = id
  }
  for (const [k, maxEnc, maxDec] of [["msg", 2732, 2048], ["title", 256, 192]] as const) {
    const v = pairs.get(k)
    if (v === undefined) continue
    const t = text(v, maxEnc, maxDec)
    if (t === null) return null
    r[k] = t
  }
  const kind = KINDS.find((k) => k === pairs.get("kind"))
  if (state === "blocked" && kind) r.kind = kind
  const progress = pairs.get("progress")
  if ((state === "working" || state === "blocked") && progress && /^\d{1,3}$/.test(progress) && Number(progress) <= 100) r.progress = Number(progress)
  const app = pairs.get("app")
  if (app && APP.test(app)) r.app = app
  return r
}

/** What a stream said, in order: the probe, a report, a new shell prompt (OSC 133 A), a full reset (RIS). */
export type Seen = { t: "probe" } | { t: "report"; r: Report } | { t: "prompt" } | { t: "reset" }

const ESC = "\x1b", BEL = "\x07"
const Mode = { Text: 0, Esc: 1, Number: 2, Body: 3, BodyEsc: 4 } as const

export class Scanner {
  private mode: number = Mode.Text
  private num = ""
  private body = ""
  private over = false
  private extra = 0
  private osc: "7501" | "133" | "other" = "other"
  private passing = false

  feed(d: string): { out: string; seen: Seen[] } {
    const seen: Seen[] = []
    let out = ""
    let from = this.mode === Mode.Body || this.mode === Mode.BodyEsc ? (this.passing || this.osc !== "7501" ? 0 : -1) : 0
    let start = -1
    const end = (i: number) => {
      if (from < 0) from = i + 1
      this.mode = Mode.Text
    }
    for (let i = 0; i < d.length; i++) {
      const c = d[i]
      switch (this.mode) {
        case Mode.Text: {
          const at = c === ESC ? i : d.indexOf(ESC, i)
          if (at < 0) { i = d.length; break }
          i = at; this.mode = Mode.Esc; start = i; this.passing = false
          break
        }
        case Mode.Esc:
          if (c === "]") { this.mode = Mode.Number; this.num = "" }
          else if (c === "c") { seen.push({ t: "reset" }); this.mode = Mode.Text }
          else if (c === ESC) start = i
          else this.mode = Mode.Text
          break
        case Mode.Number:
          if (c >= "0" && c <= "9" && this.num.length < 6) this.num += c
          else if (c === ";") {
            this.osc = this.num === "7501" ? "7501" : this.num === "133" ? "133" : "other"
            this.mode = Mode.Body; this.body = ""; this.over = false; this.extra = 0
            if (this.osc === "7501" && !this.passing && start >= 0) {
              out += d.slice(from, start)
              from = -1
            }
          } else if (c === BEL) this.mode = Mode.Text
          else if (c === ESC) { this.mode = Mode.Esc; start = i; this.passing = false }
          else { this.osc = "other"; this.mode = Mode.Body; this.body = "" }
          break
        case Mode.Body:
          if (c === BEL) { this.finish(seen); end(i) }
          else if (c === ESC) this.mode = Mode.BodyEsc
          else if (c === "\x18" || c === "\x1a") end(i) // CAN, SUB: cancelled
          else if (this.osc !== "other" && this.body.length < (this.osc === "133" ? 4 : MAX_BODY)) this.body += c
          else if (this.osc === "7501") {
            this.over = true
            if (++this.extra > MAX_SEQUENCE) { if (from < 0) from = i; this.mode = Mode.Text }
          }
          break
        case Mode.BodyEsc:
          if (c === "\\") { this.finish(seen); end(i) }
          else {
            // ESC that isn't ST cancels the sequence and starts another.
            if (from < 0) { out += ESC; from = i }
            this.mode = Mode.Esc; start = -1; this.passing = true
            i--
          }
          break
      }
    }
    if (from >= 0) out += d.slice(from)
    if (this.mode !== Mode.Text && from >= 0) this.passing = true
    return { out, seen }
  }

  private finish(seen: Seen[]) {
    if (this.osc === "133") { if (this.body[0] === "A") seen.push({ t: "prompt" }) }
    else if (this.osc === "7501" && !this.over) {
      const r = parse(this.body)
      if (r === "probe") seen.push({ t: "probe" })
      else if (r) seen.push({ t: "report", r })
    }
  }
}

type Record = Omit<Report, "id" | "state"> & { state: SessionState; at: number }

export class Records {
  private map = new Map<string, Record>()
  private tick = 0
  seen = false

  take(x: Seen): boolean {
    if (x.t === "report") return this.report(x.r)
    if (x.t === "prompt") return this.drop()
    if (x.t === "reset") { const had = this.map.size > 0; this.map.clear(); return had }
    return false
  }

  report(r: Report): boolean {
    this.seen = true
    if (r.state === "clear") {
      if (!r.id) { this.map.clear(); return true }
      for (const k of [...this.map.keys()]) if (k === r.id || k.startsWith(`${r.id}/`)) this.map.delete(k)
      return true
    }
    const rest: Partial<Report> = { ...r }
    delete rest.id
    if (!this.map.has(r.id) && this.map.size >= MAX_RECORDS) {
      let oldest = ""
      let at = Infinity
      for (const [k, v] of this.map) if (v.at < at) { at = v.at; oldest = k }
      this.map.delete(oldest)
    }
    this.map.delete(r.id) // (Map order: newest last)
    this.map.set(r.id, { ...rest, state: r.state, at: ++this.tick })
    return true
  }

  /** Its program ended or a shell prompt began: working and blocked records go, done and error stay (idle too). */
  drop(): boolean {
    let changed = false
    for (const [k, v] of this.map) if (v.state === "working" || v.state === "blocked") { this.map.delete(k); changed = true }
    return changed
  }

  private appOf(id: string): string | undefined {
    for (let k = id; ; k = k.includes("/") ? k.slice(0, k.lastIndexOf("/")) : "") {
      const app = this.map.get(k)?.app
      if (app || !k) return app
    }
  }

  /** The terminal's state: blocked anywhere (it needs the user), else the root record's, else its children's (working,
   *  then error, done, idle); the latest record of that state speaks. Null with no records. */
  status(): Status | null {
    if (!this.map.size) return null
    const latest = (state: SessionState) => { let hit: [string, Record] | null = null; for (const e of this.map) if (e[1].state === state) hit = e; return hit }
    const root = this.map.get("")
    const pick: [string, Record] | null = root?.state === "blocked" ? ["", root] : latest("blocked") ?? (root ? ["", root] : null)
      ?? latest("working") ?? latest("error") ?? latest("done") ?? latest("idle")
    if (!pick) return null
    const [id, r] = pick
    const app = this.appOf(id)
    return { state: r.state, ...(r.state === "blocked" && r.kind ? { kind: r.kind } : {}), ...(r.msg ? { msg: r.msg } : {}), ...(app ? { app } : {}) }
  }

  said(): Said { return { seen: this.seen, status: this.status() } }

  ids(): string[] { return [...this.map.keys()] }
}

/** One stream's protocol: what to pass on, whether what it says changed, and `answer` called for each probe, before
 *  anything after it in the stream is read (so before a primary DA that follows it is answered). */
export function watcher(answer: () => void) {
  const scan = new Scanner(), records = new Records()
  return {
    records,
    feed(d: string): { out: string; changed: boolean } {
      const { out, seen } = scan.feed(d)
      let changed = false
      for (const x of seen) {
        if (x.t === "probe") { answer(); changed ||= !records.seen; records.seen = true }
        else changed = records.take(x) || changed
      }
      return { out, changed }
    },
  }
}

/** A msg as shown outside the terminal: invisible formatting and direction overrides taken out, at most `max` characters. */
export function shown(msg: string | undefined, max = 300): string | undefined {
  const t = msg?.replace(/[؜​-‏‪-‮⁠-⁩﻿]/g, "").trim()
  return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : undefined
}
