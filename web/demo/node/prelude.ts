// What Node gives every module, set before the server's modules load (web/demo/worker.ts imports this first).
import { Buffer } from "buffer"

const g = globalThis as Record<string, unknown>
g.Buffer = Buffer
g.global = globalThis
g.process = {
  env: { HOME: "/home", VAULTITE_VAULT: "/Sandbox", VAULTITE_LOCAL: "/local", VAULTITE_DEMO: "1" },
  platform: "browser", arch: "wasm", pid: 1, version: "v24.0.0", versions: { node: "24.0.0" }, execPath: "/node", argv: [], exitCode: 0,
  cwd: () => "/", uptime: () => performance.now() / 1000, memoryUsage: () => ({ rss: 0, heapUsed: 0, heapTotal: 0, external: 0 }),
  hrtime: Object.assign(() => [0, 0], { bigint: () => BigInt(Math.round(performance.now() * 1e6)) }),
  nextTick: (fn: (...a: unknown[]) => void, ...a: unknown[]) => queueMicrotask(() => fn(...a)),
  on() {}, once() {}, off() {}, emit() {}, exit() {}, kill() {}, getuid: () => 501,
  stdout: { write: (s: string) => console.log(s.trimEnd()), isTTY: false, on() {} },
  stderr: { write: (s: string) => console.warn(s.trimEnd()), isTTY: false, on() {} },
  stdin: { isTTY: false, on() {} },
}

// Node's timers are objects (`.unref()`); a number underneath, so clearTimeout takes them either way.
class Timer {
  private id: number
  constructor(id: number) { this.id = id }
  unref() { return this }
  ref() { return this }
  hasRef() { return true }
  [Symbol.toPrimitive]() { return this.id }
}
const { setTimeout: later, setInterval: every } = globalThis
g.setTimeout = (fn: () => void, ms?: number, ...a: unknown[]) => new Timer(later(fn, ms, ...a))
g.setInterval = (fn: () => void, ms?: number, ...a: unknown[]) => new Timer(every(fn, ms, ...a))
g.setImmediate = (fn: () => void, ...a: unknown[]) => new Timer(later(fn, 0, ...a))
g.clearImmediate = globalThis.clearTimeout
