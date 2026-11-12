// A shell kept ready: a login shell's startup files take up to seconds, so one is started ahead per kind of page
// (local, remote), taken by the next terminal (renamed to its id), then replaced. A starting server drops older ones.
import fs from "node:fs"
import path from "node:path"
import { type RawData, WebSocket } from "ws"
import type { AgentHow } from "../../../core/agents.ts"
import { readableImage, span } from "../../../core/plugins.ts"
import { type BackendEvent, runScript, wslPath, type AgentRun, type Backend, type Cell, type Listed as Shell, type Made, type Spec } from "./backend.ts"
import { kindOf, progName } from "./shells.ts"
import { byUs, closes } from "./state.ts"
import { BLOCKED, EXITED, SPARE, type Session, TERMINAL_ID, TMP, WIN, clamp, plugin, sameShell, scrollback, sessions, shell } from "./shared.ts"
import { type From, type Home, LOCAL, PATH, agentOf, backendForNew, backendOf, context, dropped, fallback, hooksText, keeper, oscMark, ours, ownedBy, stateFile, tell, termEnv, upload } from "./backends.ts"
import { agentReady, agentRun, apply, held, metas, oldMetaFiles, oscSaid, sighted, terms, told, vaultDir } from "./terms.ts"
import { listChanged } from "./list.ts"
import { exitHeard, lastInput, pageInput } from "./routes.ts"

/** How much output a terminal client may be behind before it's dropped (it reconnects and gets the replay). */
const BEHIND = 16 << 20
/** Output a page may have to draw before its shell is held (its program waits on a full pty), and when it goes on. */
const HOLD = 1 << 20, GO = 256 << 10, STALL = 3000

const sent = (s: Session, ws: WebSocket, n: number) => s.owed.set(ws, (s.owed.get(ws) ?? 0) + n)

/** Holds the shell's output while every page that tells what it drew is HOLD behind, so ⌃C in a flood is answered at
 *  once; the fastest sets the pace (a slower one past BEHIND is dropped, as before). */
function pace(s: Session) {
  let least = Infinity
  for (const ws of s.acks) least = Math.min(least, s.owed.get(ws) ?? 0)
  const hold = least !== Infinity && least > HOLD
  clearTimeout(s.stall)
  // (a page asleep on a live socket, or in a hidden browser tab, mustn't stall an agent's work: left behind, it's dropped)
  if (hold || s.held) s.stall = setTimeout(() => { for (const ws of s.acks) if (s.owed.get(ws)! > GO) s.acks.delete(ws); pace(s) }, STALL)
  if (hold === s.held || (!hold && least !== Infinity && least > GO)) return
  s.held = hold
  if (hold) s.link.pause?.(); else s.link.resume?.()
}

/** Sends what the backend said since the last flush to the pages, as one message; called once the read that brought
 *  it is done, and before anything that must come after it (a new page's join, the exit). */
function flush(s: Session) {
  if (!s.queued) return
  const bytes = Buffer.from(s.queued, "utf8")
  s.queued = ""
  for (const ws of s.clients) {
    if (ws.readyState !== ws.OPEN || s.pending.has(ws)) continue
    // A client that stopped reading (a phone asleep on a live socket) would hold a chatty agent's output in memory
    // without end: dropped, it reconnects and gets the replay.
    if (ws.bufferedAmount > BEHIND) { ws.terminate(); continue }
    ws.send(bytes)
    sent(s, ws, bytes.length)
  }
  pace(s)
}

const spares = new Map<string, { b: Backend; name: string; ready: Promise<boolean> }>() // by backend and From

