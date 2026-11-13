import fs from "node:fs"
import path from "node:path"
import { type AgentAsk, type AgentCommand, askLabel, type AgentHow, type AgentStart, type AgentState, agentName, agentSite, shellQuote } from "../../../core/agents.ts"
import { logger, serverUrl, span } from "../../../core/plugins.ts"
import type { AgentRun, Backend, Listed as Shell } from "./backend.ts"
import { psQuote, wslPath } from "./launch.ts"
import { gitBash, kindOf, progName, type ShellKind } from "./shells.ts"
import type { Kind, Said, SessionState } from "./osc7501.ts"
import { closes, fresh, label, moved, nowOf, step, type Event, type From as Source, type Now, type Term } from "./state.ts"
import type { Job } from "./starter.ts"
import { SPARE, STATES, TERMINAL_ID, TMP, WIN, plugin, shell } from "./shared.ts"
import { agentContext, agentOf, backendOf, backends, hooksFile, hooksText, oscMark, runsHere, stateFile, tell } from "./backends.ts"
import { closedEarlier, keepClosed, reopened } from "./start.ts"
import { byName, inFront, listChanged } from "./list.ts"

export const progressOf = (id: string): string | null => { try { const p: unknown = plugin.service("inbox:progress")?.(id); return typeof p === "string" ? p : null } catch { return null } }

/** A change of a terminal's state, as the service "inbox:state" hears it (`was`: the state told before). `msg` is the
 *  program's text: untrusted. */
export type StateChange = { terminal: string; agent: string; state: SessionState; kind?: Kind; msg?: string; from: Source; was?: SessionState; at: number }

export const terms = new Map<string, Term>()
export const sighted = new Set<string>()
export const current = (id: string) => { const t = terms.get(id); return t ? nowOf(t) : null }
export function endOf(id: string) {
  const t = terms.get(id), p = t?.phase
  return p?.state === "ended" ? { code: p.code, signal: p.signal, ...(p.lost ? { lost: true } : {}), at: t!.at } : null
}

export function apply(id: string, ev: Event, o: { quiet?: boolean } = {}): Term | null {
  if (!TERMINAL_ID.test(id) || id.startsWith(SPARE)) return null
  const was = terms.get(id) ?? fresh(agentOf(id)?.name ?? ""), t = step(was, ev, Date.now())
  if (t === was) return t
  terms.set(id, t)
  if (closes(t) !== closes(was)) keepClosed()
  if (terms.size > 500) {
    const old = [...terms].find(([k, x]) => k !== id && x.phase.state === "ended")?.[0] ?? terms.keys().next().value!
    if (closes(terms.get(old)!)) closedEarlier().add(old)
    terms.delete(old)
  }
  if (t.phase === was.phase) { if (t.starting !== was.starting) listChanged(); return t }
  listChanged()
  if (o.quiet) {
    const now = nowOf(t)
    if (now) told.set(id, { now, at: Date.now() })
    return t
  }
  if (moved(was.phase, t.phase)) log.info(`${id} ${label(was.phase)} -> ${label(t.phase)}`)
  for (const fn of stateHeard) fn(id)
  tellState(id)
  return t
}

export const told = new Map<string, { now: Now; at: number; timer?: ReturnType<typeof setTimeout> }>()
export const stateHeard = new Set<(id: string) => void>()
const STATE_GAP = 250, MSG_GAP = 2000, log = logger("terminal")

export const metas = new Map<string, Record<string, string>>()
const metaOf = (id: string) => metas.get(id) ?? {}
export const noteOf = (id: string): string | undefined => metaOf(id).note
export const nameOf = (id: string): string | undefined => metaOf(id).name
export async function setMeta(id: string, patch: Record<string, string | null>) {
  const next = { ...metaOf(id) }
  for (const [k, v] of Object.entries(patch)) if (v) next[k] = v; else delete next[k]
  metas.set(id, next)
  const b = await backendOf(id)
  if (b?.setMeta) await b.setMeta(id, patch)
  listChanged()
}
export const startedOn = (id: string, rel: string) => setMeta(id, { note: rel }).catch(() => {})
export const oldMetaFiles = (id: string) => ({ name: `${stateFile(id)}.name`, note: `${stateFile(id)}.note` })
export function oldMeta(b: Backend, x: Shell) {
  if (!b.setMeta || x.meta?.name || x.meta?.note) return
  const files = oldMetaFiles(x.id), patch: Record<string, string> = {}
  for (const [k, f] of Object.entries(files)) try { const v = fs.readFileSync(f, "utf8"); if (v) patch[k] = v } catch {}
  if (!Object.keys(patch).length) return
  x.meta = { ...x.meta, ...patch }
  void b.setMeta(x.id, patch).then(() => { for (const f of Object.values(files)) fs.rmSync(f, { force: true }) }, () => {})
}

