// Where terminals live so they outlive the server: the terminal server (termd/), the server itself when that can't start,
// or another plugin's ("terminal:backend"). Its types are the contract a plugin's backend implements (with backendKit).
import crypto from "node:crypto"
import fs from "node:fs"
import { shellQuote } from "../../../core/agents.ts"
import { type Access, accessOf, outliving, runtimeDir, toWsl } from "../../../core/plugins.ts"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import type { IPty } from "node-pty"
import { lineReader } from "./lines.ts"
import type { Said } from "./osc7501.ts"
import { distroOf, kindOf, progName, type ShellKind } from "./shells.ts"
import { PROTOCOL, type Capture, type CaptureFormat, type Event, type Exit as Ended, type Info } from "./termd/protocol.ts"

export type { Capture, CaptureFormat, Ended }

/** An agent's command and the folder it runs in (from the plugin that brings it: AgentStart in core/agents.ts), as
 *  its shell's kind reads it (plugin.ts: starter.ts's line in PowerShell and cmd). */
export type AgentRun = { command: string; cwd?: string | null }

/** A new terminal: `shell` (a path, or wsl:<distro>: shells.ts) in `cwd`, running `run` first for an agent. `env`: the
 *  server's less what's about it; `ctx`: Vaultite's variables (VAULTITE_URL..., PATH with the app's bin/ first). */
export type Spec = { shell: string; run: AgentRun | null; cwd: string; env: Record<string, string>; ctx: Record<string, string>; cols: number; rows: number
  /** Lines of history it keeps. */
  scrollback: number
  /** `run` alone: a command whose end is the terminal's (its exit code too). */
  only?: boolean }

/** What a new terminal is, for its list: what it was started to run (`command`: "claude", "npm test", "zsh") and the
 *  app's meta to keep with it (`name`, `note`). `spare`: a shell kept ready, renamed when it's taken. */
export type Made = { spare?: boolean; command?: string; meta?: Record<string, string> }

/** The terminal's settings as backends need them (plugin.ts sets them): lines of history every terminal keeps. */
export const limits = { scrollback: () => 10_000 }

/** How a terminal ended, as its link tells it: its exit status (`lost`: unknown, the server holding it went away), or
 *  null when only this server's hold on it ended (it still runs: reattach). */
export type Exit = { code: number; signal: number; lost?: boolean } | null

/** One server's hold on a running terminal: what it prints, and typing and resizing it. */
export interface Link {
  readonly cols: number
  readonly rows: number
  write(data: Buffer): void
  resize(cols: number, rows: number): void
  onData(fn: (data: string) => void): void
  onExit(fn: (exit: Exit) => void): void
  /** A picture of the screen and history for a new viewer, given in order with onData (`mirrored` makes one for a
   *  backend that has none). */
  snapshot(fn: (picture: string) => void): void
  /** Stop reading its output until resume (its program waits once the pty is full): the pages are behind. */
  pause?(): void
  resume?(): void
  /** Let go of it: the terminal keeps running. */
  close(): void
}

/** A terminal as a backend lists it. `process`: the program in front now; `attached`: holds on it, this server's
 *  included; `activity`: last input or output (ms); `command`: what it was started to run (Made). */
export type Listed = { id: string; pid?: number; process: string; created: number; activity?: number; attached: number; title?: string
  cwd?: string; command?: string; cols?: number; rows?: number
  /** The app's, from a backend that keeps it (setMeta). */
  meta?: Record<string, string>
  /** Its own word on an agent there (herdr's: working, waiting, idle). */
  state?: string
  /** Its program's OSC 7501, from a backend that reads it. */
  said?: Said
  /** It ended, and how (only with list's `ended`). */
  exit?: Ended
  /** Not started by Vaultite (a herdr pane of the user's). */
  external?: boolean
  spare?: boolean }

/** What a backend tells as it happens (Backend.events): termd/protocol.ts' events, `info` as it lists it. */
export type BackendEvent = Exclude<Event, { type: "started" }> | { type: "started"; id: string; info?: Listed }

/** What goes into a terminal: text as typed (`paste`: as a bracketed paste, when its program asked for those), or keys
 *  by name (keys.ts: Enter, C-c, Up). */
export type Input = { text: string; paste?: boolean } | { keys: string[] }

