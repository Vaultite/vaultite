// Vault plugins without server code: a manifest's `ops`, `events`, `startup` and `schedule` are commands run on this
// machine (argv, no shell; format: core/docs/vault-plugins.md). Same trust as plugin.ts: nothing runs while it's off.
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { matching, typeMatches, type VaultEvent } from "./events.ts"
import { ID, type Op, OpError, opProblems, type Param, whoOf } from "./ops.ts"
import { LOCAL, type Plugin, ROOT, serverUrl, vaultHere } from "./plugins.ts"
import { hashed, inside } from "./rules.ts"
import { type Job, whenProblems } from "./schedule.ts"
import type { Item, Vault } from "./vault.ts"

export type Command = string[]
type Declared = { id: string; dir: string; manifest: Item }
/** One run of a command, as `vault-plugin.log` shows it. */
export type Run = { t: string; what: string; command: string[]; exit: number | null; signal: string | null; ms: number; stderr: string; error?: string }

const OP_TIMEOUT = 60, HOOK_TIMEOUT = 120, MAX_TIMEOUT = 600
const PER_MINUTE = 30, KEEP = 50, MAX_OUT = 4 << 20

// ---------- checking a manifest ----------

/** What's wrong with a command: an argv array of strings, its program a name on PATH, an absolute path, or a path in
 *  the plugin's folder. */
function commandProblems(c: unknown, dir: string, where: string): string[] {
  if (!Array.isArray(c) || !c.length || !c.every((x) => typeof x === "string" && x.length && !x.includes("\0"))) {
    return [`${where}: command must be an argv array of strings, like ["node", "run.mjs"] (no shell)`]
  }
  const prog = c[0] as string
  // (a script it hands a program, node's .hidden/run.mjs, is part of the approved version too)
  const unhashed = (c as string[]).slice(1).find((a) => !path.isAbsolute(a) && fs.existsSync(path.resolve(dir, a)) && inside(dir, path.resolve(dir, a)) && !hashed(dir, path.resolve(dir, a)))
  if (unhashed) return [`${where}: '${unhashed}' is hidden or in node_modules (not part of the plugin's version, so this machine couldn't approve it)`]
  if (path.isAbsolute(prog) || !prog.includes("/")) return []
  const abs = path.resolve(dir, prog)
  if (abs !== dir && !abs.startsWith(dir + path.sep)) return [`${where}: '${prog}' is outside the plugin's folder`]
  if (!hashed(dir, abs)) return [`${where}: '${prog}' is hidden or in node_modules (not part of the plugin's version, so this machine couldn't approve it)`]
  if (!fs.existsSync(abs)) return [`${where}: '${prog}' isn't in the plugin's folder`]
  return []
}

const timeoutProblems = (t: unknown, where: string) =>
  t === undefined || (typeof t === "number" && t > 0 && t <= MAX_TIMEOUT) ? [] : [`${where}: timeout is seconds, at most ${MAX_TIMEOUT}`]

/** An op's id is in its plugin's area: its first part is the plugin's id, or its singular (`habit.add` for "habits",
 *  `property.retype` for "properties"), or a type or collection of a kind it owns. */
export function inArea(opId: string, pluginId: string, kinds: string[] = []) {
  const area = opId.split(".")[0]
  return area === pluginId || area === pluginId.replace(/ies$/, "y") || area === pluginId.replace(/s$/, "") || kinds.includes(area)
}

/** A manifest's `schedule` entry's name: its own, else its op's, else its place. */
const jobName = (s: Item, i: number) => (typeof s.name === "string" ? s.name : typeof s.op === "string" ? s.op : `schedule-${i}`)

/** What's wrong with a manifest's `ops`, `events`, `startup` and `schedule` (core/vaultplugins.ts refuses to load it; `node
 *  tools/check_plugins.ts <vault>` prints them). */