export function makeSpare(from: From) {
  void (async () => {
    const b = await backendForNew(), sh = shell()
    const key = spareKey(b, from, sh)
    if (!b.spares || !sameShell(sh) || spares.has(key)) return
    const name = `${SPARE}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    // (its id comes when it's taken)
    const ready = dropped.then(async () => b.create(name, { shell: sh, run: null, cwd: vaultDir(), env: await termEnv(b), ctx: context(null, from, sh), cols: 120, rows: 40, scrollback: scrollback() },
      { spare: true })).then(() => true, () => false)
    spares.set(key, { b, name, ready })
  })()
}
const refill = (from: From) => setTimeout(() => makeSpare(from), 1500).unref?.()
/** Which ready shell a terminal can take: its backend's, for its kind of page, of the shell it starts, on the PATH it'd
 *  get now (one made before the server's PATH changed would miss what's on it). */
const spareKey = (b: Backend, from: From, sh: string) => `${b.name}:${from.remote}:${from.client}:${sh}:${process.env[PATH] ?? ""}`

/** The ready shell of backend `b`, renamed to session `id` (the agent's command started in it, which clears its screen
 *  and history: runScript): false when there's none. */
async function takeSpare(b: Backend, id: string, from: From, run: AgentRun | null, sh: string, made: Made) {
  const key = spareKey(b, from, sh)
  const spare = spares.get(key)
  if (!spare || !b.rename) return false
  spares.delete(key)
  if (!(await spare.ready)) return false
  try { await b.rename(spare.name, id, made) } catch { return false }
  if (run) {
    fs.mkdirSync(TMP, { recursive: true })
    // (with its Enter: a shell at its prompt reads it as typed, so no pause before it)
    await b.send(id, { text: `${runScript(path.join(TMP, `run-${id}.sh`), id, run, kindOf(sh), sh)}\r` })
  }
  return true
}

/** Starts a session (in the backend new ones go to), or reattaches to its shell if one runs (`fresh` says which). */
export async function start(id: string, cols: number, rows: number, from = LOCAL, prompt: string | null = null, dark: boolean | null = null,
  how: AgentHow = {}, o: { command?: string; name?: string; home?: Home } = {}): Promise<{ s: Session; fresh: boolean }> {
  const agent = agentOf(id), timing = span("terminal.start", { agent: agent?.name ?? "shell", how: "running" })
  let b = await backendOf(id)
  timing.mark("find")
  const fresh = !b
  let cwd = "" // (a new agent's folder)
  if (!b) {
    b = await backendForNew()
    // A coding agent: the login shell (interactive, so it has the user's PATH) runs it, then becomes a plain shell.
    const sh = shell(), command = o.command ? { command: o.command, cwd: how.cwd || null } : null
    const run = command ?? await agentRun(id, prompt, dark, how, sh)
    if (agent) timing.mark("agent")
    const spec: Spec = { shell: sh, run, only: !!command, cwd: how.cwd || vaultDir(), env: await termEnv(b), ctx: context(id, from, sh, o.home), cols, rows, scrollback: scrollback() }
    if (run) cwd = run.cwd || spec.cwd
    // (what its list says it runs, and the name it's given)
    const made: Made = { command: o.command ?? agent?.name ?? progName(sh), ...(o.name ? { meta: { name: o.name } } : {}) }
    timing.tags.how = "spare"
    // (a spare shell was told this server's variables: one with a home starts its own)
    if (command || o.home || !(b.spares && (await takeSpare(b, id, from, run, sh, made)))) {
      timing.tags.how = "new"
      try { await b.create(id, spec, made) } catch (e) {
        // (out of ptys, the server couldn't start one either: the keeper's message says why)
        if (b !== keeper || /no pseudo-terminal left/.test((e as Error).message)) throw e
        // One error a kind (vau errors counts each terminal, and tells the user the first time), not a message a terminal.
        console.error("terminal: the keeper couldn't start a shell, so this server holds it and restarting the server ends it:", e)
        b = fallback
        await b.create(id, spec, made)
      }
    }
    if (b.spares) refill(from)
    if (!ours(b)) ownedBy(id, b)
    // (a backend that keeps no meta: kept here)
    if (!b.setMeta && made.meta) metas.set(id, made.meta)
    timing.mark("shell")
    if (agent && run && !command) agentReady(id, agent.name)
  }
  const backend = b
  const link = await backend.attach(id, cols, rows)
  timing.mark("attach")
  const s: Session = { id, backend, link, clients: new Set(), started: Date.now(), pending: new Set(),
    opened: `${timing.tags.how} ${Math.round(timing.end())}ms`, queued: "", owed: new Map(), acks: new Set(), held: false }
  link.onData((data) => {
    // (a burst comes as many messages in one read: the microtask runs once that read's are all in)
    if (!s.queued) queueMicrotask(() => flush(s))
    s.queued += data
  })
  link.onExit(async (exit) => {
    clearTimeout(s.stall)
    flush(s)
    if (sessions.get(id) === s) sessions.delete(id)
    listChanged()
    let gone = exit
    const t = terms.get(id), by = t ? byUs(t) : null
    if (!exit && !by) {
      const x = (await backend.list({ ended: true }).catch(() => [] as Shell[])).find((y) => y.id === id)
      // Only our hold on it ended (a plugin backend's attach client was killed): the clients reconnect, which reattaches.
      if (x && !x.exit) {
        for (const ws of s.clients) ws.close(1012, "reattach")
        return
      }
      // (our terminal server gone with it, which tells nothing now: how it ended is unknown)
      if (x?.exit) gone = { code: x.exit.code, signal: x.exit.signal, lost: !!x.exit.lost }
      else if (ours(backend)) gone = { code: 0, signal: 0, lost: true }
    }
    // Ended by us: a SIGHUP, as when a shell is killed directly.
    const { code, signal, lost } = by ? { code: 0, signal: 1, lost: false } : gone ?? { code: 0, signal: 0, lost: false }
    // (a backend that tells its terminals' ends tells this one, onEvent, unless it's gone)
    if (!backend.events || (!exit && !by)) exited(id, { code, signal, lost })
    for (const ws of s.clients) {
      if (ws.readyState !== ws.OPEN) continue
      ws.send(JSON.stringify({ t: "exit", code, signal, ...(lost ? { lost: true } : {}), ...(by && !by.keep ? { ended: true } : {}) }))
      ws.close(EXITED, "exited")
    }
  })
  sessions.set(id, s)
  reopened(id)
  // (its agent may have written its state file before it was ours: the watcher let that one go)
  const hooks = hooksText(id)
  if (hooks) apply(id, { type: "hooks", text: hooks })
  listChanged()
  // An agent whose folder macOS keeps from the keeper stops with its own vague error ("Unexpected"): its tabs say why.
  if (cwd && backend === keeper && process.platform === "darwin") {
    void keeper.access(cwd).then((a) => {
      if (a?.ok !== false) return
      s.blocked = true
      for (const ws of s.clients) if (ws.readyState === ws.OPEN) ws.send(BLOCKED)
    })
  }
  return { s, fresh }
}

/** The terminals whose tabs close (state.ts' closes), kept on this machine so a tab put back after a restart closes too
 *  rather than starting a finished agent again: the ones this server knows, and before them the ones it doesn't. */
const closedFile = () => path.join(plugin.localDir(), "ended.json")
let earlier: Set<string> | null = null
/** The ones whose Term isn't kept here (from before this server, or dropped), read the first time (the plugin's folder
 *  is known once it's loaded). */
export function closedEarlier() {
  if (!earlier) { try { const v = JSON.parse(fs.readFileSync(closedFile(), "utf8")); earlier = new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []) } catch { earlier = new Set() } }
  return earlier
}
export const closesTabs = (id: string) => { const t = terms.get(id); return t ? closes(t) : closedEarlier().has(id) }
let closedWrite: ReturnType<typeof setTimeout> | null = null
export function keepClosed() {
  closedWrite ??= setTimeout(() => {
    closedWrite = null
    const ids = [...closedEarlier()].filter((id) => !terms.has(id)).concat([...terms].filter(([, t]) => closes(t)).map(([id]) => id)).slice(-500)
    try { fs.mkdirSync(plugin.localDir(), { recursive: true }); fs.writeFileSync(closedFile(), JSON.stringify(ids)) } catch { /* next time */ }
  }, 1000)
}
/** A session of terminal `id` runs here: its tabs no longer close. */
export function reopened(id: string) {
  const t = terms.get(id)
  if (t?.phase.state === "ended") terms.delete(id)
  if (closedEarlier().delete(id) || (t && closes(t))) keepClosed()
}

/** Terminal `id` ended (its backend tells, else its link here): the Inbox and the rest hear "terminal.ended", once. */
function exited(id: string, exit: { code: number; signal: number; lost?: boolean }) {
  if (terms.get(id)?.phase.state === "ended") return
  const p = apply(id, { type: "exit", code: exit.code, signal: exit.signal, lost: !!exit.lost })?.phase
  if (p?.state !== "ended") return
  // (what was kept of its state goes; how it ended stays, for a wait that comes after)
  for (const f of [stateFile(id), oscMark(id), ...Object.values(oldMetaFiles(id))]) try { fs.rmSync(f, { force: true }) } catch { /* none */ }
  metas.delete(id); held.delete(id)
  clearTimeout(told.get(id)?.timer)
  told.delete(id)
  // (onPurpose: the user ended it, End session or vau terminal end: the Inbox takes its row as dealt with)
  tell("terminal.ended", { id, code: p.code, signal: p.signal, ...(p.lost ? { lost: true } : {}), ...(p.by && !p.by.keep ? { onPurpose: true } : {}) })
  for (const fn of exitHeard) fn(id)
  listChanged()
}

/** Ends a session for good: its shell, not just this server's hold on it. `keep`: its tabs stay, saying it ended (an
 *  agent's handed session after its report). */
export function end(s: Session, keep = false) {
  apply(s.id, { type: "end", keep })
  void s.backend.kill(s.id).catch(() => {})
}
/** The same, for one this server holds no session of (a tab closed after a restart, vau terminal end). */
export async function endHere(b: Backend, id: string, keep = false) {
  apply(id, { type: "end", keep })
  await b.kill(id)
  if (!b.events) exited(id, { code: 0, signal: 1 })
}

/** What a backend tells as it happens: its programs' OSC 7501, terminals starting and ending, their meta. (A title is
 *  read with the next list: an agent's spinner retitles it many times a second.) */
export function onEvent(b: Backend, ev: BackendEvent) {
  // (what went wrong where the terminals are kept: a screen stuck, its loop blocked; in vau errors)
  if (ev.type === "trouble") { console.error(`terminal: ${b.label}'s terminal server${ev.id ? `, ${ev.id}` : ""}: ${ev.text}`); return }
  if (!TERMINAL_ID.test(ev.id) || ev.id.startsWith(SPARE)) return
  if (ev.type === "status") return oscSaid(ev.id, ev.said)
  if (ev.type === "exited") return exited(ev.id, ev.exit)
  if (ev.type === "title") return
  if (ev.type === "started") {
    sighted.add(ev.id)
    reopened(ev.id)
    const meta = ev.info?.meta ?? {}
    tell("terminal.started", { id: ev.id, agent: agentOf(ev.id)?.name ?? null, ...(ev.info?.command ? { command: ev.info.command } : {}), ...(meta.name ? { name: meta.name } : {}) })
  }
  if (ev.type === "meta" && b.setMeta) metas.set(ev.id, ev.meta)
  listChanged()
}

/** One shell, one size: the last device to send its own wins. Every device hears it, so one that's used again and
 * doesn't fit (the phone shrank it) sends its size back (Terminal.tsx: claim) and the program redraws for it. */
export function resize(s: Session, cols: number, rows: number, cell?: Cell) {
  const same = s.link.cols === cols && s.link.rows === rows
  if (same && (!cell || (cell.width === s.cell?.width && cell.height === s.cell?.height))) return
  if (cell) s.cell = cell
  s.link.resize(cols, rows, cell)
  if (same) return
  const msg = JSON.stringify({ t: "size", cols, rows })
  for (const ws of s.clients) if (ws.readyState === ws.OPEN) ws.send(msg)
}

export function attach(s: Session, ws: WebSocket, fresh: boolean) {
  flush(s) // (what came before it is in its picture or replay)
  s.clients.add(ws)
  listChanged()
  ws.send(JSON.stringify({ t: "attached", fresh, scrollback: scrollback(), ...(fresh ? { started: s.opened } : {}) }))
  ws.send(JSON.stringify({ t: "size", cols: s.link.cols, rows: s.link.rows }))
  if (s.blocked) ws.send(BLOCKED)
  // The screen and its history as they are now, then what it prints from there on.
  s.pending.add(ws)
  s.link.snapshot((picture) => {
    flush(s) // (what came before the picture is in it: not for this page)
    s.pending.delete(ws)
    if (!picture || ws.readyState !== ws.OPEN) return
    const bytes = Buffer.from(picture, "utf8")
    ws.send(bytes)
    sent(s, ws, bytes.length)
  })
  const uploads = new Map<string, string>()
  let pasted = Promise.resolve() // (each upload's path in the order they came, a slow conversion's too)
  ws.on("message", (data: RawData, binary: boolean) => {
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
    if (binary) {
      s.link.write(buf)
      // (a page's own answers to its terminal's questions aren't typing: a focus report, a DA)
      if (!buf.includes(27) || buf.length === 1) { lastInput.set(s.id, Date.now()); pageInput.set(s.id, Date.now()) }
      // Enter may have started a program (claude, vim): tabs show its name soon, not at the next poll.
      if (buf.includes(13)) setTimeout(listChanged, 400)
      return
    }
    let msg: { t?: string; cols?: number; rows?: number; cw?: number; ch?: number; id?: string; name?: string; data?: string; last?: boolean; lines?: number; n?: number }
    try { msg = JSON.parse(buf.toString("utf8")) } catch { return }
    if (msg.t === "resize") resize(s, clamp(msg.cols, 2, 1000, s.link.cols), clamp(msg.rows, 1, 500, s.link.rows),
      msg.cw && msg.ch ? { width: clamp(msg.cw, 1, 200, 8), height: clamp(msg.ch, 1, 200, 16) } : undefined)
    else if (msg.t === "ack" && Number.isSafeInteger(msg.n)) {
      s.owed.set(ws, Math.max(0, (s.owed.get(ws) ?? 0) - msg.n!))
      s.acks.add(ws)
      pace(s)
    }
    else if (msg.t === "close") end(s)
    else if (msg.t === "upload") {
      let file: string | null = null
      try { file = upload(s.id, uploads, msg) } catch (e) { console.error("terminal upload:", e); return }
      // (a HEIC photo, as phones paste screenshots, as a JPEG beside it, which agents can read; a WSL distro's shell is
      // given the path as it sees it)
      if (file) pasted = pasted.then(() => readableImage(file!)).then(async (f) => {
        const wsl = await inWsl(s)
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "uploaded", path: wsl ? wslPath(f) : f }))
      }).catch((e) => console.error("terminal upload:", e))
    }
  })
  ws.on("close", () => {
    for (const f of uploads.values()) fs.rmSync(f, { force: true }) // (cut off: never pasted)
    s.clients.delete(ws)
    s.pending.delete(ws)
    s.owed.delete(ws)
    if (s.acks.delete(ws)) pace(s)
    listChanged()
  })
}

/** Whether session `s` is a WSL distro's shell. */
async function inWsl(s: Session) {
  return WIN && (await s.backend.list().catch(() => [] as Shell[])).find((x) => x.id === s.id)?.process === "wsl"
}