function tellState(id: string) {
  const last = told.get(id)
  if (last?.timer) return
  const now = current(id)
  if (!now) return
  const gap = !last ? 0 : now.state !== last.now.state || now.kind !== last.now.kind ? STATE_GAP : now.msg !== last.now.msg ? MSG_GAP : -1
  if (gap < 0) return
  const wait = last ? last.at + gap - Date.now() : 0
  if (wait > 0) {
    told.set(id, { ...last!, timer: setTimeout(() => { told.set(id, { ...last!, timer: undefined }); tellState(id) }, wait) })
    return
  }
  told.set(id, { now, at: Date.now() })
  const change: StateChange = { terminal: id, ...now, ...(last ? { was: last.now.state } : {}), at: Date.now() }
  tell("terminal.state", { id, agent: now.agent, state: now.state, ...(now.kind ? { kind: now.kind } : {}), ...(now.msg ? { msg: now.msg } : {}), from: now.from })
  try { void Promise.resolve(plugin.service("inbox:state")?.(change)).catch((e) => log.error("inbox:state", e)) } catch (e) { log.error("inbox:state", e) }
}

export const held = new Map<string, Said>()
export function oscSaid(id: string, said: Said) {
  if (!TERMINAL_ID.test(id) || id.startsWith(SPARE)) return
  if (said.seen && !terms.get(id)?.osc?.seen) try { fs.mkdirSync(STATES, { recursive: true }); fs.writeFileSync(oscMark(id), "") } catch {}
  const st = said.status, agent = agentOf(id)?.name
  held.delete(id)
  if (st?.state !== "blocked" || st.kind || !agent) return apply(id, { type: "osc", said })
  held.set(id, said)
  void askShown(id, agent, said).finally(() => { if (held.get(id) !== said) return; held.delete(id); apply(id, { type: "osc", said }) })
}

async function askShown(id: string, agent: string, said: Said) {
  const asks = await asksOf(agent), b = await backendOf(id)
  if (!asks.length || !b) return
  for (let i = 0; i < 8 && held.get(id) === said; i++) {
    const hit = await askOn(b, id, asks)
    if (hit) { if (held.get(id) === said) apply(id, { type: "ask", ask: { id: hit.id, says: hit.says } }); return }
    await new Promise((r) => setTimeout(r, 200))
  }
}

function resetState(id: string) {
  for (const f of [stateFile(id), oscMark(id), ...Object.values(oldMetaFiles(id))]) try { fs.rmSync(f, { force: true }) } catch {}
  reopened(id)
  terms.delete(id); held.delete(id); metas.delete(id)
  clearTimeout(told.get(id)?.timer)
  told.delete(id)
  sighted.add(id)
}

export function agentReady(id: string, agent: string) {
  const timing = span("agent.ready", { agent }), until = Date.now() + 60_000
  apply(id, { type: "start" })
  setTimeout(() => apply(id, { type: "late" }), 60_000).unref?.()
  const look = () => {
    if (hooksText(id) === MISSING) return void agentMissing(id, agent)
    if (fs.existsSync(stateFile(id)) || terms.get(id)?.osc?.seen) return void timing.end()
    if (Date.now() < until) setTimeout(look, 50).unref?.()
  }
  look()
  void watchAsks(id, agent)
}

const asksOf = (agent: string) => plugin.ask<AgentAsk[]>(`agent-asks:${agent}`, []).catch((): AgentAsk[] => [])
export async function askOn(b: Pick<Backend, "capture">, id: string, asks: AgentAsk[]) {
  if (!asks.length) return null
  const most = Math.max(...asks.map((a) => a.lines ?? 12))
  const all = (await screenOf(b, id, most)).replace(/\s+$/, "").split("\n")
  return asks.find((a) => a.match.test(all.slice(-(a.lines ?? 12)).join("\n"))) ?? null
}