export function hookProblems(m: Item, dir: string, where = "manifest.json"): string[] {
  const out: string[] = []
  const id = String(m.id ?? path.basename(dir))
  const list = (k: string) => {
    if (m[k] === undefined) return []
    if (!Array.isArray(m[k])) { out.push(`${where}: ${k} must be a list`); return [] }
    return m[k] as unknown[]
  }
  const seen = new Set<string>()
  list("ops").forEach((o, i) => {
    const at = `${where}: ops[${i}]`
    if (!o || typeof o !== "object") return void out.push(`${at} must be an object`)
    const op = o as Item
    const known = new Set(["id", "summary", "help", "kind", "params", "args", "cli", "mcp", "owner", "command", "timeout", "result", "action"])
    for (const k of Object.keys(op)) if (!known.has(k)) out.push(`${at}: '${k}' isn't a key of an op (${[...known].join(", ")})`)
    if (op.params !== undefined && (!op.params || typeof op.params !== "object" || Array.isArray(op.params))) out.push(`${at}: params is an object of parameters`)
    if (op.args !== undefined && (!Array.isArray(op.args) || !op.args.every((a: unknown) => typeof a === "string"))) out.push(`${at}: args is a list of parameter names`)
    if (op.mcp !== undefined && typeof op.mcp !== "boolean" && typeof op.mcp !== "string") out.push(`${at}: mcp is true or a tool name`)
    if (op.action !== undefined && (!op.action || typeof op.action !== "object" || Array.isArray(op.action))) out.push(`${at}: action is an object ({"on": ["person"], "param": "person", "from": "name", "label": "..."})`)
    if (op.owner !== undefined && (typeof op.owner !== "string" || !op.owner.trim())) out.push(`${at}: owner names what only this machine's owner may do ("the backup")`)
    out.push(...opProblems({ ...op, run: () => null } as unknown as Op).map((p) => `${at}: ${p}`))
    if (typeof op.id === "string") {
      if (!inArea(op.id, id)) out.push(`${at}: '${op.id}' should start with '${id}.' (a plugin's ops are in its own area)`)
      if (seen.has(op.id)) out.push(`${at}: '${op.id}' is there twice`)
      seen.add(op.id)
    }
    out.push(...commandProblems(op.command, dir, at), ...timeoutProblems(op.timeout, at))
  })
  list("events").forEach((h, i) => {
    const at = `${where}: events[${i}]`
    if (!h || typeof h !== "object") return void out.push(`${at} must be an object`)
    const e = h as Item
    if (typeof e.on !== "string" || !/^([a-z][a-z0-9-]*)(\.([a-z][a-z0-9-]*|\*))*$/.test(e.on)) out.push(`${at}: on is an event type or area (file.changed, op.done, file)`)
    if (e.path !== undefined && typeof e.path !== "string") out.push(`${at}: path is a vault path prefix`)
    out.push(...commandProblems(e.command, dir, at), ...timeoutProblems(e.timeout, at))
  })
  list("startup").forEach((h, i) => {
    const at = `${where}: startup[${i}]`
    if (!h || typeof h !== "object" || Array.isArray(h)) return void out.push(`${at} must be {"command": [...]}`)
    out.push(...commandProblems((h as Item).command, dir, at), ...timeoutProblems((h as Item).timeout, at))
  })
  const names = new Set<string>()
  list("schedule").forEach((h, i) => {
    const at = `${where}: schedule[${i}]`
    if (!h || typeof h !== "object" || Array.isArray(h)) return void out.push(`${at} must be {"every": "1h", "command": [...]} or {"every": "1h", "op": "...", "params": {...}}`)
    const s = h as Item
    const known = new Set(["name", "every", "at", "machine", "command", "op", "params", "timeout"])
    for (const k of Object.keys(s)) if (!known.has(k)) out.push(`${at}: '${k}' isn't a key of a schedule (${[...known].join(", ")})`)
    if (s.name !== undefined && (typeof s.name !== "string" || !/^[a-z0-9][a-z0-9.-]*$/.test(s.name))) out.push(`${at}: name is lowercase letters, digits, . and -`)
    if (names.has(jobName(s, i))) out.push(`${at}: '${jobName(s, i)}' is there twice (give it a name)`)
    names.add(jobName(s, i))
    out.push(...whenProblems(s, at))
    if ((s.command === undefined) === (s.op === undefined)) out.push(`${at}: give it a command or an op, one of them`)
    else if (s.op !== undefined) {
      if (typeof s.op !== "string" || !ID.test(s.op)) out.push(`${at}: op is an operation's id (dispatch.run)`)
      if (s.params !== undefined && (!s.params || typeof s.params !== "object" || Array.isArray(s.params))) out.push(`${at}: params is an object`)
      if (s.timeout !== undefined) out.push(`${at}: timeout is a command's`)
    } else out.push(...commandProblems(s.command, dir, at), ...timeoutProblems(s.timeout, at))
  })
  return out
}