export interface Backend {
  readonly name: string
  readonly label: string
  /** Its terminals are also the user's own elsewhere (herdr): never ended for being idle or by Vaultite's sweeps. */
  readonly external?: boolean
  /** Shells kept ready (plugin.ts: spares) are made in it: create(..., {spare}), then rename(). */
  readonly spares?: boolean
  /** New terminals start in it (a plugin's backend, as its settings say: herdr's "Start new terminals in herdr"). */
  readonly preferred?: boolean
  /** Whether it can run here now (installed, its server answering). */
  ready(): Promise<boolean>
  /** Its terminals; with `ended`, the ones that ended lately too (with their `exit`), for a backend that keeps them. */
  list(o?: { ended?: boolean }): Promise<Listed[]>
  create(id: string, spec: Spec, o?: Made): Promise<void>
  attach(id: string, cols: number, rows: number): Promise<Link>
  /** Ends it: a hangup, as closing a terminal does, or `signal`. */
  kill(id: string, signal?: string): Promise<void>
  /** What it shows: its last `lines` (none: its screen; null: all it keeps), as `format` says; one that ended lately too,
   *  from a backend that keeps it (`ended` in the answer). A format it can't give throws saying so. */
  capture(id: string, o: { format: CaptureFormat; lines?: number | null }): Promise<Capture & { ended?: boolean }>
  /** Types text into it or presses keys (Input). plugin.ts waits between a text and the Enter after it. */
  send(id: string, input: Input): Promise<void>
  /** A spare taken: its new id, and what it's made into (Made). */
  rename?(from: string, to: string, o?: Made): Promise<void>
  /** Keeps the app's meta with the terminal (its `name`, `note`): each key set, or removed by null. Without it the app
   *  keeps them itself, on this machine. */
  setMeta?(id: string, patch: Record<string, string | null>): Promise<void>
  /** `fn` hears what changes as it happens (BackendEvent), from the first call on. Without it the app asks list(). */
  events?(fn: (ev: BackendEvent) => void): void
  /** Its program ended (the app saw its shell at the prompt again): the working and blocked OSC 7501 records go. */
  dropStatus?(id: string): Promise<void>
}

/** A long or multi-line text goes as a paste: typed, an agent reads it in the pty's ~1 KB pieces, each a paste of its
 *  own (joined with a line break, or dropped while it's busy). A short one stays keys (a "1" answering a menu). */
