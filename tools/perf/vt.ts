// The terminal server's screens, xterm.js' headless terminal (termd's before) against libghostty-vt (vt/vt.ts), on
// the same made-up output (vtcorpus.ts), in this process: node --expose-gc tools/perf/vt.ts [--quick] [--out file.json]
import fs from "node:fs"
import { createRequire } from "node:module"
import { newVt } from "../../plugins/core/terminal/vt/load.ts"
import { CORPORA, fill, spinner } from "./vtcorpus.ts"

const require = createRequire(import.meta.url)
const { Terminal } = require("@xterm/headless") as typeof import("@xterm/headless")
const { SerializeAddon } = require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize")

const args = process.argv.slice(2), QUICK = args.includes("--quick"), OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : ""
const RUNS = QUICK ? 3 : 9, COLS = 120, ROWS = 40
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {})
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
/** Output in the pieces a pty gives (16 KB reads). */
const pieces = (s: string, n = 16384) => { const o: string[] = []; for (let i = 0; i < s.length; i += n) o.push(s.slice(i, i + n)); return o }

type Engine = {
  name: string
  make(cols: number, rows: number, scrollback: number): Screen
}
type Screen = { write(d: string): Promise<void> | void; resize(c: number, r: number): void; text(lines: number | null): string; serialize(): string; input(): unknown; dispose(): void; memory?(): number }

const xterm: Engine = {
  name: "xterm",
  make(cols, rows, scrollback) {
    const t = new Terminal({ cols, rows, scrollback, allowProposedApi: true }), ser = new SerializeAddon()
    t.loadAddon(ser as never)
    return {
      write: (d) => new Promise<void>((ok) => t.write(d, ok)),
      resize: (c, r) => t.resize(c, r),
      text: (lines) => {
        const b = t.buffer.active, out: string[] = []
        for (let y = lines === null ? 0 : Math.max(0, b.length - Math.max(lines, t.rows) * 2); y < b.length; y++) {
          const l = b.getLine(y)
          if (!l) continue
          const s = l.translateToString(true)
          if (l.isWrapped && out.length) out[out.length - 1] += s; else out.push(s)
        }
        while (out.length && !out[out.length - 1].trim()) out.pop()
        return (lines === null ? out : out.slice(-lines)).join("\n")
      },
      serialize: () => ser.serialize({ scrollback }),
      input: () => { const b = t.buffer.active, l = b.getLine(b.baseY + b.cursorY), c = b.getNullCell(); let s = ""; for (let x = 0; l && x < l.length; x++) { l.getCell(x, c); s += c.getChars() || " "; void c.isDim(); void c.getFgColor() } return s },
      dispose: () => t.dispose(),
    }
  },
}
const ghostty: Engine = {
  name: "ghostty",
  make(cols, rows, scrollback) {
    const v = newVt({ cols, rows, scrollback })
    return { write: (d) => v.write(d), resize: (c, r) => v.resize(c, r), text: (l) => v.text(l), serialize: () => v.serialize(), input: () => v.inputLine(), dispose: () => v.dispose(), memory: () => v.memory }
  },
}
const ENGINES = [xterm, ghostty]

async function feed(s: Screen, data: string[]) { for (const d of data) { const p = s.write(d); if (p) await p } }
async function time<T>(fn: () => Promise<T> | T) { const t0 = performance.now(); await fn(); return performance.now() - t0 }

const results: Record<string, Record<string, number>> = {}
const put = (metric: string, engine: string, v: number) => { (results[metric] ??= {})[engine] = Math.round(v * 100) / 100 }

// Throughput: each corpus into a new screen, in pty-sized pieces.
for (const [name, make] of Object.entries(CORPORA)) {
  const data = make(), bytes = Buffer.byteLength(data), parts = pieces(data)
  for (const e of ENGINES) {
    const ms: number[] = []
    for (let i = 0; i < RUNS + 1; i++) {
      const s = e.make(COLS, ROWS, 10000)
      const t = await time(() => feed(s, parts))
      if (i) ms.push(t) // (the first warms up)
      s.dispose()
    }
    put(`${name} MB/s`, e.name, bytes / 1e6 / (median(ms) / 1000))
  }
}