// ---------- running ----------

const tail = (s: string, lines = 12) => s.replace(/\s+$/, "").split("\n").slice(-lines).join("\n").slice(-2000)

export class Hooks {
  vault: Vault
  /** Each plugin's last runs, newest last. */
  logs = new Map<string, Run[]>()
  private started = new Set<string>()
  private busy = new Map<string, { pending: VaultEvent | null }>() // event hooks running: the event to run next
  private rate = new Map<string, number[]>() // event hooks' recent starts

  constructor(vault: Vault) {
    this.vault = vault
  }

  /** Its folder of its own on this machine: <LOCAL>/plugin-state/<hash of the vault's real path>/<id>/, made. */
  stateDir(id: string) {
    const d = path.join(LOCAL, "plugin-state", vaultHere(this.vault.path).key, id)
    fs.mkdirSync(d, { recursive: true })
    return d
  }

  /** Run a plugin's command: its exit, stdout and stderr, logged. Never throws. */
  run(p: Declared, command: Command, o: { what: string; env: Record<string, string>; stdin: string; timeout: number }) {
    const t0 = performance.now()
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "ELECTRON_RUN_AS_NODE" && k !== "VAULTITE_TERMINAL") env[k] = v
    Object.assign(env, {
      VAULTITE: "1", VAULTITE_URL: serverUrl(), VAULTITE_VAULT: this.vault.path, VAULTITE_BIN: path.join(ROOT, "bin", "vau"),
      VAULTITE_PLUGIN_ID: p.id, VAULTITE_PLUGIN_DIR: p.dir, VAULTITE_PLUGIN_STATE: this.stateDir(p.id),
      PATH: [path.join(ROOT, "bin"), process.env.PATH].filter(Boolean).join(path.delimiter), ...o.env,
    })
    const prog = command[0].includes("/") && !path.isAbsolute(command[0]) ? path.resolve(p.dir, command[0]) : command[0]
    return new Promise<{ exit: number | null; stdout: string; stderr: string; error?: string; timedOut: boolean }>((resolve) => {
      let stdout = "", stderr = "", timedOut = false, error: string | undefined, ended = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (ended) return
        ended = true
        clearTimeout(timer)
        const run: Run = { t: new Date().toISOString(), what: o.what, command, exit: code, signal, ms: Math.round(performance.now() - t0), stderr: tail(stderr),
          ...(error ? { error } : timedOut ? { error: `timed out after ${o.timeout} s` } : {}) }
        const log = this.logs.get(p.id) ?? []
        log.push(run)
        if (log.length > KEEP) log.splice(0, log.length - KEEP)
        this.logs.set(p.id, log)
        resolve({ exit: code, stdout, stderr, error, timedOut })
      }
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(prog, command.slice(1), { cwd: p.dir, env, stdio: ["pipe", "pipe", "pipe"] })
      } catch (e) {
        error = String((e as Error).message)
        return finish(null, null)
      }
      timer = setTimeout(() => {
        timedOut = true
        child.kill("SIGTERM")
        setTimeout(() => child.kill("SIGKILL"), 2000).unref()
      }, o.timeout * 1000)
      child.stdout!.setEncoding("utf8").on("data", (s: string) => { if (stdout.length < MAX_OUT) stdout += s })
      child.stderr!.setEncoding("utf8").on("data", (s: string) => { stderr = (stderr + s).slice(-8000) })
      child.stdin!.on("error", () => {}) // (a command that doesn't read its stdin)
      child.stdin!.end(o.stdin)
      // (a program that couldn't start: no close may follow)
      child.on("error", (e) => { error = e.message; if (child.pid === undefined) finish(null, null) })
      child.on("close", (code, signal) => finish(code, signal))
    })
  }

  /** A manifest's `ops` as operations (their `run` is the command). */
  opsOf(p: Declared): Op[] {
    const ops = Array.isArray(p.manifest.ops) ? p.manifest.ops as Item[] : []
    return ops.map((d): Op => ({
      id: d.id, summary: d.summary, help: d.help, kind: d.kind, params: d.params as Record<string, Param> | undefined, args: d.args,
      cli: d.cli, mcp: d.mcp, result: d.result, owner: d.owner, action: d.action, lock: false,
      run: async (params) => {
        const json = JSON.stringify(params)
        const timeout = typeof d.timeout === "number" ? d.timeout : OP_TIMEOUT
        const r = await this.run(p, d.command, { what: d.id, stdin: json, timeout, env: { VAULTITE_OP: d.id, VAULTITE_PARAMS_JSON: json } })
        if (r.timedOut) throw new OpError(`${d.id}: its command took longer than ${timeout} s and was ended`, 504)
        if (r.error && r.exit === null) throw new OpError(`${d.id}: its command couldn't run: ${r.error}`, 500)
        if (r.exit !== 0) throw new OpError(`${d.id}: its command failed (exit ${r.exit})${r.stderr.trim() ? `: ${tail(r.stderr, 6)}` : ""}`, 500)
        const out = r.stdout.trim()
        try { return out ? JSON.parse(out) : null } catch { return out }
      },
    }))
  }

  /** A manifest's `schedule` as jobs of `plugin` (core/schedule.ts): a command, or an op run as "schedule". */
  jobsOf(p: Declared, plugin: Plugin): Job[] {
    const list = Array.isArray(p.manifest.schedule) ? p.manifest.schedule as Item[] : []
    return list.map((s, i): Job => {
      const name = jobName(s, i)
      const when = { every: s.every, ...(s.at ? { at: s.at } : {}), ...(s.machine ? { machine: s.machine } : {}) }
      if (s.op) return { ...when, name, run: () => plugin.runOp(s.op, s.params ?? {}, whoOf("schedule", null)) }
      return { ...when, name, run: async () => {
        const timeout = typeof s.timeout === "number" ? s.timeout : HOOK_TIMEOUT
        const r = await this.run(p, s.command, { what: `schedule ${name}`, stdin: "", timeout, env: { VAULTITE_PLUGIN_EVENT: "schedule", VAULTITE_SCHEDULE: name, VAULTITE_ACTOR: p.id } })
        if (r.timedOut) throw new Error(`took longer than ${timeout} s and was ended`)
        if (r.exit !== 0) throw new Error(r.error ?? `exit ${r.exit}${r.stderr.trim() ? `: ${tail(r.stderr, 3)}` : ""}`)
      } }
    })
  }

  /** A plugin that's on now (loaded): its startup commands, unless they ran since the server opened the vault or it was
   *  last turned on. */
  startup(p: Declared) {
    if (this.started.has(p.id)) return
    this.started.add(p.id)
    for (const h of Array.isArray(p.manifest.startup) ? p.manifest.startup as Item[] : []) {
      void this.run(p, h.command, { what: "startup", stdin: "", timeout: typeof h.timeout === "number" ? h.timeout : HOOK_TIMEOUT, env: { VAULTITE_PLUGIN_EVENT: "startup", VAULTITE_ACTOR: p.id } })
    }
  }

  /** A plugin turned off: its startup runs again when it's turned on. */
  stopped(id: string) {
    this.started.delete(id)
  }

  /** An event: the event hooks of the plugins that are on (loaded) and match it. */
  heard(ev: VaultEvent, plugins: Declared[]) {
    for (const p of plugins) {
      const hooks = Array.isArray(p.manifest.events) ? p.manifest.events as Item[] : []
      hooks.forEach((h, i) => {
        if (!typeMatches(ev.type, [h.on])) return
        const seen = matching(ev, { path: typeof h.path === "string" ? h.path : undefined })
        if (seen) this.fire(p, h, `${p.id}#${i}`, seen)
      })
    }
  }

  private fire(p: Declared, h: Item, key: string, ev: VaultEvent) {
    const b = this.busy.get(key)
    if (b) { b.pending = ev; return } // one at a time: the latest runs next
    const now = Date.now()
    const recent = (this.rate.get(key) ?? []).filter((t) => now - t < 60_000)
    if (recent.length >= PER_MINUTE) {
      const log = this.logs.get(p.id) ?? []
      if (log.at(-1)?.what !== `event ${ev.type}` || !log.at(-1)?.error?.startsWith("skipped")) {
        log.push({ t: new Date().toISOString(), what: `event ${ev.type}`, command: h.command, exit: null, signal: null, ms: 0, stderr: "",
          error: `skipped: more than ${PER_MINUTE} runs a minute (a hook that triggers itself?)` })
        this.logs.set(p.id, log.slice(-KEEP))
      }
      return
    }
    recent.push(now)
    this.rate.set(key, recent)
    const state = { pending: null as VaultEvent | null }
    this.busy.set(key, state)
    const json = JSON.stringify(ev)
    void this.run(p, h.command, { what: `event ${ev.type}`, stdin: json, timeout: typeof h.timeout === "number" ? h.timeout : HOOK_TIMEOUT,
      env: { VAULTITE_PLUGIN_EVENT: ev.type, VAULTITE_EVENT_JSON: json, VAULTITE_ACTOR: p.id } }).then(() => {
      this.busy.delete(key)
      if (state.pending) this.fire(p, h, key, state.pending)
    })
  }

  /** Forget the startups (the server serves another vault now). */
  close() {
    this.started.clear()
  }
}