export const asPaste = (text: string) => Buffer.byteLength(text) > 256 || text.includes("\n")
/** Text sent into a terminal, without paste markers: one would end its paste early, or show as `201~` where none was asked. */
export const unmarked = (text: string) => text.replace(/\x1b\[20[01]~/g, "")

// ---------- Vaultite's vau first on PATH: a login shell's files (macOS' path_helper, Homebrew's shellenv) put theirs
// before what the shell was given, so the shell puts VAULTITE_BIN (and QA's VAULTITE_AGENT_BIN) first again after them.

/** The shells' startup files (`shellFiles`): zsh's ZDOTDIR and bash's rcfile. */
export const SHELL_DIR = path.join(runtimeDir(), "vaultite-terminal", "shell")
/** Each of zsh's files runs the user's own (from their ZDOTDIR, which their .zshenv may move), with ZDOTDIR theirs
 *  meanwhile; the last one read (.zlogin, or .zshrc when not a login shell) gives ZDOTDIR back and puts vau first. */
const zshDone = [
  "if [[ -z $VAULTITE_USER_ZDOTDIR && $ZDOTDIR == $HOME ]]; then unset ZDOTDIR; fi",
  "for _vau_d in $VAULTITE_AGENT_BIN $VAULTITE_BIN; do path=($_vau_d ${path:#${(b)_vau_d}}); done",
  "unset _vau_ours _vau_zdot _vau_d",
]
const zshFile = (name: string, last: string[] = []) => [
  "# Vaultite's terminals start zsh here (ZDOTDIR): the user's own startup files, then Vaultite's vau first on PATH.",
  ...(name === ".zshenv" ? ["_vau_ours=$ZDOTDIR _vau_zdot=${VAULTITE_USER_ZDOTDIR:-$HOME}"] : []),
  "ZDOTDIR=$_vau_zdot",
  `if [[ -r $ZDOTDIR/${name} ]]; then source $ZDOTDIR/${name}; fi`,
  ...(name === ".zlogin" ? zshDone : ["_vau_zdot=$ZDOTDIR ZDOTDIR=$_vau_ours", ...last]),
  "",
].join("\n")
const SHELL_FILES: Record<string, string> = {
  ".zshenv": zshFile(".zshenv"),
  ".zprofile": zshFile(".zprofile"),
  ".zshrc": zshFile(".zshrc", ["if [[ ! -o login ]]; then", "  ZDOTDIR=$_vau_zdot", ...zshDone.map((l) => `  ${l}`), "fi"]),
  ".zlogin": zshFile(".zlogin"),
  bashrc: [
    "# Vaultite's terminals start bash with this (--rcfile): a login shell's files, then Vaultite's vau first on PATH.",
    "if [ -r /etc/profile ]; then . /etc/profile; fi",
    "for _vau_f in ~/.bash_profile ~/.bash_login ~/.profile; do if [ -r \"$_vau_f\" ]; then . \"$_vau_f\"; break; fi; done",
    "unset _vau_f",
    // (Git Bash is given Windows paths, C:\x, which its PATH has as /c/x)
    "for _vau_d in \"$VAULTITE_AGENT_BIN\" \"$VAULTITE_BIN\"; do case $_vau_d in [A-Za-z]:*) _vau_d=$(cygpath -u \"$_vau_d\" 2>/dev/null) ;; esac; if [ -n \"$_vau_d\" ]; then PATH=\"$_vau_d:$PATH\"; fi; done",
    "unset _vau_d",
    "",
  ].join("\n"),
  // WSL's distros start this (wsl.exe -e sh wsl.sh [command]), as shellArgs starts a login shell: the user's own
  // shell (WSL's -e runs none), through these same files, running an agent's command first.
  "wsl.sh": [
    "# Vaultite's terminals start a WSL distro's shell with this: the user's login shell, then Vaultite's vau first on PATH.",
    "u=$(getent passwd \"$(id -un)\" 2>/dev/null | cut -d: -f7); [ -x \"$u\" ] || u=/bin/sh",
    "d=$(cd \"$(dirname \"$0\")\" && pwd); export SHELL=\"$u\"",
    // (only: the command alone, the terminal ending with it)
    "if [ \"$2\" = only ]; then exec \"$u\" -l -i -c \"$1\"; fi",
    "case ${u##*/} in",
    "  bash) set -- \"$u\" --rcfile \"$d/bashrc\" -i ${1:+-c \"$1; exec '$u' --rcfile '$d/bashrc' -i\"} ;;",
    "  zsh) [ -n \"$ZDOTDIR\" ] && export VAULTITE_USER_ZDOTDIR=\"$ZDOTDIR\"; export ZDOTDIR=\"$d\" VAULTITE_ZDOTDIR=\"$d\"",
    "    set -- \"$u\" -l ${1:+-i -c \"$1; export ZDOTDIR='$d'; exec '$u' -l\"} ;;",
    // (an agent's line is sh's: fish runs it through sh)
    "  fish) export VAULTITE_RUN=\"$1\"; set -- \"$u\" -l -C 'for _vau_d in $VAULTITE_AGENT_BIN $VAULTITE_BIN; set -gx PATH $_vau_d $PATH; end; set -e _vau_d' ${1:+-c \"sh -c \\\"\\$VAULTITE_RUN\\\"; exec '$u' -l\"} ;;",
    "  *) set -- \"$u\" -l ${1:+-i -c \"$1; exec '$u' -l\"} ;;",
    "esac",
    "exec \"$@\"",
    "",
  ].join("\n"),
}
/** Write the startup files where they're missing or old (the folder is a temporary one). */
export function shellFiles() {
  fs.mkdirSync(SHELL_DIR, { recursive: true })
  for (const [name, text] of Object.entries(SHELL_FILES)) {
    const file = path.join(SHELL_DIR, name)
    let now = ""
    try { now = fs.readFileSync(file, "utf8") } catch { /* not yet */ }
    if (now !== text) fs.writeFileSync(file, text)
  }
}

/** A login shell's arguments: zsh's own (ZDOTDIR, in the shell's variables, does the rest), bash's files read by
 *  SHELL_DIR's rcfile, fish's PATH set after its config. */
export function loginArgs(shell: string): string[] {
  const name = progName(shell)
  if (name === "bash") return ["--rcfile", slashed(path.join(SHELL_DIR, "bashrc")), "-i"]
  if (name === "fish") return ["-l", "-C", "for _vau_d in $VAULTITE_AGENT_BIN $VAULTITE_BIN; set -gx PATH $_vau_d $PATH; end; set -e _vau_d"]
  return ["-l"]
}

/** The login shell's arguments (`only`: see Spec): interactive (so it has the user's PATH) running the agent's command first, then a
 *  plain login shell in its place (zsh's through SHELL_DIR again: its .zlogin gave ZDOTDIR back). */
export function shellArgs(shell: string, run: AgentRun | null, only = false) {
  const login = loginArgs(shell)
  if (!run) return login
  // (a command alone: the terminal ends with it, its exit status the terminal's)
  if (only) return [...login.filter((a) => a !== "-i"), "-i", "-c", run.command]
  const zdot = progName(shell) === "zsh" ? `if [ -n "$VAULTITE_ZDOTDIR" ]; then export ZDOTDIR="$VAULTITE_ZDOTDIR"; fi; ` : ""
  return [...login.filter((a) => a !== "-i"), "-i", "-c", `${run.command}; ${zdot}exec ${[shell, ...login].map(shellQuote).join(" ")}`]
}
/** A Windows path as Git Bash's sh reads it best (C:/x). */
const slashed = (p: string) => (process.platform === "win32" ? p.replace(/\\/g, "/") : p)
/** A Windows path as WSL sees it (its long form: WSL can't follow 8.3 names like RUNNER~1). */
export function wslPath(p: string) {
  let long = p
  try { long = fs.realpathSync.native(p) } catch { /* not there yet */ }
  return toWsl(long) ?? toWsl(p) ?? p
}
/** PowerShell's quoting: in '...' only ' means anything (doubled). */
export const psQuote = (s: string) => `'${s.replaceAll("'", "''")}'`

/** The script a ready shell runs to become an agent's (typed into it as one short line), for its kind of shell (cmd
 *  has no ready shells: it starts at once). */
export function runScript(file: string, id: string, run: AgentRun, kind: ShellKind = "posix") {
  if (kind === "pwsh") {
    // (read and run, not dot-sourced: an execution policy may refuse a script file, never a command)
    const ps1 = `${file}.ps1`
    fs.writeFileSync(ps1, [`Remove-Item -LiteralPath ${psQuote(ps1)}`, "Clear-Host", `$env:VAULTITE_TERMINAL = ${psQuote(id)}`,
      ...(run.cwd ? [`Set-Location -LiteralPath ${psQuote(run.cwd)}`] : []), run.command, ""].join("\r\n"), { mode: 0o600 })
    return ` Invoke-Expression ([IO.File]::ReadAllText(${psQuote(ps1)}))`
  }
  const there = kind === "wsl" ? wslPath : slashed
  fs.writeFileSync(file, "")
  const at = there(file)
  // (the empty title: a prompt's, like Ubuntu's "user@host: dir", would name the agent's tab until it sets its own)
  fs.writeFileSync(file, `rm -f ${shellQuote(at)}\nclear\nprintf '\\033]0;\\007'\nexport VAULTITE_TERMINAL=${shellQuote(id)}\n${run.cwd ? `cd ${shellQuote(there(run.cwd))} && ` : ""}${run.command}\n`, { mode: 0o600 })
  return ` source ${shellQuote(at)}`
}

// PowerShell's console in UTF-8, as Node, git and vau write: else it reads a program's output (`$x = vau read ...`, an
// agent's commands) in the old OEM code page, "naïve" as "na├»ve". What runs there shares the console, so it too.
const UTF8 = "[Console]::InputEncoding = [Console]::OutputEncoding = $OutputEncoding = [Text.UTF8Encoding]::new($false)"
/** How a command alone ends PowerShell: its program's exit code, else 1 when it failed ($? read first, before it changes). */
const PS_EXIT = "$vauOk = $?; if ($LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $vauOk) { exit 1 } else { exit 0 }"

/** What starts a shell: its program, arguments (a string: Windows' whole command line, for cmd's own quoting), folder
 *  and environment. PowerShell takes an agent's line encoded (no quoting to get wrong); WSL starts through wsl.sh. */
export type Launch = { file: string; args: string[] | string; cwd: string; env: Record<string, string> }
export function launch(spec: Spec): Launch {
  const run = spec.run, cwd = run?.cwd || spec.cwd, env = { ...spec.env, ...spec.ctx }
  switch (kindOf(spec.shell)) {
    case "pwsh":
      // (a command alone exits with its program's code, which PowerShell otherwise makes 0 or 1; a cmdlet that failed
      // sets no code, only $?: 1)
      return { file: spec.shell, args: ["-NoLogo", ...(run && spec.only ? [] : ["-NoExit"]), "-EncodedCommand",
        Buffer.from(run ? `${UTF8}\n${run.command}${spec.only ? `\n${PS_EXIT}` : ""}` : UTF8, "utf16le").toString("base64")], cwd, env }
    case "cmd":
      // (/s: cmd takes what's between the outer quotes as it is)
      return { file: spec.shell, args: run ? `/s /${spec.only ? "c" : "k"} "${run.command}"` : [], cwd, env }
    case "wsl": {
      const wsl = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wsl.exe")
      return { file: wsl, args: ["-d", distroOf(spec.shell), "--cd", wslPath(cwd), "-e", "sh", wslPath(path.join(SHELL_DIR, "wsl.sh")), ...(run ? [run.command, ...(spec.only ? ["only"] : [])] : [])],
        cwd: os.homedir(), env }
    }
    default:
      return { file: spec.shell, args: shellArgs(spec.shell, run, spec.only), cwd, env }
  }
}

const WIN = process.platform === "win32"
/** This user, in a pipe's name (pipes are the machine's, not a user's: another's server would find this one's). */
const userTag = () => `${os.userInfo().username}-${crypto.createHash("sha1").update(os.homedir()).digest("hex").slice(0, 8)}`.replace(/[^\w.-]/g, "_")
/** What a shell started from `shell` lists as on Windows, where node-pty can't tell what runs: "pwsh", "cmd", "wsl". */
export const shellName = (shell: string) => (kindOf(shell) === "wsl" ? "wsl" : progName(shell))

/** Ends a shell: a hangup, as closing a terminal sends (Windows has no signals: its console closes). */
export function hangup(p: IPty) {
  try { if (WIN) p.kill(); else p.kill("SIGHUP") } catch { /* ended */ }
}

// ---------- node-pty, loaded on first use (if the native module can't load here, only the terminal breaks)

let ptyLib: typeof import("node-pty") | null = null
export async function loadPty() {
  // Its prebuilt spawn-helper can arrive without the exec bit (npm skips its install scripts): posix_spawnp fails.
  // Checked before every shell, not once: an npm install while the server runs puts a new one there.
  const { createRequire } = await import("node:module")
  const dir = path.dirname(createRequire(import.meta.url).resolve("node-pty/package.json"))
  if (process.platform !== "win32") for (const sub of [`prebuilds/${process.platform}-${process.arch}`, "build/Release"]) {
    const helper = path.join(dir, sub, "spawn-helper")
    try { if (!(fs.statSync(helper).mode & 0o111)) fs.chmodSync(helper, 0o755) } catch { /* not there */ }
  }
  ptyLib ??= (await import("node-pty")).default as unknown as typeof import("node-pty")
  return ptyLib
}

export const plain = (s: string) => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]/g, "").replace(/\r(?!\n)/g, "")

