// Where shells live so they can outlive the server: the keeper (ptyd.ts, default), tmux, the server's own child (only
// when the keeper can't start), or another plugin's. The types here are the contract a plugin's backend implements.
import fs from "node:fs"
import { quote } from "../../../core/codingagents.ts"
import { outliving, runtimeDir } from "../../../core/plugins.ts"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import type { IPty } from "node-pty"

/** An agent's command and the folder it runs in (from the plugin that brings it: AgentStart in core/codingagents.ts). */
export type AgentRun = { command: string; cwd?: string | null }

/** A new shell: the login shell, in `cwd`, running `run` first when it's an agent's. `env` is the server's environment
 *  less what's about the server; `ctx` Vaultite's variables (VAULTITE_URL..., and PATH with the app's bin/ first). */
export type Spec = { shell: string; run: AgentRun | null; cwd: string; env: Record<string, string>; ctx: Record<string, string>; cols: number; rows: number }

/** How a shell ended: its exit status, or null when only this server's hold on it ended (it still runs: reattach). */
export type Exit = { code: number; signal: number } | null

/** One server's hold on a running shell: what it prints, and typing and resizing it. */
export interface Link {
  readonly cols: number
  readonly rows: number
  write(data: Buffer): void
  resize(cols: number, rows: number): void
  onData(fn: (data: string) => void): void
  onExit(fn: (exit: Exit) => void): void
  /** A picture of the screen and history for a new viewer, given in order with onData. Without one, plugin.ts replays
   *  what it kept of the output, then redraw(). */
  snapshot?(fn: (picture: string) => void): void
  /** Draw the screen again (after a replay that may end mid-screen). */
  redraw?(): void
  /** Scroll its history (a backend that `redraws`): lines up, negative down. */
  scroll?(lines: number): void
  /** Let go of it: the shell keeps running. */
  close(): void
}

/** A running shell as a backend lists it. `process`: the program in front; `attached`: holds on it, this server's
 *  included; `activity`: last input or output (ms); `external`: not started by Vaultite (a herdr pane of the user's). */
export type Listed = { id: string; pid?: number; process: string; created: number; activity?: number; attached: number; title?: string
  state?: string; external?: boolean; spare?: boolean }

export interface Backend {
  readonly name: string
  readonly label: string
  /** It redraws the screen for the page (tmux): the page scrolls by asking, and its own scrollback stays empty. */
  readonly redraws: boolean
  /** Its shells are also the user's own elsewhere (herdr): never ended for being idle or by Vaultite's sweeps. */
  readonly external?: boolean
  /** Shells kept ready (plugin.ts: spares) are made in it: create(..., {spare}), then rename(). */
  readonly spares?: boolean
  /** New terminals start in it (a plugin's backend, as its settings say: herdr's "Start new terminals in herdr"). */
  readonly preferred?: boolean
  /** Whether it can run here now (installed, its server answering). */
  ready(): Promise<boolean>
  has(id: string): Promise<boolean>
  list(): Promise<Listed[]>
  create(id: string, spec: Spec, o?: { spare?: boolean }): Promise<void>
  attach(id: string, cols: number, rows: number): Promise<Link>
  kill(id: string): Promise<void>
  /** The screen and `lines` above it, as text. */
  screen(id: string, lines: number): Promise<string>
  /** Type `text` into it (as typed, not as keys), then Enter apart from it (a program reading a paste takes an Enter
   *  inside it as a newline). */
  send(id: string, text: string, enter: boolean): Promise<void>
  rename?(from: string, to: string): Promise<void>
  /** Forget its history (what scrolling up shows): tmux's, once a ready shell's typed line has given way to an agent.
   *  (The keeper's goes with the script's `clear`, which clears the scrollback too.) */
  clearHistory?(id: string): Promise<void>
}

/** How long typed text needs before its Enter: an agent takes a long text as a paste, and an Enter inside that is a new line. */
const settle = (text: string) => Math.min(1000, 150 + Math.floor(text.length / 4))

