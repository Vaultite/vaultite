// A terminal's screen and history (libghostty-vt) in a thread of its own (screenworker.ts): a parse that never returns
// stops that one screen, never the terminal server's loop. One that hasn't answered for HUNG starts again blank.
import { Worker } from "node:worker_threads"
import { vtModule } from "../vt/load.ts"
import type { Capture, CaptureFormat } from "./protocol.ts"

/** How long a screen may take over what it was given before it's taken as stuck: a full batch parsed, or a whole
 *  history as html, takes well under a second, a few on a loaded machine. */
export const HUNG = 10_000
/** Started again this many times in a minute, it stays off (blank): its thread can't run here. */
const RESTARTS_MAX = 3

export type ScreenOptions = {
  cols: number; rows: number; scrollback: number
  onTitle?(title: string): void
  /** Its answers to the program's questions (DA, cursor position...). */
  onReply?(data: string): void
  /** It failed or was stuck, and starts again blank: what happened, said for the log and the app. */
  onTrouble?(text: string): void
}

type Waiting = { n: number; at: number; bytes: number; ok?: (v: never) => void; fail?: (e: Error) => void }
type Said = { n: number; app: boolean; paste: boolean; out?: unknown; error?: string; title?: string; reply?: string }

/** Every screen with a thread, looked at each second for one that's stuck. */
const screens = new Set<Screen>()
let looking: ReturnType<typeof setInterval> | null = null

export class Screen {
  cols: number; rows: number
  readonly scrollback: number
  cell = { width: 8, height: 16 }
  /** Output given to it and not yet parsed (UTF-16 units): the pty waits past HOLD (host.ts). */
  inflight = 0
  private o: ScreenOptions
  private w: Worker | null = null
  private n = 0
  private waiting: Waiting[] = []
  /** Its modes as of what it parsed last: application cursor keys (1), bracketed paste (2004). */
  private modes = { app: false, paste: false }
  private restarts: number[] = []
  private off = false

  constructor(o: ScreenOptions) {
    this.o = o
    this.cols = o.cols; this.rows = o.rows; this.scrollback = o.scrollback
    this.start()
    screens.add(this)
    looking ??= setInterval(() => { const now = performance.now(); for (const s of screens) s.check(now) }, 1000)
    looking.unref?.()
  }

  private start() {
    const w = new Worker(new URL("./screenworker.ts", import.meta.url),
      { workerData: { module: vtModule(), cols: this.cols, rows: this.rows, scrollback: this.scrollback } })
    this.w = w
    w.unref()
    w.on("message", (m: Said) => { if (this.w === w) this.heard(m) })
    w.on("error", (e) => { if (this.w === w) this.restart(`its screen's thread failed (${e.message})`) })
    w.on("exit", (code) => { if (this.w === w) this.restart(`its screen's thread ended (${code})`) })
    if (this.cell.width !== 8 || this.cell.height !== 16) this.post({ op: "resize", cols: this.cols, rows: this.rows, cw: this.cell.width, ch: this.cell.height })
  }

  private heard(m: Said) {
    // (answered in order: what it answers is the oldest still waiting)
    const x = this.waiting[0]
    if (!x || x.n !== m.n) return
    this.waiting.shift()
    this.inflight -= x.bytes
    this.modes = { app: m.app, paste: m.paste }
    if (m.title !== undefined) this.o.onTitle?.(m.title)
    if (m.reply) this.o.onReply?.(m.reply)
    const failed = (m.out as { failed?: string } | undefined)?.failed
    if (failed && !x.ok) this.o.onTrouble?.(`libghostty-vt failed on its output (${failed}): a blank screen from here`)
    if (m.error) x.fail?.(new Error(m.error)); else x.ok?.(m.out as never)
  }

  private post(m: Record<string, unknown>, bytes = 0, ok?: Waiting["ok"], fail?: Waiting["fail"]) {
    if (this.off || !this.w) { fail?.(new Error("its screen is off")); return }
    const n = ++this.n
    this.waiting.push({ n, at: performance.now(), bytes, ok, fail })
    this.inflight += bytes
    this.w.postMessage({ n, ...m })
  }
  private ask<T>(m: Record<string, unknown>) { return new Promise<T>((ok, fail) => this.post(m, 0, ok as Waiting["ok"], fail)) }

  /** Output, parsed in its thread in the order given. */
  write(d: string) { if (d) this.post({ op: "write", d }, d.length) }
  resize(cols: number, rows: number, cellWidth = this.cell.width, cellHeight = this.cell.height) {
    this.cols = cols; this.rows = rows; this.cell = { width: cellWidth, height: cellHeight }
    this.post({ op: "resize", cols, rows, cw: cellWidth, ch: cellHeight })
  }
  /** One of the modes kept here (1: application cursor keys, 2004: bracketed paste), as of what it parsed last. */
  mode(n: 1 | 2004) { return n === 1 ? this.modes.app : this.modes.paste }
  /** What it shows once what it was given before is parsed: `lines` from its bottom, or all of it (null). */
  capture(format: CaptureFormat, lines: number | null) { return this.ask<Capture>({ op: "capture", format, lines }) }
  /** Its screen and history replayable, pictures first (kitty.ts withPictures). */
  snapshot() { return this.ask<string>({ op: "snapshot" }) }
  text(lines: number) { return this.ask<string>({ op: "text", lines }) }

  /** Stuck past HUNG on what it was given: started again blank. */
  check(now = performance.now()) {
    const at = this.waiting[0]?.at
    if (at === undefined || now - at < HUNG) return false
    this.restart(`its screen didn't finish parsing its output in ${Math.round((now - at) / 1000)} s (libghostty-vt stuck on it)`)
    return true
  }

  private restart(why: string) {
    const old = this.w, pending = this.waiting.splice(0)
    this.w = null
    this.inflight = 0
    this.modes = { app: false, paste: false }
    void old?.terminate()
    const now = performance.now()
    this.restarts = [...this.restarts.filter((t) => now - t < 60_000), now]
    if (this.restarts.length > RESTARTS_MAX) {
      this.off = true
      screens.delete(this)
      this.o.onTrouble?.(`${why}, ${this.restarts.length} times in a minute: its screen stays blank (its program and the pages showing it carry on)`)
    } else {
      this.start()
      this.o.onTrouble?.(`${why}: started again blank (its program and the pages showing it carry on)`)
    }
    for (const x of pending) x.fail?.(new Error(`${why}: started again blank`))
  }

  dispose() {
    if (this.off && !this.w) return
    this.off = true
    screens.delete(this)
    void this.w?.terminate()
    this.w = null
    this.inflight = 0
    for (const x of this.waiting.splice(0)) x.fail?.(new Error("its terminal ended"))
  }
}
