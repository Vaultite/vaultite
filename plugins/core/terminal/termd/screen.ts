import { Worker } from "node:worker_threads"
import { vtModule } from "../vt/load.ts"
import type { Capture, CaptureFormat } from "./protocol.ts"

export const HUNG = 10_000
const RESTARTS_MAX = 3

export type ScreenOptions = {
  cols: number; rows: number; scrollback: number
  onTitle?(title: string): void
  onReply?(data: string): void
  onTrouble?(text: string): void
  onBlank?(): void
}

type Waiting = { n: number; at: number; bytes: number; ok?: (v: never) => void; fail?: (e: Error) => void }
type Said = { n: number; app: boolean; paste: boolean; out?: unknown; error?: string; title?: string; reply?: string }

const screens = new Set<Screen>()
let looking: ReturnType<typeof setInterval> | null = null

export class Screen {
  cols: number; rows: number
  readonly scrollback: number
  cell = { width: 8, height: 16 }
  inflight = 0
  private o: ScreenOptions
  private w: Worker | null = null
  private n = 0
  private waiting: Waiting[] = []
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
      { workerData: { module: vtModule(), cols: this.cols, rows: this.rows, scrollback: this.scrollback, modes: this.modes } })
    this.w = w
    w.unref()
    w.on("message", (m: Said) => { if (this.w === w) this.heard(m) })
    w.on("error", (e) => { if (this.w === w) this.restart(`its screen's thread failed (${e.message})`) })
    w.on("exit", (code) => { if (this.w === w) this.restart(`its screen's thread ended (${code})`) })
    if (this.cell.width !== 8 || this.cell.height !== 16) this.post({ op: "resize", cols: this.cols, rows: this.rows, cw: this.cell.width, ch: this.cell.height })
  }

  private heard(m: Said) {
    const x = this.waiting[0]
    if (!x || x.n !== m.n) return
    this.waiting.shift()
    this.inflight -= x.bytes
    this.modes = { app: m.app, paste: m.paste }
    if (m.title !== undefined) this.o.onTitle?.(m.title)
    if (m.reply) this.o.onReply?.(m.reply)
    const failed = (m.out as { failed?: string } | undefined)?.failed
    if (failed && !x.ok) { this.o.onTrouble?.(`libghostty-vt failed on its output (${failed}): started again blank`); this.o.onBlank?.() }
    if (m.error) x.fail?.(new Error(m.error)); else x.ok?.(m.out as never)
  }

  private post(m: Record<string, unknown>, bytes = 0, ok?: Waiting["ok"], fail?: Waiting["fail"]) {
    if (this.off || !this.w) { fail?.(new Error("its screen is off")); return }
    const n = ++this.n
    this.waiting.push({ n, at: performance.now(), bytes, ok, fail })
    this.inflight += bytes
    this.w.postMessage({ n, ...m })
  }
  private ask<T>(m: Record<string, unknown>) { return new Promise<T>((ok, fail) => this.post(m, 0, ok, fail)) }

  write(d: string) { if (d) this.post({ op: "write", d }, d.length) }
  resize(cols: number, rows: number, cellWidth = this.cell.width, cellHeight = this.cell.height) {
    this.cols = cols; this.rows = rows; this.cell = { width: cellWidth, height: cellHeight }
    this.post({ op: "resize", cols, rows, cw: cellWidth, ch: cellHeight })
  }
  /** DEC modes 1, application cursor keys, and 2004, bracketed paste. */
  mode(n: 1 | 2004) { return n === 1 ? this.modes.app : this.modes.paste }
  capture(format: CaptureFormat, lines: number | null) { return this.ask<Capture>({ op: "capture", format, lines }) }
  snapshot() { return this.ask<string>({ op: "snapshot" }) }
  text(lines: number) { return this.ask<string>({ op: "text", lines }) }

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
      this.o.onBlank?.()
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