/** The login shell's arguments: interactive (so it has the user's PATH) running the agent's command first, then a
 *  plain login shell in its place. */
export function shellArgs(shell: string, run: AgentRun | null) {
  return run ? ["-l", "-i", "-c", `${run.command}; exec '${shell.replaceAll("'", "")}' -l`] : ["-l"]
}
/** The script a ready shell sources to become an agent's (typed into it as one short line). */
export function runScript(file: string, id: string, run: AgentRun) {
  fs.writeFileSync(file, `rm -f ${quote(file)}\nclear\nexport VAULTITE_TERMINAL=${quote(id)}\n${run.cwd ? `cd ${quote(run.cwd)} && ` : ""}${run.command}\n`, { mode: 0o600 })
  return ` source ${quote(file)}`
}

// ---------- node-pty, loaded on first use (if the native module can't load here, only the terminal breaks)

let ptyLib: typeof import("node-pty") | null = null
export async function loadPty() {
  // Its prebuilt spawn-helper can arrive without the exec bit (npm skips its install scripts): posix_spawnp fails.
  // Checked before every shell, not once: an npm install while the server runs puts a new one there.
  const { createRequire } = await import("node:module")
  const dir = path.dirname(createRequire(import.meta.url).resolve("node-pty/package.json"))
  for (const sub of [`prebuilds/${process.platform}-${process.arch}`, "build/Release"]) {
    const helper = path.join(dir, sub, "spawn-helper")
    try { if (!(fs.statSync(helper).mode & 0o111)) fs.chmodSync(helper, 0o755) } catch { /* not there */ }
  }
  ptyLib ??= (await import("node-pty")).default as unknown as typeof import("node-pty")
  return ptyLib
}

// eslint-disable-next-line no-control-regex
export const plain = (s: string) => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]/g, "").replace(/\r(?!\n)/g, "")

/** A Link around a pseudo-terminal this process holds (the plain backend's, tmux's client). */
export function ptyLink(p: IPty, extra: Partial<Pick<Link, "redraw" | "scroll" | "write">> & { exit?: (code: number, signal: number) => Promise<Exit> } = {}): Link {
  const link: Link = {
    get cols() { return p.cols },
    get rows() { return p.rows },
    write: extra.write ?? ((b) => { try { p.write(b as unknown as string) } catch { /* ended */ } }),
    resize: (c, r) => { try { p.resize(c, r) } catch { /* ended */ } },
    onData: (fn) => { p.onData(fn) },
    onExit: (fn) => { p.onExit(async ({ exitCode, signal }) => fn(extra.exit ? await extra.exit(exitCode, signal ?? 0) : { code: exitCode, signal: signal ?? 0 })) },
    redraw: extra.redraw,
    scroll: extra.scroll,
    close: () => { try { p.kill("SIGHUP") } catch { /* ended */ } },
  }
  return link
}

/** A Link that gives pictures of one that can't, by reading its output through a headless xterm.js first, so a viewer
 *  who joins gets the screen as it is (for backends whose client only sends what changed). */
export async function mirrored(link: Link, scrollback = 1000): Promise<Link> {
  const { createRequire } = await import("node:module")
  const require = createRequire(import.meta.url)
  const { Terminal } = require("@xterm/headless") as typeof import("@xterm/headless")
  const { SerializeAddon } = require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize")
  const term = new Terminal({ cols: link.cols, rows: link.rows, scrollback, allowProposedApi: true })
  const ser = new SerializeAddon()
  term.loadAddon(ser as never)
  const data = new Set<(d: string) => void>()
  // Passed on once read, so a picture and the data around it never overlap.
  link.onData((d) => term.write(d, () => { for (const fn of data) fn(d) }))
  link.onExit(() => term.write("", () => term.dispose()))
  return {
    get cols() { return link.cols },
    get rows() { return link.rows },
    write: (b) => link.write(b),
    resize: (c, r) => { link.resize(c, r); try { term.resize(c, r) } catch { /* disposed */ } },
    onData: (fn) => { data.add(fn) },
    onExit: (fn) => link.onExit(fn),
    snapshot: (fn) => term.write("", () => fn(ser.serialize({ scrollback }))),
    scroll: link.scroll,
    close: () => link.close(),
  }
}