/** A Link without pictures: a pty this process holds (a plugin backend's attach client), for `mirrored`. */
export type RawLink = Omit<Link, "snapshot">

/** A RawLink around a pseudo-terminal this process holds (a plugin backend's attach client, like herdr's). `exit`: how
 *  it ended, as the backend tells (null: only the client ended, reattach). */
export function ptyLink(p: IPty, extra: Partial<Pick<Link, "write" | "onData">> & { exit?: (code: number, signal: number) => Promise<Exit> } = {}): RawLink {
  return {
    get cols() { return p.cols },
    get rows() { return p.rows },
    write: extra.write ?? ((b) => { try { p.write(b as unknown as string) } catch { /* ended */ } }),
    resize: (c, r) => { try { p.resize(c, r) } catch { /* ended */ } },
    onData: extra.onData ?? ((fn) => { p.onData(fn) }),
    onExit: (fn) => { p.onExit(async ({ exitCode, signal }) => fn(extra.exit ? await extra.exit(exitCode, signal ?? 0) : { code: exitCode, signal: signal ?? 0 })) },
    pause: () => p.pause(),
    resume: () => p.resume(),
    close: () => hangup(p),
  }
}

/** A Link that gives pictures of one that can't, by reading its output through a headless xterm.js first, so a viewer
 *  who joins gets the screen as it is (for backends whose client only sends what changed). */
