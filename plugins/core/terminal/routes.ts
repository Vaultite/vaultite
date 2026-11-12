import fs from "node:fs"
import path from "node:path"
import { agentModel, MODEL_NAME, PERMISSION_MODES } from "../../../core/agents.ts"
import { HTTPError, type Request, NOT_THE_USER, userSurface, whoOf } from "../../../core/plugins.ts"
import { asPaste, type CaptureFormat, type Ended, unmarked, type Backend, type Listed as Shell } from "./backend.ts"
import { defaultShell, progName, shellsHere } from "./shells.ts"
import { nowOf, type Now } from "./state.ts"
import { STATES, TERMINAL_ID, clamp, plugin, scrollback, sessions } from "./shared.ts"
import { LOCAL, agentContext, agentOf, backendForNew, backendOf, backends, fallback, findShell, homeOf, oscMark, runsHere, stateFile } from "./backends.ts"
import { askIn, choose, current, endOf, savedDark, screenOf, setMeta, stateHeard, terms } from "./terms.ts"
import { end, endHere, start } from "./start.ts"
import { starting } from "./machines.ts"
import { listChanged, localList } from "./list.ts"

const cleanName = (s: string) => s.replace(/[\s\p{Cc}]+/gu, " ").trim().slice(0, 80)

export const lastInput = new Map<string, number>()
export const pageInput = new Map<string, number>()
type Sent = { at: number; by: string; text?: string; keys?: string[] }
const inputs = new Map<string, Sent[]>()
function typed(id: string, sent?: Omit<Sent, "at">) {
  lastInput.set(id, Date.now())
  if (sent) {
    const log = inputs.get(id) ?? []
    log.push({ at: Date.now(), ...sent, ...(sent.text ? { text: sent.text.length > 500 ? `${sent.text.slice(0, 500)}…` : sent.text } : {}) })
    inputs.set(id, log.slice(-20))
  }
  setTimeout(listChanged, 400)
}
/** How long typed text needs before its Enter: an agent takes a long text as a paste, and an Enter inside that is a new line. */
const settle = (text: string) => Math.min(1000, 150 + Math.floor(text.length / 4))
async function sendText(b: Backend, id: string, text: string, enter: boolean, by = "app") {
  if (text) await b.send(id, { text, paste: asPaste(text) })
  if (enter) {
    if (text) await new Promise((r) => setTimeout(r, settle(text)))
    await b.send(id, { keys: ["Enter"] })
  }
  typed(id, { by, ...(text ? { text } : {}), ...(enter ? { keys: ["Enter"] } : {}) })
}

const WAITS = new Set(["exit", "idle", "working", "blocked", "done", "error", "quiet"])
const MAX_WAIT = 3600

async function endedList() {
  const all = await Promise.all(backends().map(async (b) => (await b.list({ ended: true }).catch((): Shell[] => [])).filter((x) => x.exit).map((x) => ({ b, x }))))
  return all.flat().sort((a, b) => a.x.exit!.at - b.x.exit!.at).map(({ b, x }) => ({ id: x.id, backend: b.name, command: x.command ?? "", ...(x.meta?.name ? { name: x.meta.name } : {}),
    ...(x.meta?.note ? { note: x.meta.note } : {}), started: x.created, exit: x.exit! }))
}
async function endedOf(id: string): Promise<{ b: Backend; exit: Ended } | null> {
  for (const b of backends()) {
    const x = (await b.list({ ended: true }).catch((): Shell[] => [])).find((y) => y.id === id && y.exit)
    if (x) return { b, exit: x.exit! }
  }
  const e = endOf(id)
  return e ? { b: fallback, exit: e } : null
}