// ---------- pty: the server's own children (they end with it)

export function plainBackend(): Backend {
  const RING = 200 * 1024
  const shells = new Map<string, { p: IPty; created: number; activity: number; out: string[]; size: number; attached: number }>()
  const get = (id: string) => {
    const s = shells.get(id)
    if (!s) throw new Error(`there's no shell '${id}'`)
    return s
  }
  return {
    name: "pty", label: "This server", redraws: false,
    ready: async () => true,
    has: async (id) => shells.has(id),
    list: async () => [...shells].map(([id, s]) => {
      let process = ""
      try { process = path.basename(s.p.process) } catch { /* ended */ } // (Linux: /bin/bash)
      return { id, pid: s.p.pid, process, created: s.created, activity: s.activity, attached: s.attached }
    }),
    async create(id, spec) {
      const lib = await loadPty()
      const p = lib.spawn(spec.shell, shellArgs(spec.shell, spec.run), { name: "xterm-256color", cols: spec.cols, rows: spec.rows, cwd: spec.run?.cwd || spec.cwd,
        env: { ...spec.env, ...spec.ctx } })
      const s = { p, created: Date.now(), activity: Date.now(), out: [] as string[], size: 0, attached: 0 }
      p.onData((d) => {
        s.activity = Date.now()
        s.out.push(d); s.size += d.length
        while (s.size > RING && s.out.length > 1) s.size -= s.out.shift()!.length
      })
      p.onExit(() => { if (shells.get(id) === s) shells.delete(id) })
      shells.set(id, s)
    },
    async attach(id) {
      const s = get(id)
      s.attached++
      const link = ptyLink(s.p)
      // Letting go of it here is ending it: it's this process's child.
      let closed = false
      link.close = () => { if (!closed) { closed = true; s.attached-- } }
      link.onExit(() => { if (!closed) { closed = true; s.attached-- } })
      return link
    },
    kill: async (id) => { try { get(id).p.kill("SIGHUP") } catch { /* ended */ } },
    screen: async (id, lines) => plain(get(id).out.join("")).replace(/\s+$/, "").split("\n").slice(-lines).join("\n"),
    async send(id, text, enter) {
      const s = get(id)
      if (text) s.p.write(text)
      if (enter) { if (text) await new Promise((r) => setTimeout(r, settle(text))); s.p.write("\r") }
    },
  }
}

// ---------- vaultite: the keeper (ptyd.ts)