export async function mirrored(link: RawLink, scrollback = limits.scrollback()): Promise<Link> {
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
    pause: link.pause && (() => link.pause!()),
    resume: link.resume && (() => link.resume!()),
    close: () => link.close(),
  }
}

// ---------- the terminal server's client (termd/protocol.ts): over its socket, or in this process (local)

type Msg = Record<string, unknown>
/** Messages to and from a terminal server: over a socket, or to one in this process. */
type Pipe = { write(m: Msg): void; onMessage(fn: (m: Msg) => void): void; onClose(fn: () => void): void; close(): void; pause(): void; resume(): void }

/** One connection to a terminal server: requests with answers, and the messages it sends unasked. */
class Wire {
  pipe: Pipe
  seq = 0
  waiting = new Map<number, { ok: (v: Msg) => void; fail: (e: Error) => void }>()
  listeners = new Set<(m: Msg) => void>()
  closed = false
  onClose: (() => void) | null = null
  constructor(pipe: Pipe) {
    this.pipe = pipe
    // (what hears a message never ends the server by throwing: it's logged)
    pipe.onMessage((m) => {
      try {
        if (typeof m.re === "number" && this.waiting.has(m.re)) {
          const w = this.waiting.get(m.re)!
          this.waiting.delete(m.re)
          if (typeof m.error === "string") w.fail(new Error(m.error)); else w.ok(m)
        } else for (const fn of this.listeners) fn(m)
      } catch (e) { console.error("terminal: a message from the terminal server:", e) }
    })
    pipe.onClose(() => {
      if (this.closed) return
      this.closed = true
      for (const w of this.waiting.values()) w.fail(new Error("the terminal server went away"))
      this.waiting.clear()
      this.onClose?.()
    })
  }
  send(op: string, params: Msg = {}) {
    if (!this.closed) this.pipe.write({ op, ...params })
  }
  /** A request whose answer `fn` gets as it arrives, between the messages around it (a promise's would come after the
   *  next ones in the same chunk). */
  call(op: string, params: Msg, fn: (m: Msg) => void) {
    if (this.closed) return
    const re = ++this.seq
    this.waiting.set(re, { ok: fn, fail: () => {} })
    this.pipe.write({ op, re, ...params })
  }
  request(op: string, params: Msg = {}, ms = 5000): Promise<Msg> {
    if (this.closed) return Promise.reject(new Error("the terminal server went away"))
    const re = ++this.seq
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => { this.waiting.delete(re); fail(new Error(`the terminal server didn't answer ${op}`)) }, ms)
      this.waiting.set(re, { ok: (v) => { clearTimeout(timer); ok(v) }, fail: (e) => { clearTimeout(timer); fail(e) } })
      this.pipe.write({ op, re, ...params })
    })
  }
  close() { this.pipe.close() }
}