async function waitFor(id: string, wants: string[], o: { ms: number; quiet: number; abort: AbortSignal; match?: RegExp; hold?: number }) {
  const want = new Set(wants.length ? wants : o.match ? [] : agentOf(id) || current(id) ? ["idle", "blocked", "done", "error"] : ["exit"])
  if (o.match) want.add("match")
  // An agent at rest for a moment between steps of one turn isn't done: idle and done count once they've held.
  const hold = o.hold ?? 1500
  const since = Date.now()
  const result = (met: string | null, exit?: { code: number; signal: number; lost?: boolean } | null, matched?: string) => {
    const now = current(id)
    return { met, ...(matched !== undefined ? { matched } : {}), timedOut: met === null && !o.abort.aborted, waited: Math.round((Date.now() - since) / 100) / 10, for: [...want],
      ...(now ? { state: now.state, ...(now.kind ? { kind: now.kind } : {}), ...(now.msg ? { msg: now.msg } : {}) } : {}), ...(exit ? { exit } : {}) }
  }
  const gone = async () => {
    const told = endOf(id)
    if (!told && (await backendOf(id))) return null
    const e = told ?? (await endedOf(id))?.exit
    return e ? { code: e.code, signal: e.signal, ...(e.lost ? { lost: true } : {}) } : { code: -1, signal: 0 }
  }
  const stateMet = () => {
    const t = terms.get(id), now = t ? nowOf(t) : null, at = t?.at ?? 0
    if (!now || !want.has(now.state) || at < (lastInput.get(id) ?? 0)) return null
    return (now.state === "idle" || now.state === "done") && Date.now() - at < hold ? null : now.state
  }
  if (!(await backendOf(id)) && !(await endedOf(id))) throw new HTTPError(404, noTerminal(id))
  return await new Promise<ReturnType<typeof result>>((resolve) => {
    let over = false
    const finish = (r: ReturnType<typeof result>) => {
      if (over) return
      over = true
      clearTimeout(timer); clearInterval(poll); stateHeard.delete(heard); exitHeard.delete(onExit); o.abort.removeEventListener("abort", stop)
      resolve(r)
    }
    const check = async () => {
      const exit = await gone()
      if (exit) return finish(result(want.has("exit") ? "exit" : null, exit))
      const s = stateMet()
      if (s) return finish(result(s))
      if (o.match) {
        const b = await backendOf(id), text = b ? await screenOf(b, id, 200) : ""
        const hit = o.match.exec(text)
        if (hit) return finish(result("match", null, hit[0].slice(0, 500)))
      }
      if (want.has("quiet")) {
        const x = (await findShell(id))?.x, last = Math.max(x?.activity ?? 0, lastInput.get(id) ?? 0, since)
        if (Date.now() - last >= o.quiet) finish(result("quiet"))
      }
    }
    const heard = (x: string) => { if (x === id) void check() }
    const onExit = (x: string) => { if (x === id) void check() }
    const stop = () => finish(result(null))
    const timer = setTimeout(stop, o.ms)
    const poll = setInterval(() => void check(), want.has("quiet") ? Math.min(1000, o.quiet / 2) : o.match || hold < 1000 ? 500 : 1000)
    stateHeard.add(heard)
    exitHeard.add(onExit)
    o.abort.addEventListener("abort", stop)
    void check()
  })
}
export const exitHeard = new Set<(id: string) => void>()
/** terminal.wait for this server's plugins (the service "terminal:wait"), `signal` ending it early (met null). */
plugin.provide("terminal:wait", (id: string, o: { for?: string[]; timeout?: number; quiet?: number; hold?: number; signal?: AbortSignal } = {}) =>
  waitFor(id, (o.for ?? []).filter((w) => WAITS.has(w)), { ms: Math.min(MAX_WAIT, o.timeout ?? 300) * 1000, quiet: (o.quiet ?? 2) * 1000,
    abort: o.signal ?? new AbortController().signal, ...(o.hold !== undefined ? { hold: o.hold * 1000 } : {}) }))

async function owner(req: Request) {
  await plugin.ownerOnly(req, "the terminal")
}
function localId(req: Request) {
  const id = req.arg(0)
  if (!TERMINAL_ID.test(id)) throw new HTTPError(400, "a terminal id is letters, digits, - and _")
  if (id.includes("@")) throw new HTTPError(400, `${id} is another machine's: ask that machine's server (vau --url <its address>)`)
  return id
}
async function mustRun(id: string): Promise<Backend> {
  const b = await backendOf(id)
  if (!b) throw new HTTPError(404, noTerminal(id, "terminal session"))
  return b
}

// An agent's hooks marking its state where they can't run a shell line (Windows: AgentStart's stateHook), as
// stateCommand does: nothing once it speaks OSC 7501.
plugin.route("POST", "terminals/*/state", async (req) => {
  await owner(req)
  const id = localId(req), st = req.query.s, kind = req.query.kind
  if (st !== "working" && st !== "waiting" && st !== "idle") throw new HTTPError(400, "s: working, waiting or idle")
  if (fs.existsSync(oscMark(id))) return {}
  fs.mkdirSync(STATES, { recursive: true })
  fs.writeFileSync(stateFile(id), st === "waiting" && (kind === "permission" || kind === "question") ? `${st}:${kind}` : st)
  return {}
}, { lock: false, sync: false })

plugin.route("GET", "terminals/shells", async (req) => {
  await owner(req)
  const all = await shellsHere(), dflt = defaultShell()
  const name = all.find((x) => x.shell === dflt)?.label ?? progName(dflt)
  return { choices: [{ value: "", label: `Default (${name})` }, ...all.map((x) => ({ value: x.shell, label: x.label }))] }
})

plugin.route("GET", "terminals/instructions", () => ({ text: agentContext() }))