/** One connection to the keeper: requests with answers, and the messages of a shell it shows. */
class Wire {
  sock: net.Socket
  seq = 0
  waiting = new Map<number, { ok: (v: Record<string, unknown>) => void; fail: (e: Error) => void }>()
  listeners = new Set<(m: Record<string, unknown>) => void>()
  closed = false
  onClose: (() => void) | null = null
  constructor(sock: net.Socket) {
    this.sock = sock
    let buf = ""
    sock.setEncoding("utf8")
    sock.on("data", (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let m: Record<string, unknown>
        try { m = JSON.parse(line) } catch { continue }
        if (typeof m.re === "number" && this.waiting.has(m.re)) {
          const w = this.waiting.get(m.re)!
          this.waiting.delete(m.re)
          if (typeof m.error === "string") w.fail(new Error(m.error)); else w.ok(m)
        } else for (const fn of this.listeners) fn(m)
      }
    })
    const end = () => {
      if (this.closed) return
      this.closed = true
      for (const w of this.waiting.values()) w.fail(new Error("the terminal's keeper went away"))
      this.waiting.clear()
      this.onClose?.()
    }
    sock.on("close", end)
    sock.on("error", end)
  }
  send(op: string, params: Record<string, unknown> = {}) {
    if (!this.closed) this.sock.write(JSON.stringify({ op, ...params }) + "\n")
  }
  /** A request whose answer `fn` gets as it arrives, between the messages around it (a promise's would come after the
   *  next ones in the same chunk). */
  call(op: string, params: Record<string, unknown>, fn: (m: Record<string, unknown>) => void) {
    if (this.closed) return
    const re = ++this.seq
    this.waiting.set(re, { ok: fn, fail: () => {} })
    this.sock.write(JSON.stringify({ op, re, ...params }) + "\n")
  }
  request(op: string, params: Record<string, unknown> = {}, ms = 5000): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error("the terminal's keeper went away"))
    const re = ++this.seq
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => { this.waiting.delete(re); fail(new Error(`the terminal's keeper didn't answer ${op}`)) }, ms)
      this.waiting.set(re, { ok: (v) => { clearTimeout(timer); ok(v) }, fail: (e) => { clearTimeout(timer); fail(e) } })
      this.sock.write(JSON.stringify({ op, re, ...params }) + "\n")
    })
  }
  close() { this.sock.destroy() }
}

const connectTo = (socket: string) => new Promise<Wire>((ok, fail) => {
  const sock = net.connect(socket)
  sock.once("connect", () => { sock.removeAllListeners("error"); ok(new Wire(sock)) })
  sock.once("error", fail)
})

/** The keeper's protocol version, in its socket's name: a server that speaks another starts its own (the shells in an
 *  older one then stay where they are until it has none: plugin.ts reads only the current one). */
const PROTOCOL = 1