/** A socket's messages: newline JSON. */
const connectTo = (socket: string) => new Promise<Wire>((ok, fail) => {
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

/** The terminal server's name for a server on `port`: `vaultite` on 8793, else `vaultite-<port>` (a QA one's); an app
 *  serving nothing (port 0: a test's, npm run check's) its own, never reaching a live server's terminals. */
export const backendName = (port: number, pid = process.pid) => (port === 8793 ? "vaultite" : `vaultite-${port || `x${pid}`}`)

const WIN_PIPE = (name: string, v: number) => `\\\\.\\pipe\\vaultite-${v === 1 ? "ptyd" : "termd"}${v}-${name}-${userTag()}`
/** Where the terminal server for `name` (backendName) answers, and where its .log and .pid go: protocol `v`'s (1, the
 *  keeper before it: ptyd). */
export function serverFiles(name: string, v = PROTOCOL): ServerFiles {
  const files = path.join(runtimeDir(), `vaultite-${v === 1 ? "ptyd" : "termd"}${v}-${name}.sock`)
  return { files, socket: WIN ? WIN_PIPE(name, v) : files }
}
export type ServerFiles = { files: string; socket: string }
/** What says a terminal server runs there, without opening it: a pipe opened to look would take one of its instances. */
const markOf = (f: ServerFiles) => (WIN ? `${f.files}.pid` : f.socket)
const there = (f: string) => new Promise<boolean>((ok) => fs.stat(f, (e) => ok(!e)))
/** Older servers' terminals, taken over by the server at `w` (termd/adopt.ts) before anything is listed: they're the
 *  user's live shells. */
async function takeOver(w: Wire, olds: ServerFiles[], log?: (...a: unknown[]) => void) {
  for (const { socket: old } of olds) {
    const r = await w.request("adopt", { socket: old, scrollback: limits.scrollback() }, 60_000).catch((e: Error) => ({ error: e.message }) as Msg)
    if (Array.isArray(r.adopted) && r.adopted.length) log?.(`took over ${r.adopted.length} terminals from the older server at ${old}`)
    else if (r.error) log?.(`couldn't take over the terminals at ${old}: ${r.error}`)
  }
}

/** A backend's view of the terminal server's answers: its Info as listed. */
function listed(x: Info): Listed {
  return { id: x.id, pid: x.pid || undefined, process: x.process, created: x.created, activity: x.activity, attached: x.clients, title: x.title, cwd: x.cwd || undefined,
    command: x.command || undefined, cols: x.cols, rows: x.rows, meta: x.meta, said: x.said, ...(x.exit ? { exit: x.exit } : {}), ...(x.spare ? { spare: true } : {}) }
}

/** What either kind of terminal server answers with, given how to reach it. `control`: the connection for requests and
 *  events (made when first asked), `running`: it only if the server already runs, `open`: a new one for an attach. */
function termdClient(o: { name: string; label: string; control: () => Promise<Wire>; running: () => Promise<Wire | null>; open: () => Promise<Wire> }) {
  const heard = new Set<(ev: BackendEvent) => void>()
  const ask = async (op: string, params: Msg = {}, ms?: number) => (await o.control()).request(op, params, ms)
  const backend = {
    name: o.name, label: o.label, spares: true,
    ready: async () => !!(await o.control().catch(() => null)),
    async list(q?: { ended?: boolean }): Promise<Listed[]> {
      const w = await o.running()
      if (!w) return []
      try {
        const r = await w.request("list", q?.ended ? { ended: true } : {})
        return [...(r.sessions as Info[] ?? []), ...(r.ended as Info[] ?? [])].map(listed)
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
      let size = { cols, rows }
      const data = new Set<(d: string) => void>(), exits = new Set<(e: Exit) => void>()
      let exit: Exit | undefined
      w.listeners.add((m) => {
        if (m.t === "data" && typeof m.d === "string") for (const fn of data) fn(m.d)
        else if (m.t === "size") size = { cols: Number(m.cols), rows: Number(m.rows) }
        else if (m.t === "exit") { exit = { code: Number(m.code) || 0, signal: Number(m.signal) || 0, ...(m.lost ? { lost: true } : {}) }; w.close() }
      })
      // Ended, or the server went away (its terminals with it: there's nothing to reattach to then either).
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
        // (its connection stops being read: the server holds the pty once that's full)
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
      return { text: String(r.text ?? ""), cols: Number(r.cols), rows: Number(r.rows), cursor: r.cursor as Capture["cursor"], alternate: !!r.alternate,
        ...(r.input ? { input: r.input as Capture["input"] } : {}), ...(r.ended ? { ended: true } : {}) }
    },
    async send(id: string, input: Input) {
      if ("keys" in input) await ask("keys", { id, keys: input.keys })
      // (the server brackets a paste when its program asked for that: it has the screen's modes)
      else if (input.text) await ask("input", { id, b64: Buffer.from(input.text).toString("base64"), ...(input.paste ? { paste: true } : {}) })
    },
    // (the connection that hears them is made when the server runs: now, or with its first terminal)
    events: (fn: (ev: BackendEvent) => void) => { heard.add(fn); void o.running() },
    dropStatus: async (id: string) => { await (await o.running())?.request("status-drop", { id }).catch(() => {}) },
  } satisfies Backend
  /** The control connection's events, to whoever hears them (a server from an older build gives none). */
  const follow = (w: Wire) => {
    w.listeners.add((m) => {
      if (m.t !== "event" || typeof m.id !== "string" || typeof m.type !== "string") return
      const ev = (m.type === "started" && m.info ? { ...m, info: listed(m.info as Info) } : m) as unknown as BackendEvent
      for (const fn of heard) fn(ev)
    })
    w.send("subscribe")
  }
  return { backend, follow, ask }
}

/** The terminal server at `name` (backendName). Older ones' terminals (the keeper before it, ptyd) are taken over by it
 *  (termd/adopt.ts) once it runs, so none is left unseen after an upgrade. */
export function termdBackend(name: string, o: { daemon: string; log?: (...a: unknown[]) => void; oldServers?: ServerFiles[] }) {
  const { files, socket } = serverFiles(name)
  const mark = markOf({ files, socket })
  let ctl: Promise<Wire> | null = null

  /** Starts it: detached (its own session and process group) and, under systemd, in a scope of its own, so nothing that
   *  ends the app's server ends it. The desktop app's server runs on Electron as Node (ELECTRON_RUN_AS_NODE). */
  function startServer(plain = false) {
    let out: number | "ignore" = "ignore"
    try { out = fs.openSync(`${files}.log`, "a") } catch { /* no log */ }
    const [cmd, args] = plain ? [process.execPath, [o.daemon, socket, files]] : outliving(process.execPath, [o.daemon, socket, files], `termd-${name}`)
    const child = spawn(cmd, args, { detached: true, stdio: ["ignore", out, out], cwd: os.homedir(), env: process.env, windowsHide: true })
    // systemd-run that couldn't make the scope (no user bus) fails at once: start it as before.
    if (cmd !== process.execPath) child.once("exit", (code) => { if (code) startServer(true) })
    child.unref()
    if (typeof out === "number") fs.closeSync(out)
  }

  /** A connection, starting the server when none answers. */
  async function open(): Promise<Wire> {
    try { return await connectTo(socket) } catch { /* not running */ }
    startServer()
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 50))
      try { return await connectTo(socket) } catch { /* not yet */ }
    }
    throw new Error(`the terminal server didn't start (see ${files}.log)`)
  }

  function control(): Promise<Wire> {
    if (!ctl) {
      // (a connection that closes clears only itself: a retired server's can close after the next one's is made)
      const p: Promise<Wire> = open().then(async (w) => {
        w.onClose = () => { if (ctl === p) ctl = null }
        client.follow(w)
        await takeOver(w, o.oldServers ?? [], o.log && ((...a) => o.log!("terminal:", ...a)))
        return w
      })
      ctl = p
      p.catch(() => { if (ctl === p) ctl = null })
    }
    return ctl
  }
  /** Only when it's already running (or an older one with terminals to take over is): listing shouldn't start it. */
  async function running(): Promise<Wire | null> {
    if (ctl) return ctl.catch(() => null)
    if (!(await there(mark)) && !(await Promise.all((o.oldServers ?? []).map((f) => there(markOf(f))))).some(Boolean)) return null
    return control().catch(() => null)
  }
  const client = termdClient({ name: "vaultite", label: "Vaultite", control, running, open })
  const b = client.backend
  return {
    ...b, socket, files,
    async create(id: string, spec: Spec, c?: Made) {
      try { await b.create(id, spec, c) } catch (e) {
        // A server whose files are gone (its checkout moved: termd.ts, stale) can't start terminals, and makes way when
        // it holds none: once it's gone, the next one starts from this server's files.
        if (!/^RETIRING\b/.test((e as Error).message)) throw e
        o.log?.("terminal: the terminal server's files were gone, so it retired: starting a new one")
        for (let i = 0; i < 40 && fs.existsSync(mark); i++) await new Promise((r) => setTimeout(r, 50))
        ctl = null
        await b.create(id, spec, c)
      }
    },
    /** Whether the terminal server running now can read `dir`; null when none runs (one isn't started for this). */
    async access(dir: string): Promise<Access | null> {
      const w = await running()
      if (!w) return null
      try {
        const r = await w.request("access", { path: dir })
        return accessOf(r.ok ? "" : String(r.code || "EIO"))
      } catch (e) { return { ok: null, why: (e as Error).message } }
    },
    /** The server's own answer to `op` (tests, and what only it knows). */
    ask: client.ask,
  }
}

