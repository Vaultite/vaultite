// Where terminals live so they outlive the server: the terminal server (termd/), the server itself when that can't start,
// or another plugin's ("terminal:backend"). Its types are the contract a plugin's backend implements (with backendKit).
import crypto from "node:crypto"
import fs from "node:fs"
import { shellQuote } from "../../../core/agents.ts"
import { type Access, accessOf, outliving, runtimeDir, toWsl } from "../../../core/plugins.ts"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { execFile, spawn } from "node:child_process"
import type { IPty } from "node-pty"
import { lineReader } from "./lines.ts"
import type { Said } from "./osc7501.ts"
import { distroOf, kindOf, progName, type ShellKind } from "./shells.ts"
import { PROTOCOL, type Answer, type Capture, type CaptureFormat, type Event, type Exit as Ended, type Info, type Op, type Params, type Unasked } from "./termd/protocol.ts"

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

export type Cell = { width: number; height: number }

/** One server's hold on a running terminal: what it prints, and typing and resizing it. */
export interface Link {
  readonly cols: number
  readonly rows: number
  write(data: Buffer): void
  /** `cell`: a cell's size in the device's pixels (the cells a picture covers: kitty graphics). */
  resize(cols: number, rows: number, cell?: Cell): void
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
  /** Held through an older terminal server (termd/adopt.ts): its pid. */
  via?: number
  /** It ended, and how (only with list's `ended`). */
  exit?: Ended
  /** Not started by Vaultite (a herdr pane of the user's). */
  external?: boolean
  spare?: boolean }

/** What a backend tells as it happens (Backend.events): termd/protocol.ts' events, `info` as it lists it. */
export type BackendEvent = Exclude<Event, { type: "started" }> | { type: "started"; id: string; info?: Listed }