/** The keeper at `name` (the tmux socket's naming: vaultite, or vaultite-<port> for a server on another port). */
export function ptydBackend(name: string, o: { daemon: string; log?: (...a: unknown[]) => void }): Backend & { socket: string } {
  const socket = path.join(runtimeDir(), `vaultite-ptyd${PROTOCOL}-${name}.sock`)
  let ctl: Promise<Wire> | null = null

  /** Starts the keeper: detached (its own session and process group) and, under systemd, in a scope of its own, so
   *  nothing that ends the server ends it. The desktop app's server runs on Electron as Node (ELECTRON_RUN_AS_NODE). */
  function startKeeper(plain = false) {
    let out: number | "ignore" = "ignore"
    try { out = fs.openSync(`${socket}.log`, "a") } catch { /* no log */ }
    const [cmd, args] = plain ? [process.execPath, [o.daemon, socket]] : outliving(process.execPath, [o.daemon, socket], `ptyd-${name}`)
    const child = spawn(cmd, args, { detached: true, stdio: ["ignore", out, out], cwd: os.homedir(), env: process.env })
    // systemd-run that couldn't make the scope (no user bus) fails at once: start it as before.
    if (cmd !== process.execPath) child.once("exit", (code) => { if (code) startKeeper(true) })
    child.unref()
    if (typeof out === "number") fs.closeSync(out)
  }

  /** A connection, starting the keeper when none answers. */
  async function open(): Promise<Wire> {
    try { return await connectTo(socket) } catch { /* not running */ }
    startKeeper()
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 50))
      try { return await connectTo(socket) } catch { /* not yet */ }
    }
    throw new Error(`the terminal's keeper didn't start (see ${socket}.log)`)
  }

  function control(): Promise<Wire> {
    if (!ctl) {
      // (a connection that closes clears only itself: a retired keeper's can close after the next one's is made)
      const p: Promise<Wire> = open().then((w) => { w.onClose = () => { if (ctl === p) ctl = null }; return w })
      ctl = p
      p.catch(() => { if (ctl === p) ctl = null })
    }
    return ctl
  }
  /** Only when it's already running: listing shells shouldn't start it. */
  async function running(): Promise<Wire | null> {
    if (ctl) return ctl.catch(() => null)
    try { await new Promise<void>((ok, fail) => fs.stat(socket, (e) => (e ? fail(e) : ok()))) } catch { return null }
    return control().catch(() => null)
  }
  const ask = async (op: string, params: Record<string, unknown> = {}) => (await control()).request(op, params)

  return {
    name: "vaultite", label: "Vaultite", redraws: false, spares: true, socket,
    ready: async () => !!(await control().catch(() => null)),
    async has(id) { return (await this.list()).some((s) => s.id === id) },
    async list() {
      const w = await running()
      if (!w) return []
      try { return ((await w.request("list")).sessions as Listed[]) ?? [] } catch { return [] }
    },
    async create(id, spec, c) {
      const params = { id, file: spec.shell, args: shellArgs(spec.shell, spec.run), cwd: spec.run?.cwd || spec.cwd,
        env: { ...spec.env, ...spec.ctx }, cols: spec.cols, rows: spec.rows, spare: !!c?.spare }
      try { await ask("create", params) } catch (e) {
        // A keeper whose files are gone (its checkout moved: ptyd.ts, stale) can't start shells, and makes way when it
        // holds none: once it's gone, the next one starts from this server's files.
        if (!/^RETIRING\b/.test((e as Error).message)) throw e
        o.log?.("terminal: the keeper's files were gone, so it retired: starting a new one")
        for (let i = 0; i < 40 && fs.existsSync(socket); i++) await new Promise((r) => setTimeout(r, 50))
        ctl = null
        await ask("create", params)
      }
    },
    async attach(id, cols, rows) {
      await control()
      const w = await open()
      let size = { cols, rows }
      const data = new Set<(d: string) => void>(), exits = new Set<(e: Exit) => void>()
      let exit: Exit | undefined
      w.listeners.add((m) => {
        if (m.t === "data" && typeof m.d === "string") for (const fn of data) fn(m.d)
        else if (m.t === "size") size = { cols: Number(m.cols), rows: Number(m.rows) }
        else if (m.t === "exit") { exit = { code: Number(m.code) || 0, signal: Number(m.signal) || 0 }; w.close() }
      })
      // Ended, or the keeper went away (its shells with it: there's nothing to reattach to then either).
      w.onClose = () => { for (const fn of exits) fn(exit ?? null) }
      try {
        const a = await w.request("attach", { id })
        size = { cols: Number(a.cols) || cols, rows: Number(a.rows) || rows }
      } catch (e) { w.close(); throw e }
      if (size.cols !== cols || size.rows !== rows) { w.send("resize", { cols, rows }); size = { cols, rows } }
      return {
        get cols() { return size.cols },
        get rows() { return size.rows },
        write: (b) => w.send("input", { b64: b.toString("base64") }),
        resize: (c, r) => { if (c !== size.cols || r !== size.rows) { size = { cols: c, rows: r }; w.send("resize", { cols: c, rows: r }) } },
        onData: (fn) => { data.add(fn) },
        onExit: (fn) => { exits.add(fn) },
        snapshot: (fn) => w.call("snapshot", {}, (m) => fn(String(m.data ?? ""))),
        close: () => { exits.clear(); w.close() },
      }
    },
    kill: async (id) => { await ask("kill", { id }) },
    rename: async (from, to) => { await ask("rename", { id: from, to }) },
    screen: async (id, lines) => String((await ask("screen", { id, lines })).text ?? ""),
    async send(id, text, enter) {
      if (text) await ask("input", { id, b64: Buffer.from(text).toString("base64") }).catch(() => {})
      if (enter) {
        if (text) await new Promise((r) => setTimeout(r, settle(text)))
        await ask("input", { id, b64: Buffer.from("\r").toString("base64") }).catch(() => {})
      }
    },
  }
}