// A 10k-line history: reflow, snapshot, captures, the cursor's line.
const history = pieces(fill(10000))
for (const e of ENGINES) {
  const s = e.make(COLS, ROWS, 10000)
  await feed(s, history)
  const resizes: number[] = []
  for (let i = 0; i < RUNS; i++) resizes.push(await time(() => s.resize(80, ROWS)), await time(() => s.resize(COLS, ROWS)))
  put("reflow 10k ms", e.name, median(resizes))
  let snap = ""
  put("snapshot 10k ms", e.name, median(await Promise.all(Array.from({ length: RUNS }, async () => time(() => { snap = s.serialize() })))))
  put("snapshot 10k KB", e.name, Buffer.byteLength(snap) / 1024)
  put("capture all ms", e.name, median(await Promise.all(Array.from({ length: RUNS }, () => time(() => s.text(null))))))
  // (small ones a hundred at a time, warmed)
  const each = async (fn: () => unknown) => { for (let i = 0; i < 100; i++) fn(); const ms: number[] = []; for (let r = 0; r < RUNS; r++) ms.push(await time(() => { for (let i = 0; i < 100; i++) fn() }) / 100); return median(ms) }
  put("capture 40 ms", e.name, await each(() => s.text(40)))
  put("input line µs", e.name, 1000 * await each(() => s.input()))
  // Replaying it: the snapshot into a new screen (what a page or an adopting server does).
  put("replay 10k ms", e.name, median(await Promise.all(Array.from({ length: RUNS }, async () => { const r = e.make(COLS, ROWS, 10000); const t = await time(() => feed(r, pieces(snap))); r.dispose(); return t }))))
  s.dispose()
}

// Memory: a screen with 0, 10k and 100k lines written (history kept up to 10k), heap and WebAssembly memory.
for (const lines of [0, 10000, 100000]) {
  const data = lines ? pieces(fill(lines)) : []
  for (const e of ENGINES) {
    gc(); const before = process.memoryUsage()
    const ss: Screen[] = []
    for (let i = 0; i < 4; i++) { const s = e.make(COLS, ROWS, 10000); await feed(s, data); ss.push(s) }
    gc(); const after = process.memoryUsage()
    // (a WebAssembly memory counts in arrayBuffers once its buffer is read: memory() reads it)
    const wasm = ss.reduce((n, s) => n + (s.memory?.() ?? 0), 0), held = after.heapUsed - before.heapUsed + Math.max(after.arrayBuffers - before.arrayBuffers, wasm)
    put(`memory ${lines / 1000}k MB/terminal`, e.name, held / ss.length / 1e6)
    for (const s of ss) s.dispose()
  }
}

// 50 idle agents (a spinner at 15 Hz) and 5 floods (64 KB a tick), for a few seconds: CPU per second of it.
const SECS = QUICK ? 2 : 5, TICK = 1000 / 15, FLOOD = fill(600).slice(0, 65536)
for (const e of ENGINES) {
  const idle = Array.from({ length: 50 }, () => e.make(COLS, ROWS, 10000)), floods = Array.from({ length: 5 }, () => e.make(COLS, ROWS, 10000))
  const frames = spinner(1000).split("\r").slice(1).map((f) => `\r${f}`)
  const cpu0 = process.cpuUsage(), t0 = performance.now()
  let tick = 0
  while (performance.now() - t0 < SECS * 1000) {
    const at = performance.now()
    await Promise.all([...idle.map((s) => s.write(frames[tick % frames.length])), ...floods.map((s) => s.write(FLOOD))])
    tick++
    await new Promise((r) => setTimeout(r, Math.max(0, TICK - (performance.now() - at))))
  }
  const cpu = process.cpuUsage(cpu0), wall = (performance.now() - t0) / 1000
  put("noisy-50 CPU ms/s", e.name, (cpu.user + cpu.system) / 1000 / wall)
  for (const s of [...idle, ...floods]) s.dispose()
}

console.log(`\n${"".padEnd(26)}${ENGINES.map((e) => e.name.padStart(10)).join("")}   ghostty/xterm`)
for (const [metric, by] of Object.entries(results)) {
  const ratio = by.xterm ? by.ghostty / by.xterm : NaN
  console.log(`${metric.padEnd(26)}${ENGINES.map((e) => String(by[e.name] ?? "-").padStart(10)).join("")}   ${Number.isFinite(ratio) ? ratio.toFixed(2) : "-"}`)
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