/** A backend's terminals out of reach: since when, its server's pid, and that said for the user. */
export type Trouble = { since: number; pid: number; text: string }

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
  /** Why its terminals can't be reached now (its server stopped answering: they're frozen, and not listed), or null. */
  trouble?(): Trouble | null
  /** Its program ended (the app saw its shell at the prompt again): the working and blocked OSC 7501 records go. */
  dropStatus?(id: string): Promise<void>
  /** Whether its terminals draw kitty graphics a program sends as Claude Code does (by file, or PNG: termd/kitty.ts makes
   *  them pixels). Without it, none: pages can't read files or decode a PNG in time. */
  pictures?(): Promise<boolean>
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
export function runScript(file: string, id: string, run: AgentRun, kind: ShellKind = "posix", shell = "") {
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
  // (`.`: sh and dash have no `source`, so an agent never started there; fish has only `source`)
  return ` ${progName(shell) === "fish" ? "source" : "."} ${shellQuote(at)}`
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

/** A Link that gives pictures of one that can't, by reading its output into a terminal of its own (libghostty-vt)
 *  first, so a viewer who joins gets the screen as it is (for backends whose client only sends what changed). */
export async function mirrored(link: RawLink, scrollback = limits.scrollback()): Promise<Link> {
  const { newVt } = await import("./vt/load.ts")
  const term = newVt({ cols: link.cols, rows: link.rows, scrollback })
  let ended = false
  const data = new Set<(d: string) => void>()
  // Parsed, then passed on, so a picture and the data around it never overlap.
  // (libghostty-vt failing on it: no more pictures, the data still passed on)
  link.onData((d) => { if (!ended) try { term.write(d) } catch { ended = true }; for (const fn of data) fn(d) })
  link.onExit(() => { ended = true; term.dispose() })
  return {
    get cols() { return link.cols },
    get rows() { return link.rows },
    write: (b) => link.write(b),
    resize: (c, r, cell) => { link.resize(c, r, cell); if (!ended) term.resize(c, r, cell?.width, cell?.height) },
    onData: (fn) => { data.add(fn) },
    onExit: (fn) => link.onExit(fn),
    snapshot: (fn) => fn(ended ? "" : term.serialize()),
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
  listeners = new Set<(m: Unasked) => void>()
  closed = false
  onClose: (() => void) | null = null
  /** Since when a request went unanswered with nothing heard from the server after it (null: it answers), for a wire
   *  with `onStall`: requests then fail at once with `stalled()`'s words, but hello (a probe). */
  stalledSince: number | null = null
  onStall: ((op: string) => void) | null = null
  onAnswer: ((ms: number) => void) | null = null
  stalled: () => string = () => "the terminal server isn't answering"
  constructor(pipe: Pipe) {
    this.pipe = pipe
    // (what hears a message never ends the server by throwing: it's logged)
    pipe.onMessage((m) => {
      if (this.stalledSince !== null) { const ms = Date.now() - this.stalledSince; this.stalledSince = null; this.onAnswer?.(ms) }
      try {
        if (typeof m.re === "number" && this.waiting.has(m.re)) {
          const w = this.waiting.get(m.re)!
          this.waiting.delete(m.re)
          if (typeof m.error === "string") w.fail(new Error(m.error)); else w.ok(m)
        } else if (typeof m.t === "string") for (const fn of this.listeners) fn(m as Unasked)
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
  send<O extends Op>(op: O, params: Params<O>) {
    if (!this.closed) this.pipe.write({ op, ...params })
  }
  /** A request whose answer `fn` gets as it arrives, between the messages around it (a promise's would come after the
   *  next ones in the same chunk). */
  call<O extends Op>(op: O, params: Params<O>, fn: (m: Answer<O>) => void) {
    if (this.closed) return
    const re = ++this.seq
    this.waiting.set(re, { ok: (m) => fn(m as Answer<O>), fail: () => {} })
    this.pipe.write({ op, re, ...params })
  }
  request<O extends Op>(op: O, params: Params<O>, ms = 5000): Promise<Answer<O>> {
    if (this.closed) return Promise.reject(new Error("the terminal server went away"))
    if (this.stalledSince !== null && op !== "hello") return Promise.reject(new Error(this.stalled()))
    const re = ++this.seq, at = Date.now()
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        this.waiting.delete(re)
        if (this.onStall && this.stalledSince === null) { this.stalledSince = at; this.onStall(op) }
        fail(new Error(this.onStall ? this.stalled() : `the terminal server didn't answer ${op}`))
      }, ms)
      this.waiting.set(re, { ok: (v) => { clearTimeout(timer); ok(v as Answer<O>) }, fail: (e) => { clearTimeout(timer); fail(e) } })
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
    const r = await w.request("adopt", { socket: old, scrollback: limits.scrollback() }, 60_000).then((a) => a.adopted, (e: Error) => e.message)
    if (typeof r === "string") log?.(`couldn't take over the terminals at ${old}: ${r}`)
    else if (r.length) log?.(`took over ${r.length} terminals from the older server at ${old}`)
  }
}

/** A backend's view of the terminal server's answers: its Info as listed. */
function listed(x: Info): Listed {
  return { id: x.id, pid: x.pid || undefined, process: x.process, created: x.created, activity: x.activity, attached: x.clients, title: x.title, cwd: x.cwd || undefined,
    command: x.command || undefined, cols: x.cols, rows: x.rows, meta: x.meta, said: x.said, ...(x.exit ? { exit: x.exit } : {}), ...(x.spare ? { spare: true } : {}),
    ...(x.via ? { via: x.via } : {}) }
}

/** What either kind of terminal server answers with, given how to reach it. `control`: the connection for requests and
 *  events (made when first asked), `running`: it only if the server already runs, `open`: a new one for an attach. */
function termdClient(o: { name: string; label: string; control: () => Promise<Wire>; running: () => Promise<Wire | null>; open: () => Promise<Wire> }) {
  const heard = new Set<(ev: BackendEvent) => void>()
  const ask = async <O extends Op>(op: O, params: Params<O>, ms?: number) => (await o.control()).request(op, params, ms)
  const hellos = new WeakMap<Wire, Promise<boolean>>()
  const backend = {
    name: o.name, label: o.label, spares: true,
    ready: async () => !!(await o.control().catch(() => null)),
    /** As the server running now says (one from before pictures says nothing): asked once per connection. */
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
      // Ended, or the server went away (its terminals with it: there's nothing to reattach to then either).
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
      return { text: r.text ?? "", cols: r.cols, rows: r.rows, cursor: r.cursor, alternate: !!r.alternate,
        ...(r.input ? { input: r.input } : {}), ...(r.ended ? { ended: true } : {}) }
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
      if (m.t !== "event") return
      const { t: _, ...e } = m
      const ev: BackendEvent = e.type === "started" ? { ...e, info: listed(e.info) } : e
      for (const fn of heard) fn(ev)
    })
    w.send("subscribe", {})
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
        const at = Date.now()
        // (its events are heard only on a control connection: one that closed is made again while the server runs, or a
        // terminal's state and end would go unheard till some call made one; soon, unless it closed at once)
        w.onClose = () => { answered(); if (ctl !== p) return; ctl = null; setTimeout(() => { if (!ctl) void running() }, Date.now() - at > 5000 ? 500 : 10_000).unref?.() }
        watch(w)
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

  // A server that stops answering (its loop held up, or stuck): said once, in the errors, with what's known of it; asked
  // every 5 s whether it answers again, and meanwhile what's asked of it fails at once (new terminals go to the fallback).
  let stall: { since: number; pid: number; probe: ReturnType<typeof setInterval>; looked: boolean } | null = null
  const pidOf = () => { try { return Number(fs.readFileSync(`${files}.pid`, "utf8").trim()) || 0 } catch { return 0 } }
  const clock = (t: number) => new Date(t).toTimeString().slice(0, 8)
  const stallText = () => stall ? `the terminal server (pid ${stall.pid || "unknown"}) hasn't answered since ${clock(stall.since)}: the terminals it holds are frozen until it does` : ""
  function watch(w: Wire) {
    w.stalled = () => stallText() || "the terminal server isn't answering"
    w.onStall = (op) => {
      const pid = pidOf()
      const probe = setInterval(() => {
        void w.request("hello", {}, 5000).catch(() => {})
        // (a minute on: what it's doing, as the machine sees it, so it's clear whether it's busy or stuck)
        if (stall && !stall.looked && Date.now() - stall.since > 60_000) { stall.looked = true; void lookAt(stall.pid, stall.since) }
      }, 5000)
      probe.unref?.()
      stall = { since: w.stalledSince ?? Date.now(), pid, probe, looked: false }
      o.log?.(`terminal: the terminal server (pid ${pid || "unknown"}) didn't answer ${op} in 5 s: the terminals it holds are frozen until it answers, and new ones run in this server (its log: ${files}.log)`)
    }
    w.onAnswer = (ms) => { if (!stall) return; answered(); console.log(`terminal: the terminal server answers again, after ${Math.round(ms / 1000)} s`) }
  }
  function answered() { if (stall) clearInterval(stall.probe); stall = null }
  async function lookAt(pid: number, since: number) {
    if (!pid || WIN) return
    const cpu = await new Promise<string>((ok) => execFile("ps", ["-o", "%cpu=", "-p", String(pid)], { timeout: 3000 }, (e, out) => ok(e ? "" : String(out).trim())))
    if (!stall || stall.since !== since) return
    o.log?.(cpu
      ? `terminal: the terminal server (pid ${pid}) still hasn't answered after ${Math.round((Date.now() - since) / 1000)} s, at ${cpu}% CPU${Number(cpu) > 80 ? ": stuck in a loop. Ending it (kill " + pid + ") ends its terminals, which can't go on anyway" : ""}`
      : `terminal: the terminal server (pid ${pid}) still hasn't answered, and isn't running`)
  }

  const client = termdClient({ name: "vaultite", label: "Vaultite", control, running, open })
  const b = client.backend
  return {
    ...b, socket, files,
    trouble: (): Trouble | null => (stall ? { since: stall.since, pid: stall.pid, text: stallText() } : null),
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
        if (paused) { held.push(m); queued += typeof m.d === "string" ? m.d.length : 0; return }
        queueMicrotask(() => { if (!closed) deliver(m) })
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