export async function watchAsks(id: string, agent: string) {
  if (watching.has(id)) return
  watching.add(id)
  try { await watchFor(id, agent) } finally { watching.delete(id) }
}
export const watching = new Set<string>()
async function watchFor(id: string, agent: string) {
  const asks = await asksOf(agent)
  if (!asks.length) return
  const said = () => { const t = terms.get(id); return !!t && (!!t.hooks || !!t.osc?.status) }
  for (let b = await backendOf(id); b && !said(); b = await backendOf(id)) {
    const hit = await askOn(b, id, asks)
    if (hit?.id !== terms.get(id)?.ask?.id) apply(id, { type: "ask", ask: hit ? { id: hit.id, says: hit.says } : null })
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (terms.get(id)?.ask) apply(id, { type: "ask", ask: null })
}

export async function askIn(id: string, agent = "") {
  const b = await backendOf(id), name = agentOf(id)?.name ?? agent
  return b && /^[\w-]{1,40}$/.test(name) ? { b, hit: await askOn(b, id, await asksOf(name)) } : { b, hit: null }
}

export function menuAt(screen: string, option: string): number | null {
  const lines = screen.replace(/\s+$/, "").split("\n").slice(-30).map((l) => l.replace(/^\s*│|│\s*$/g, ""))
  const chosen = lines.findLastIndex((l) => /^\s*[❯›]\s/.test(l))
  const at = lines.findLastIndex((l) => l.replace(/^\s*(?:[❯›]\s*)?(?:\d{1,2}\.\s+)?/, "").startsWith(option))
  return chosen < 0 || at < 0 || Math.abs(at - chosen) > 12 ? null : at - chosen
}
export async function choose(b: Backend, id: string, option: string) {
  let apart = menuAt(await screenOf(b, id, 40), option)
  for (let i = 0; i < 12 && apart !== null && apart !== 0; i++) {
    const was = apart
    await b.send(id, { text: apart > 0 ? "\x1b[B" : "\x1b[A" })
    for (let t = 0; t < 20 && apart === was; t++) { await new Promise((r) => setTimeout(r, 50)); apart = menuAt(await screenOf(b, id, 40), option) }
  }
  if (apart !== 0) return false
  await b.send(id, { text: "\r" })
  return true
}

/** The question terminal `id` shows on its screen (its agent's, or `agent`'s), as asked of the user: its words, its
 *  choices (approve's, then deny's). */
plugin.provide("terminal:ask", async (id: string, agent = "") => {
  const { hit } = TERMINAL_ID.test(id) ? await askIn(id, agent) : { hit: null }
  return hit ? { id: hit.id, says: hit.says, choices: [askLabel(hit, "approve"), askLabel(hit, "deny")] } : null
})
/** Whether terminal `id` waits on the user now: a question on its screen, or its state says so. */
plugin.provide("terminal:waits", async (id: string, agent = "") => !!(await askIn(id, agent)).hit || current(id)?.state === "blocked")
/** Terminal `id`'s state now (StateChange without its time), or null when nothing says. */
plugin.provide("terminal:state", (id: string) => (TERMINAL_ID.test(id) ? current(id) : null))
/** How terminal `id` ended (its exit code, signal; `lost`: unknown), while it's kept here; null while it runs. */
plugin.provide("terminal:ended", (id: string) => (TERMINAL_ID.test(id) ? endOf(id) : null))
/** Agent terminal `id`'s agent says it waits on the user (`kind`: a permission or a question), or no longer (null). */
plugin.provide("terminal:agent-waits", (id: string, kind: Kind | null) => {
  if (!TERMINAL_ID.test(id) || (kind !== null && kind !== "permission" && kind !== "question") || (terms.get(id)?.waits ?? null) === kind) return
  apply(id, { type: "waits", kind })
})
export const screenOf = (b: Pick<Backend, "capture">, id: string, lines: number) => b.capture(id, { format: "text", lines }).then((c) => c.text, () => "")
/** Terminal `id`'s last `lines` lines as text, or "" when it isn't running here. */
plugin.provide("terminal:screen", async (id: string, lines = 40) => {
  const b = TERMINAL_ID.test(id) ? await backendOf(id) : null
  return b ? screenOf(b, id, Math.min(Math.max(1, Math.trunc(lines) || 40), 200)) : ""
})

let hooksWatch: fs.FSWatcher | null = null
try {
  fs.mkdirSync(STATES, { recursive: true })
  hooksWatch = fs.watch(STATES, (_e, name) => {
    const id = String(name ?? "")
    if (TERMINAL_ID.test(id)) void runsHere(id).then((here) => here && apply(id, { type: "hooks", ...hooksFile(id) }))
  })
  hooksWatch.on("error", () => {})
} catch (e) { log.error("can't watch the agents' state files", e) }
plugin.onUnload(() => hooksWatch?.close())

export const FRONT_AGE = 1000
export function frontSeen(b: Backend, id: string, program: boolean, seen: number) {
  // (Windows has no foreground groups, only a guess by the newest child: seeing none there never ends an agent's turn)
  if (WIN && !program) return
  const had = terms.get(id)?.osc?.status
  apply(id, { type: "front", program, seen })
  if (had && !terms.get(id)?.osc?.status) void b.dropStatus?.(id)
}
export function sight(x: Shell) {
  const p = terms.get(x.id)?.phase
  if (p?.state === "ended" && p.lost) terms.delete(x.id)
  if (!sighted.has(x.id)) {
    sighted.add(x.id)
    if (sighted.size > 2000) sighted.delete(sighted.values().next().value!)
    apply(x.id, { type: "seen", osc: x.said ?? null, hooks: hooksText(x.id) }, { quiet: true })
  }
  if (x.state !== undefined) apply(x.id, { type: "backend", state: x.state })
}

const LOOK = 2000
let looked = false, looking = false
async function lookAtBusy() {
  const busy = (id: string) => { const s = terms.get(id)?.phase.state; return s === "working" || s === "blocked" }
  if (looking || (looked && ![...terms.keys()].some(busy))) return
  looking = true
  try {
    const seen = Date.now() - FRONT_AGE
    for (const b of backends()) {
      for (const x of (await b.list().catch((): Shell[] => [])).map(byName)) {
        if (x.spare || x.id.startsWith(SPARE)) continue
        sight(x)
        if (busy(x.id)) frontSeen(b, x.id, (await inFront(x)) !== null, seen)
      }
    }
    looked = true
  } finally { looking = false }
}
const looker = setInterval(() => void lookAtBusy(), LOOK)
looker.unref?.()
plugin.onUnload(() => clearInterval(looker))

const MISSING = "missing"
export function markMissing(command: string, file: string, sh = shell(), say = "") {
  const mark = `${say ? `printf '\\n%s\\n' ${shellQuote(say)}; ` : ""}printf %s ${MISSING} > ${shellQuote(file)} 2>/dev/null`
  return progName(sh) === "fish" ? `${command}; if test $status -eq 127; ${mark}; end` : `${command}; if [ $? -eq 127 ]; then ${mark}; fi`
}
export function missingText(agent: string) {
  const name = agentName(agent) ?? agent, site = agentSite(agent)
  return site ? `${name} isn't installed on this machine. Get it at ${site}, then open it again.` : `${name} isn't installed on this machine: install it, then open it again.`
}

function agentMissing(id: string, agent: string) {
  tell("terminal.agent-missing", { id, agent })
  const site = agentSite(agent)
  void plugin.runOp("ui.notify", { text: `${agentName(agent) ?? agent} isn't installed on this machine`, error: true, terminal: id, ...(site ? { actionOpen: site } : {}) }).catch(() => {})
}

export function stateCommand(file: string, osc?: string | null) {
  const mark = (s: AgentState, kind?: string | null) => `printf %s ${kind && s === "waiting" ? `${s}:${kind}` : s} > ${shellQuote(file)} 2>/dev/null || true`
  return osc ? (s: AgentState, kind?: string | null) => `[ -e ${shellQuote(osc)} ] || { ${mark(s, kind)}; }` : mark
}

const stateUrl = (id: string, s: AgentState, kind?: string | null) =>
  `${serverUrl()}/api/terminals/${encodeURIComponent(id)}/state?s=${s}${kind && s === "waiting" ? `&kind=${kind}` : ""}`
/** Windows' curl.exe, in System32 since Windows 10. */
const curlPost = (url: string) => [path.join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe"), "-s", "-m", "2", "-o", "NUL", "-X", "POST", url]

export async function agentRun(id: string, prompt: string | null, dark: boolean | null, how: AgentHow, sh: string): Promise<AgentRun | null> {
  const a = agentOf(id)
  if (!a) return null
  try { fs.mkdirSync(STATES, { recursive: true }); resetState(id) } catch {}
  const kind = kindOf(sh), native = kind === "pwsh" || kind === "cmd"
  // (paths in a POSIX line as its shell reads them: WSL's own, Git Bash's C:/x)
  const there = kind === "wsl" ? wslPath : WIN ? (p: string) => p.replace(/\\/g, "/") : (p: string) => p
  const set = native ? null : stateCommand(there(stateFile(id)), there(oscMark(id)))
  try {
    const report = plugin.service("activity:report"), reportUrl = plugin.service("activity:report-url")
    const url = reportUrl ? String(reportUrl(a.name, id)) : null
    const run: AgentCommand | null = await plugin.service(`agent:${a.name}`)!({ resume: a.resume, context: agentContext(), state: set,
      report: native ? null : kind === "wsl" ? (url ? `${curlPost(url).map((x, i) => (i ? shellQuote(x) : "curl.exe")).join(" ")} -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true` : null)
        : report ? report(a.name, id) : null,
      ...(native ? { stateHook: (s: AgentState, k?: string | null) => ({ url: stateUrl(id, s, k), argv: curlPost(stateUrl(id, s, k)) }), reportUrl: url } : {}),
      ...(kind === "wsl" ? { wsl: true } : {}),
      profile: a.profile, prompt, dark, ...how } satisfies AgentStart)
    if (!run || typeof run.command !== "string" || !run.command) return null
    let cwd = typeof run.cwd === "string" && run.cwd ? run.cwd : how.cwd || null
    try { if (cwd && !fs.statSync(cwd).isDirectory()) cwd = null } catch { cwd = null }
    if (!native) return { command: markMissing(run.command, there(stateFile(id)), kind === "wsl" ? "sh" : sh, missingText(a.name)), cwd }
    const bash = Array.isArray(run.argv) && run.argv.length ? null : gitBash()
    const argv = bash ? [bash, "-l", "-c", markMissing(run.command, stateFile(id).replace(/\\/g, "/"), bash, missingText(a.name))] : run.argv
    if (!argv?.length) return { command: run.command, cwd }
    return { command: starterLine(id, { argv, env: run.env ?? {}, cwd, state: stateFile(id) }, kind), cwd }
  } catch {
    return null
  }
}

function starterLine(id: string, job: Job, kind: ShellKind) {
  fs.mkdirSync(TMP, { recursive: true })
  const file = path.join(TMP, `run-${id}.json`)
  fs.writeFileSync(file, JSON.stringify(job), { mode: 0o600 })
  const words = [process.execPath, path.join(plugin.dir, "starter.ts"), file], electron = !!process.versions.electron
  if (kind === "pwsh") return [electron && "$env:ELECTRON_RUN_AS_NODE = '1'", `& ${words.map(psQuote).join(" ")}`, electron && "Remove-Item Env:ELECTRON_RUN_AS_NODE"].filter(Boolean).join("; ")
  return [electron && 'set "ELECTRON_RUN_AS_NODE=1"', words.map((w) => `"${w}"`).join(" "), electron && 'set "ELECTRON_RUN_AS_NODE="'].filter(Boolean).join(" & ")
}

export function savedDark(): boolean | null {
  const t: unknown = plugin.vault.configWithDefaults("appearance")?.theme
  return t === "dark" ? true : t === "light" ? false : null
}

/** The vault's folder, as the shell sees it (resolved: iCloud's folder is a link). */
export function vaultDir() {
  try { return fs.realpathSync(plugin.vault.path) } catch { return plugin.vault.path }
}