/** The hooks' own operation: a vault plugin's command log. */
export function hookOps(hooks: () => Hooks): Op[] {
  return [{
    id: "vault-plugin.log",
    summary: "What a vault plugin's commands did lately (its manifest's ops, events, startup and schedule): each run's command, exit, time and stderr.",
    help: "Without an id, every vault plugin's. Kept in memory since the server started, the last 50 runs a plugin.",
    kind: "read",
    params: {
      id: { type: "string", description: "the vault plugin's id (its folder in .vaultite/plugins/)" },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20, description: "how many runs, the newest" },
    },
    args: ["id"],
    run: ({ id, limit }) => {
      const h = hooks()
      const ids = id ? [id] : [...h.logs.keys()].sort()
      return ids.map((p) => ({ id: p, runs: (h.logs.get(p) ?? []).slice(-limit) }))
    },
    text: (rows: { id: string; runs: Run[] }[]) => rows.length ? rows.map((r) => [`## ${r.id}`, ...(r.runs.length ? r.runs.map((x) =>
      `- ${x.t} ${x.what}: \`${x.command.join(" ")}\` ${x.error ? x.error : `exit ${x.exit}`} (${x.ms} ms)${x.stderr ? `\n  ${x.stderr.split("\n").join("\n  ")}` : ""}`) : ["No runs yet."])].join("\n")).join("\n\n")
      : "No vault plugin has run a command yet.",
  }]
}