/** Why terminals here can't be reached now (their server not answering: frozen, missing from lists), or null. */
plugin.provide("terminal:trouble", () => backends().map((b) => b.trouble?.()).find(Boolean)?.text ?? null)
const noTerminal = (id: string, what = "terminal") => {
  const t = backends().map((b) => b.trouble?.()).find(Boolean)
  return `there's no ${what} '${id}' (vau terminal lists them)${t ? `, unless ${t.text}` : ""}`
}

plugin.route("GET", "terminals/sessions", async (req) => {
  await owner(req)
  const trouble = backends().map((b) => b.trouble?.()).find(Boolean)
  return { sessions: await localList(), backend: (await backendForNew()).name, ...(starting.size ? { starting: [...starting.keys()] } : {}), ...(req.query.ended ? { ended: await endedList() } : {}),
    ...(trouble ? { trouble } : {}) }
})

plugin.route("GET", "terminals/*/capture", async (req) => {
  await owner(req)
  const id = localId(req)
  const format: CaptureFormat = req.query.format === "vt" || req.query.format === "html" ? req.query.format : "text"
  const lines = req.query.lines === "all" ? null : req.query.lines ? clamp(req.query.lines, 1, scrollback() + 500, 50) : undefined
  const b = (await backendOf(id)) ?? (await endedOf(id))?.b
  if (!b) throw new HTTPError(404, noTerminal(id))
  const c = await b.capture(id, { format, lines }).catch((e: Error) => { throw new HTTPError(409, e.message) })
  return { id, format, ...c }
})

plugin.route("POST", "terminals/*", async (req) => {
  await owner(req)
  const id = localId(req)
  if (await runsHere(id)) return { id, started: false }
  const prompt = typeof req.body?.prompt === "string" && req.body.prompt.trim() ? req.body.prompt : null
  const allow = Array.isArray(req.body?.allow) ? req.body.allow.filter((a: unknown): a is string => typeof a === "string" && /^[\w .:/-]+$/.test(a)) : null
  const word = (v: unknown) => (typeof v === "string" && MODEL_NAME.test(v) ? v : null)
  const mode = PERMISSION_MODES.find((m) => m === req.body?.mode) ?? null
  const cwd = typeof req.body?.cwd === "string" && path.isAbsolute(req.body.cwd) ? req.body.cwd : null
  if (cwd && !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new HTTPError(404, `there's no folder ${cwd}`)
  const command = typeof req.body?.command === "string" && req.body.command.trim() ? req.body.command.trim() : undefined
  const name = typeof req.body?.name === "string" ? cleanName(req.body.name) : ""
  if (command && agentOf(id)) throw new HTTPError(400, "a terminal runs an agent or a command, not both")
  const cols = clamp(req.body?.cols, 2, 1000, 120), rows = clamp(req.body?.rows, 1, 500, 40), home = homeOf(req.body?.home)
  const said = typeof req.body?.model === "string" ? req.body.model : "", agent = agentOf(id)?.name
  const model = said.trim() && agent ? (await agentModel(plugin, agent, said)).id : word(said)
  if (!starting.has(id)) starting.set(id, start(id, cols, rows, LOCAL, prompt, savedDark(), { allow, model: model || null, effort: word(req.body?.effort), mode, cwd },
    { command, ...(name ? { name } : {}), ...(home ? { home } : {}) })
    .finally(() => starting.delete(id)))
  try { await starting.get(id)! } catch (e) {
    const ended = command ? await endedOf(id) : null
    if (!ended) throw e
    return { id, started: true, agent: null, exit: ended.exit }
  }
  return { id, started: true, agent: agentOf(id)?.name ?? null }
}, { lock: false })

plugin.route("POST", "terminals/*/name", async (req) => {
  await owner(req)
  const id = localId(req)
  await mustRun(id)
  const name = typeof req.body?.name === "string" ? cleanName(req.body.name) : ""
  await setMeta(id, { name: name || null })
  return { id, name: name || null }
}, { lock: false })

plugin.route("POST", "terminals/*/answer", async (req) => {
  await owner(req)
  const h = (k: string) => { const v = req.http?.headers[k]; return typeof v === "string" ? v : null }
  if (req.http && !userSurface(whoOf(h("x-vaultite-client"), h("x-vaultite-agent")))) throw new HTTPError(403, NOT_THE_USER)
  const id = localId(req), answer: unknown = req.body?.answer
  if (answer !== "approve" && answer !== "deny") throw new HTTPError(400, "answer: approve or deny")
  await mustRun(id)
  const { b, hit } = await askIn(id, typeof req.body?.agent === "string" ? req.body.agent : "")
  if (!b || !hit) throw new HTTPError(409, "its terminal isn't asking anything now")
  const how = hit[answer]
  if (!Array.isArray(how)) { if (!(await choose(b, id, how.option))) throw new HTTPError(409, `its menu's cursor can't be brought to "${how.option}": open its terminal`) }
  else for (const [i, k] of how.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 150))
    await b.send(id, { text: k })
  }
  typed(id, { by: "the user", text: `${answer} (${hit.id})` })
  return { id, ask: hit.id, answer }
}, { lock: false })

