import net from "node:net"
import type { BackendEvent, CaptureFormat, Exit, Input, Link, Listed, Made, Spec, Backend } from "./backend.ts"
import { launch, shellName } from "./launch.ts"
import { lineReader } from "./lines.ts"
import { Failure, type Answer, type Info, type Op, type Params, type Unasked } from "./termd/protocol.ts"
import { logger } from "../../../core/plugins.ts"

const log = logger("terminal")

export type Msg = Record<string, unknown>
type Pipe = { write(m: Msg): void; onMessage(fn: (m: Msg) => void): void; onClose(fn: () => void): void; close(): void; pause(): void; resume(): void }

// libuv runs expired timers before its next I/O poll: a loop held up past `ms` would miss an answer already there.
function afterIO(fn: () => void, ms: number) {
  let im: ReturnType<typeof setImmediate> | null = null
  const t = setTimeout(() => { im = setImmediate(fn) }, ms)
  return () => { clearTimeout(t); if (im) clearImmediate(im) }
}

export class Wire {
  pipe: Pipe
  seq = 0
  waiting = new Map<number, { ok: (v: Msg) => void; fail: (e: Error) => void }>()
  listeners = new Set<(m: Unasked) => void>()
  closed = false
  onClose: (() => void) | null = null
  stalledSince: number | null = null
  onStall: ((op: string, waited: number) => void) | null = null
  probeMs = 10_000
  probing = false
  heardAt = 0
  onAnswer: ((ms: number) => void) | null = null
  stalled: () => string = () => "the terminal server isn't answering"
  constructor(pipe: Pipe) {
    this.pipe = pipe
    pipe.onMessage((m) => {
      this.heardAt = Date.now()
      if (this.stalledSince !== null) { const ms = Date.now() - this.stalledSince; this.stalledSince = null; this.onAnswer?.(ms) }
      try {
        if (typeof m.re === "number" && this.waiting.has(m.re)) {
          const w = this.waiting.get(m.re)!
          this.waiting.delete(m.re)
          if (typeof m.error === "string") w.fail(new Failure(m.error, m.code === "retiring" ? m.code : undefined)); else w.ok(m)
        } else if (typeof m.t === "string") for (const fn of this.listeners) fn(m as Unasked)
      } catch (e) { log.error("a message from the terminal server", e) }
    })
    pipe.onClose(() => {
      if (this.closed) return
      this.closed = true
      for (const w of this.waiting.values()) w.fail(new Error("the terminal server went away"))
      this.waiting.clear()
      this.onClose?.()
    })
  }
  send<O extends Op>(op: O, params: Params<O>) {
    if (!this.closed) this.pipe.write({ op, ...params })
  }
  /** A promise's answer would come after the next messages in the same chunk: `fn` gets it between them. */
  call<O extends Op>(op: O, params: Params<O>, fn: (m: Answer<O>) => void) {
    if (this.closed) return
    const re = ++this.seq
    this.waiting.set(re, { ok: (m) => fn(m as Answer<O>), fail: () => {} })
    this.pipe.write({ op, re, ...params })
  }
  request<O extends Op>(op: O, params: Params<O>, ms = 5000): Promise<Answer<O>> {
    if (this.closed) return Promise.reject(new Error("the terminal server went away"))
    if (this.stalledSince !== null && op !== "hello") return Promise.reject(new Error(this.stalled()))
    const re = ++this.seq
    return new Promise((ok, fail) => {
      const cancel = afterIO(() => {
        if (!this.waiting.delete(re)) return
        if (op !== "hello") this.probe(op, ms)
        fail(new Error(this.stalledSince !== null ? this.stalled() : `the terminal server didn't answer ${op} in ${Math.round(ms / 1000)} s`))
      }, ms)
      this.waiting.set(re, { ok: (v) => { cancel(); ok(v as Answer<O>) }, fail: (e) => { cancel(); fail(e) } })
      this.pipe.write({ op, re, ...params })
    })
  }
  probe(op: string, waited: number) {
    if (!this.onStall || this.probing || this.stalledSince !== null || this.closed) return
    this.probing = true
    const at = Date.now()
    this.request("hello", {}, this.probeMs).then(() => {}, () => {
      if (this.stalledSince !== null || this.closed || this.heardAt >= at) return
      this.stalledSince = at
      this.onStall?.(op, waited)
    }).finally(() => { this.probing = false })
  }
  close() { this.pipe.close() }
}

export const connectTo = (socket: string) => new Promise<Wire>((ok, fail) => {
  const sock = net.connect(socket)
  sock.once("connect", () => {
    sock.removeAllListeners("error")
    sock.setEncoding("utf8")
    const closers: (() => void)[] = []
    const closed = () => { for (const fn of closers.splice(0)) fn() }
    sock.on("close", closed)
    sock.on("error", closed)
    ok(new Wire({
      write: (m) => { if (!sock.destroyed) sock.write(JSON.stringify(m) + "\n") },
      onMessage: (fn) => { sock.on("data", lineReader((line) => { let m: Msg; try { m = JSON.parse(line) } catch { return } fn(m) })) },
      onClose: (fn) => { closers.push(fn) },
      close: () => sock.destroy(),
      pause: () => sock.pause(),
      resume: () => sock.resume(),
    }))
  })
  sock.once("error", fail)
})