/** Terminals held in this process (when the terminal server can't start): the same server's core (termd/host.ts),
 *  so they're listed, captured and waited for alike, but end with this server. */
export function localBackend(o: { log?: (...a: unknown[]) => void; oldServers?: ServerFiles[]; adoptOld?: () => Promise<boolean> } = {}): Backend {
  let made: Promise<import("./termd/host.ts").Host> | null = null
  const hostNow = () => (made ??= import("./termd/host.ts").then(({ host }) => host({ log: o.log ?? (() => {}), pid: process.pid, file: "this server" })))
  /** An in-process pipe: each message goes on in order, a turn later (as a socket's would), held while paused. */
  async function open(): Promise<Wire> {
    const h = await hostNow()
    let paused = false, closed = false
    const held: Msg[] = [], toClient = new Set<(m: Msg) => void>(), closers: (() => void)[] = []
    let queued = 0
    const deliver = (m: Msg) => { for (const fn of toClient) fn(m) }
    const conn = h.connect({
      session: null, ready: false,
      send: (m) => {
        if (closed) return
        if (paused) { held.push(m as Msg); queued += String((m as Msg).d ?? "").length; return }
        queueMicrotask(() => { if (!closed) deliver(m as Msg) })
      },
      backlog: () => queued,
    })
    const w = new Wire({
      write: (m) => queueMicrotask(() => { if (!closed) conn.take(m) }),
      onMessage: (fn) => { toClient.add(fn) },
      onClose: (fn) => { closers.push(fn) },
      close: () => { if (closed) return; closed = true; conn.gone(); for (const fn of closers.splice(0)) fn() },
      pause: () => { paused = true },
      resume: () => {
        paused = false
        for (const m of held.splice(0)) deliver(m)
        queued = 0
        conn.drained()
      },
    })
    return w
  }
  // (older servers' terminals are taken over here when `adoptOld` says so: the terminal server can't run to take them)
  const olds = o.oldServers ?? []
  const adoptNow = async () => !!olds.length && (await Promise.all(olds.map((f) => there(markOf(f))))).some(Boolean) && !!(await o.adoptOld?.().catch(() => false))
  let ctl: Promise<Wire> | null = null
  const control = () => (ctl ??= open().then(async (w) => {
    client.follow(w)
    if (await adoptNow()) await takeOver(w, olds, o.log)
    return w
  }))
  const client = termdClient({ name: "pty", label: "This server", control, running: async () => (made || (await adoptNow()) ? control() : null), open })
  return { ...client.backend, spares: false }
}