plugin.route("GET", "terminals/*/inputs", async (req) => {
  await owner(req)
  const id = localId(req)
  return { id, inputs: inputs.get(id) ?? [] }
})

plugin.route("POST", "terminals/*/send", async (req) => {
  await owner(req)
  const id = localId(req)
  const b = await mustRun(id)
  const keys: string[] = Array.isArray(req.body?.keys) ? req.body.keys.map(String).filter(Boolean) : []
  const by = typeof req.http?.headers["x-vaultite-agent"] === "string" ? req.http.headers["x-vaultite-agent"] : String(req.http?.headers["x-vaultite-client"] ?? "app")
  if (keys.length) {
    await b.send(id, { keys }).catch((e: Error) => { throw new HTTPError(400, e.message) })
    typed(id, { by, keys })
    return { id, keys }
  }
  const text = typeof req.body?.text === "string" ? unmarked(req.body.text) : ""
  const enter = req.body?.enter !== false
  if (!text && !enter) throw new HTTPError(400, "send needs a text (or enter)")
  const before = current(id), since = Date.now()
  await sendText(b, id, text, enter, by)
  return { id, sent: text.length, enter, ...(req.body?.confirm && enter && text && (agentOf(id) || before) ? await submitted(b, id, text, before, since) : {}) }
}, { lock: false })

async function submitted(b: Backend, id: string, text: string, before: Now | null, since: number): Promise<{ submitted: boolean | null; why?: string }> {
  if (before?.state === "blocked") return { submitted: false, why: `it was waiting on the user${before.kind ? ` (${before.kind}${before.msg ? `: ${before.msg}` : ""})` : ""}: what you typed went to that` }
  for (const until = Date.now() + 6000; Date.now() < until; await new Promise((r) => setTimeout(r, 200))) {
    const t = terms.get(id), now = t ? nowOf(t) : null
    if (now && t!.at >= since && now.state !== "idle") return { submitted: true }
  }
  const c = await b.capture(id, { format: "text", lines: 8 }).catch(() => null)
  const squash = (s: string) => s.replace(/\s+/g, "")
  if (c && squash(c.input?.typed ?? c.text.split("\n").slice(-4).join("")).includes(squash(text).slice(-24))) {
    return { submitted: false, why: "its input still shows the text: the Enter didn't take (vim mode, a survey or a dialog over it?): look with vau terminal capture" }
  }
  return { submitted: null, why: "it didn't say it started working on it (vau terminal capture shows its screen)" }
}

plugin.route("POST", "terminals/*/wait", async (req) => {
  await owner(req)
  const id = localId(req)
  const wants: string[] = (Array.isArray(req.body?.for) ? req.body.for : String(req.body?.for ?? "").split(",")).map((x: unknown) => String(x).trim()).filter(Boolean)
  const bad = wants.find((w) => !WAITS.has(w))
  if (bad) throw new HTTPError(400, `\`for\` is exit, ${[...WAITS].filter((w) => w !== "exit").join(", ")}: not '${bad}'`)
  const timeout = Math.max(0, Math.min(MAX_WAIT, Number(req.body?.timeout ?? 300) || 0))
  const quiet = Math.max(0.2, Math.min(600, Number(req.body?.quiet ?? 2) || 2))
  let match: RegExp | undefined
  if (typeof req.body?.match === "string" && req.body.match) {
    try { match = new RegExp(req.body.match, "m") } catch (e) { throw new HTTPError(400, `\`match\` isn't a pattern: ${(e as Error).message}`) }
  }
  const hold = req.body?.hold === undefined ? undefined : Math.max(0, Math.min(60, Number(req.body.hold) || 0)) * 1000
  const abort = new AbortController(), sock = req.http?.socket, gone = () => abort.abort()
  sock?.once("close", gone)
  try { return { id, ...await waitFor(id, wants, { ms: timeout * 1000, quiet: quiet * 1000, abort: abort.signal, match, hold }) } } finally { sock?.off("close", gone) }
}, { lock: false })

plugin.route("DELETE", "terminals/*", async (req) => {
  await owner(req)
  const id = localId(req)
  const b = await mustRun(id)
  const s = sessions.get(id), keep = req.query.keep === "1"
  if (s) end(s, keep)
  else await endHere(b, id, keep)
  listChanged()
  return { id, ended: true }
}, { lock: false })