function listed(x: Info): Listed {
  return { id: x.id, pid: x.pid || undefined, process: x.process, created: x.created, activity: x.activity, attached: x.clients, title: x.title, cwd: x.cwd || undefined,
    command: x.command || undefined, cols: x.cols, rows: x.rows, meta: x.meta, said: x.said, ...(x.exit ? { exit: x.exit } : {}), ...(x.spare ? { spare: true } : {}),
    ...(x.via ? { via: x.via } : {}) }
}

export function termdClient(o: { name: string; label: string; control: () => Promise<Wire>; running: () => Promise<Wire | null>; open: () => Promise<Wire> }) {
  const heard = new Set<(ev: BackendEvent) => void>()
  const ask = async <O extends Op>(op: O, params: Params<O>, ms?: number) => (await o.control()).request(op, params, ms)
  const hellos = new WeakMap<Wire, Promise<boolean>>()
  const backend = {
    name: o.name, label: o.label, spares: true,
    ready: async () => !!(await o.control().catch(() => null)),
    async pictures() {
      const w = await o.control().catch(() => null)
      if (!w) return false
      if (!hellos.has(w)) hellos.set(w, w.request("hello", {}, 5000).then((r) => r.pictures === true, () => { hellos.delete(w); return false }))
      return hellos.get(w)!
    },
    async list(q?: { ended?: boolean }): Promise<Listed[]> {
      const w = await o.running()
      if (!w) return []
      try {
        const r = await w.request("list", q?.ended ? { ended: true } : {})
        return [...r.sessions, ...(r.ended ?? [])].map(listed)
      } catch { return [] }
    },
    async create(id: string, spec: Spec, c?: Made) {
      const l = launch(spec)
      await ask("create", { id, file: l.file, args: l.args, cwd: l.cwd, env: l.env, shell: shellName(spec.shell), cols: spec.cols, rows: spec.rows,
        scrollback: spec.scrollback, spare: !!c?.spare, ...(c?.command ? { command: c.command } : {}), ...(c?.meta ? { meta: c.meta } : {}) })
    },
    async attach(id: string, cols: number, rows: number): Promise<Link> {
      await o.control()
      const w = await o.open()
      let size: { cols: number; rows: number; cw?: number; ch?: number } = { cols, rows }
      const data = new Set<(d: string) => void>(), exits = new Set<(e: Exit) => void>()
      let exit: Exit | undefined
      w.listeners.add((m) => {
        if (m.t === "data") for (const fn of data) fn(m.d)
        else if (m.t === "size") size = { ...size, cols: m.cols, rows: m.rows }
        else if (m.t === "exit") { exit = { code: m.code || 0, signal: m.signal || 0, ...(m.lost ? { lost: true } : {}) }; w.close() }
      })
      w.onClose = () => { for (const fn of exits) fn(exit ?? null) }
      try {
        const a = await w.request("attach", { id })
        size = { cols: a.cols || cols, rows: a.rows || rows }
      } catch (e) { w.close(); throw e }
      if (size.cols !== cols || size.rows !== rows) { w.send("resize", { cols, rows }); size = { ...size, cols, rows } }
      return {
        get cols() { return size.cols },
        get rows() { return size.rows },
        write: (b) => w.send("input", { b64: b.toString("base64") }),
        resize: (c, r, cell) => {
          const cw = cell?.width ?? size.cw, ch = cell?.height ?? size.ch
          if (c === size.cols && r === size.rows && cw === size.cw && ch === size.ch) return
          size = { cols: c, rows: r, cw, ch }
          w.send("resize", { cols: c, rows: r, ...(cw ? { cw, ch } : {}) })
        },
        onData: (fn) => { data.add(fn) },
        onExit: (fn) => { exits.add(fn) },
        snapshot: (fn) => w.call("snapshot", {}, (m) => fn(m.data ?? "")),
        pause: () => w.pipe.pause(),
        resume: () => w.pipe.resume(),
        close: () => { exits.clear(); w.close() },
      }
    },
    kill: async (id: string, signal?: string) => { await ask("kill", { id, ...(signal ? { signal } : {}) }) },
    rename: async (from: string, to: string, c?: Made) => { await ask("rename", { id: from, to, ...(c?.command ? { command: c.command } : {}), ...(c?.meta ? { meta: c.meta } : {}) }) },
    setMeta: async (id: string, patch: Record<string, string | null>) => { await ask("set", { id, meta: patch }) },
    async capture(id: string, c: { format: CaptureFormat; lines?: number | null }) {
      const r = await ask("capture", { id, format: c.format, ...(c.lines === undefined ? {} : { lines: c.lines ?? "all" }) }, 15000)
      return { text: r.text ?? "", cols: r.cols, rows: r.rows, cursor: r.cursor, alternate: !!r.alternate,
        ...(r.input ? { input: r.input } : {}), ...(r.ended ? { ended: true } : {}) }
    },
    async send(id: string, input: Input) {
      if ("keys" in input) await ask("keys", { id, keys: input.keys })
      else if (input.text) await ask("input", { id, b64: Buffer.from(input.text).toString("base64"), ...(input.paste ? { paste: true } : {}) })
    },
    events: (fn: (ev: BackendEvent) => void) => { heard.add(fn); void o.running() },
    dropStatus: async (id: string) => { await (await o.running())?.request("status-drop", { id }).catch(() => {}) },
  } satisfies Backend
  const follow = (w: Wire) => {
    w.listeners.add((m) => {
      if (m.t !== "event") return
      const { t: _, ...e } = m
      const ev: BackendEvent = e.type === "started" ? { ...e, info: listed(e.info) } : e
      for (const fn of heard) fn(ev)
    })
    w.send("subscribe", {})
  }
  return { backend, follow, ask }
}

