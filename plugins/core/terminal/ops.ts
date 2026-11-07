// Terminal's operations (`vau terminal`), through the plugin's routes, Workspaces' and the user's window: no more than
// those allow. A terminal is its id, its name or the end of its id, @<machine> another machine's (run there: passOn).
import { MODEL_NAME, PERMISSION_MODES, startAgent, TERMINAL_AGENT, newTerminalId, parseTerminal, resumeTerminalId, type AgentHow } from "../../../core/agents.ts"
import { byUser, fmtAgo, type Machine, MACHINE_CLIENT, OpError, type OpCtx, type Plugin, quoted, splitMachine } from "../../../core/plugins.ts"
import { allPanes, clean } from "../../../core/layout.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
type Session = { id: string; agent: string | null; process: string; busy?: boolean; clients: number; started: number; title?: string; state?: string; kind?: string; msg?: string
  needs?: boolean; note?: string; backend?: string; session?: string; name?: string; cwd?: string; command?: string; cols?: number; rows?: number; activity?: number
  machine?: string; machineLabel?: string; pid?: number; via?: number }
type Ended = { id: string; backend: string; command: string; name?: string; note?: string; started: number; exit: { code: number; signal: number; at: number; lost?: boolean } }
type TabAt = { workspace: number; tab: string }

/** An id that starts a new agent's session (`claude-k3j2h1g0`): a tab of one that's gone offers a new one, never
 *  starts it by itself. Plain shells (`k3j2h1g0`) start again; resumes resume. */
const freshAgent = (id: string) => { const t = parseTerminal(id); return !!t && !t.resume && !t.machine }

async function sessions(ctx: OpCtx, ended = false): Promise<{ sessions: Session[]; ended?: Ended[]; starting?: string[] }> {
  return await ctx.api("GET", `terminals/sessions${ended ? "?ended=1" : ""}`)
}

/** Where each terminal is shown: terminal id -> its panes (Workspaces' layouts; none without Workspaces). */
async function tabsOf(ctx: OpCtx): Promise<Map<string, TabAt[]>> {
  const out = new Map<string, TabAt[]>()
  let ws: unknown[] = []
  try { ws = (await ctx.api("GET", "workspaces")).workspaces ?? [] } catch (e) { if (!(e instanceof OpError)) throw e }
  ws.forEach((w, i) => {
    const l = clean((w as Any)?.layout)
    for (const p of l ? [l, ...(l.windows ?? [])].flatMap(allPanes) : []) {
      const m = /^view:terminal\/(.+)$/.exec(p.to)
      if (m) out.set(m[1], [...(out.get(m[1]) ?? []), { workspace: i + 1, tab: p.id }])
    }
  })
  return out
}

/** Close every tab showing terminal `id`, in every workspace; how many closed (0 without Workspaces, or none open). */
async function closeTabs(ctx: OpCtx, id: string) {
  try {
    const r = await ctx.api("POST", "workspaces/close", { path: `view:terminal/${id}` })
    return (r?.closed as unknown[] | undefined)?.length ?? 0
  } catch (e) {
    if (e instanceof OpError) return 0
    throw e
  }
}

/** Show terminal `to` in the user's window: a new tab, or a split. An agent's goes behind the user's tab, with a toast
 *  to show it: agents never take the user's focus. */
export async function show(ctx: OpCtx, to: string, split: "right" | "down" | null = null, did = "started a session") {
  const path = `view:terminal/${to}`
  try {
    if (byUser(ctx.who)) return void await ctx.ui({ action: "open", path, ...(split ? { split } : {}), newTab: !split })
    await ctx.ui({ action: "open", path, background: true })
    const who = ctx.who.label
    await ctx.ui({ action: "notify", text: `${who[0].toUpperCase()}${who.slice(1)} ${did}`, button: { label: "Show", open: path } })
  } catch (e) {
    if (e instanceof OpError && e.status === 409) throw new OpError(`no app window is open: open the app first (the session is running: vau terminal capture ${to})`, 409)
    throw e
  }
}

/** Op `id` run on machine `machine` (Machines) with `body`: its server checks its owner again. Passed on once only.
 *  `seconds`: how long it may take (a wait). */
export async function passOn(plugin: Plugin, ctx: OpCtx, machine: string, id: string, body: object, seconds = 15): Promise<Any> {
  const m = await plugin.ask<Machine | null>("machines:machine", null, machine)
  if (!m || m.self) throw new OpError(`no machine '${machine}' to ask (Machines lists them)`, 404)
  if (ctx.who.client?.startsWith("machine/")) throw new OpError(`a call passed on from another machine runs where it's sent, not on ${m.label}`, 409)
  if (!m.online) throw new OpError(`${m.label} is offline`, 502)
  const r = await fetch(`${m.url}/api/ops/${id}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(seconds * 1000) }).catch(() => null)
  if (!r) throw new OpError(`${m.label} doesn't answer`, 502)
  const out = await r.json().catch(() => ({})) as Any
  if (r.status === 404 && !out.id) throw new OpError(`${m.label} runs an older Vaultite, without ${id}`, 409)
  if (!r.ok) throw new OpError(`${m.label}: ${out.error || `answered ${r.status}`}`, r.status)
  return out
}

/** The machine `id` names when it isn't this one, else null (no machine named, or this one's id). */
async function elsewhere(plugin: Plugin, machine: string): Promise<string | null> {
  if (!machine) return null
  const m = await plugin.ask<Machine | null>("machines:machine", null, machine)
  return m?.self ? null : machine
}

/** A terminal as given (id, tab address, name, the end of its id; @<machine>): [its id, ""] here, [as given, machine]
 *  on another machine. `ended`: one that ended lately counts too (capture, wait, get). */
export async function target(plugin: Plugin, ctx: OpCtx, raw: string | undefined, o: { ended?: boolean } = {}): Promise<[string, string]> {
  const given = String(raw ?? "").trim().replace(/^view:terminal\//, "")
  if (!given) throw new OpError("which terminal? give its id, its name or the end of its id (vau terminal lists them)")
  const [own, at] = splitMachine(given)
  const machine = await elsewhere(plugin, at)
  if (machine) return [own, machine]
  const r = await sessions(ctx, o.ended)
  const all: { id: string; name?: string; ended?: boolean }[] = [...r.sessions, ...(r.ended ?? []).filter((e) => !r.sessions.some((s) => s.id === e.id)).map((e) => ({ id: e.id, name: e.name, ended: true }))]
  if (all.some((s) => s.id === own)) return [own, ""]
  const low = own.toLowerCase()
  const pick = (found: typeof all, how: string) => {
    // (a running one before one that ended, of the same name)
    const hits = found.some((s) => !s.ended) ? found.filter((s) => !s.ended) : found
    if (hits.length === 1) return hits[0].id
    if (hits.length > 1) throw new OpError(`'${own}' is ${hits.length} terminals' ${how}: ${hits.slice(0, 8).map((s) => s.id).join(", ")} (give more of its id)`, 409)
    return null
  }
  const id = pick(all.filter((s) => s.name?.toLowerCase() === low), "name")
    ?? (own.length >= 3 ? pick(all.filter((s) => s.id.endsWith(own)), "id ending") ?? pick(all.filter((s) => s.id.startsWith(own)), "id start") : null)
  if (id) return [id, ""]
  // (one that isn't running: its own op says so, as it always has: a tab's id, a session that just ended)
  if (/^[\w-]{1,64}$/.test(own) && (parseTerminal(own) || /^[a-z0-9]{8}$/.test(own))) return [own, ""]
  throw new OpError(`no terminal '${own}' here (vau terminal lists them; another machine's is <id>@<machine>)`, 404)
}

/** Runs `op` on the machine `machine` names with `body` (the terminal there as given), its answer's ids that machine's. */
async function there(plugin: Plugin, ctx: OpCtx, machine: string, op: string, body: Record<string, unknown>, seconds?: number) {
  const out = await passOn(plugin, ctx, machine, op, body, seconds)
  return { ...out, ...(typeof out.id === "string" ? { id: `${out.id}@${machine}` } : {}), machine }
}

const where = (tabs: TabAt[] | undefined) => (tabs?.length ? `tab in workspace ${[...new Set(tabs.map((t) => t.workspace))].join(", ")}` : "no tab")
const SPLIT = { type: "string", enum: ["right", "down"], description: "in a pane beside (right) or below (down) the current one, not a new tab (the user's only: an agent's goes behind theirs)" } as const
const ID = { type: "string", required: true, description: "the terminal: its id, its name or the end of its id (vau terminal lists them); <id>@<machine> for another machine's" } as const
const OWN = { type: "string", env: "VAULTITE_TERMINAL", description: "the terminal: its id, its name or the end of its id (vau terminal lists them), <id>@<machine> for another machine's; left out, the one you run in (VAULTITE_TERMINAL)" } as const
const MACHINE = { type: "string", description: "another of the Machines to run it on, by its id (studio); this one when left out" } as const
const STATES = ["exit", "idle", "working", "blocked", "done", "error", "quiet"]
/** How an agent starts (the route takes them: plugin.ts), as start and open take them. */
const HOW = {
  model: { type: "string", description: "the model it runs (opus, sonnet, gpt-6.1-sol...); its default when left out" },
  effort: { type: "string", description: "its reasoning effort, for an agent that takes one (low ... xhigh, max)" },
  mode: { type: "string", enum: [...PERMISSION_MODES], description: "its permission mode (auto, acceptEdits, plan...)" },
  allow: { type: "array", items: { type: "string" }, description: "tools it may use without asking (Bash(npm test:*))" },
} as const
/** The `how` an agent starts with, checked. */
function howOf(p: { model?: string; effort?: string; mode?: string; allow?: string[]; cwd?: string }): AgentHow {
  for (const k of ["model", "effort"] as const) if (p[k] && !MODEL_NAME.test(p[k]!)) throw new OpError(`'${p[k]}' isn't a ${k}'s name (\`${k}\`)`)
  return { ...(p.model ? { model: p.model } : {}), ...(p.effort ? { effort: p.effort } : {}), ...(p.mode ? { mode: p.mode as AgentHow["mode"] } : {}),
    ...(p.allow?.length ? { allow: p.allow } : {}), ...(p.cwd ? { cwd: p.cwd } : {}) }
}
/** Shows it, or says no window is open (the session runs anyway: it isn't an error to have started it). */
async function shown(ctx: OpCtx, id: string, split: "right" | "down" | null = null, did?: string) {
  try { await show(ctx, id, split, did); return true } catch (e) { if (e instanceof OpError && e.status === 409) return false; throw e }
}

/** How a wait went (terminal.wait's answer). */
const waited = (r: Any) => r.met === "exit" ? `${r.id} ended (${how(r.exit)}) after ${r.waited} s.`
  : r.met === "match" ? `${r.id} shows ${quoted(r.matched, 80)} after ${r.waited} s.`
  : r.met ? `${r.id} is ${r.met}${r.kind ? ` (${r.kind}${r.msg ? `: ${r.msg}` : ""})` : ""} after ${r.waited} s.`
  : r.exit ? `${r.id} ended (${how(r.exit)}) before it was ${r.for.join(" or ")}.`
  : `Still not ${r.for.join(" or ")} after ${r.waited} s: ${r.id} is ${r.state ?? "running"}.`
/** How long ago, short: "2m ago", "just now". */
const ago = (t: number) => { const a = fmtAgo(t, { short: true }); return a === "now" ? "just now" : `${a} ago` }
/** A terminal's line in a list: its id, what runs, its state, its name and title, and where it's shown. */
const row = (s: Session & { tabs?: TabAt[] }) => `${s.id}  ${s.process || "-"}${s.state ? ` (${s.state}${s.kind ? `: ${s.kind}` : ""}${s.needs ? ", needs you" : ""})` : ""}${s.name ? `  named "${s.name}"` : ""}${s.title ? `  "${s.title}"` : ""}${s.session ? `  session ${s.session}` : ""}${s.note ? `  on ${s.note}` : ""}  ${ago(s.started)}, ${s.machine ? `on ${s.machineLabel ?? s.machine}` : where(s.tabs)}${s.backend === "pty" ? " (in the server: a restart ends it)" : ""}${s.via ? ` (held by the older terminal server, pid ${s.via}, which ends after its last)` : ""}`
const how = (e: { code: number; signal: number; lost?: boolean }) => (e.lost ? "lost: its terminal server went away, so how is unknown" : e.signal ? `signal ${e.signal}` : `exit code ${e.code}`)

export function terminalOps(plugin: Plugin) {
  plugin.op({
    owner: "the terminal",
    id: "terminal.list",
    cli: "terminal",
    summary: "The app's terminals: each session (what runs in it, its state, title and tabs), then tabs whose session is gone; machine all: every machine's.",
    help: `The Terminal plugin's sessions on the machine the server runs on: shells, commands and coding agents (Claude Code,
Codex...), kept by Vaultite's terminal server apart from the app's server, so they outlive it (or by another plugin's
backend, herdr's). A terminal's id names what it runs: <agent>-<id> a new session of that agent, resume-<agent>-<session
id> an agent's session resumed in its folder, anything else a shell or a command. "session <id>": the agent's own
session id (what it resumes; Claude Code's names its transcript), when the agent says. machine names another of the
Machines (its terminals are <id>@<machine>), all every machine's; ended adds the ones that ended in the last hour, with
how. After the sessions, the tabs whose terminal is gone: an agent's (it won't start again by itself: it says its
session ended, with Restart; terminal.tidy closes them) or a shell's (a new shell when shown). Claude Code sessions the
app runs in its chat (the companion's, its jobs', inbox replies') aren't terminals: vau chat list --machine all.

Every terminal op names a terminal by its id, its name (terminal.rename) or the end of its id, and @<machine> for
another machine's: vau terminal get|capture|wait|send|key|rename|end, and start, open, run, ask to make one; vau
terminal attach <terminal> shows one in the terminal you run it in (⌃\ detaches).

  vau terminal
  vau terminal --machine all
  vau terminal --ended --json`,
    kind: "read",
    params: {
      machine: { type: "string", description: "another of the Machines, by its id (studio), or all: every machine's" },
      ended: { type: "boolean", description: "the terminals that ended in the last hour too, with how" },
    },
    run: async ({ machine, ended }, ctx) => {
      const m = machine === "all" ? null : await elsewhere(plugin, machine ?? "")
      if (m) return await there(plugin, ctx, m, "terminal.list", { ...(ended ? { ended } : {}) })
      const [ss, tabs] = await Promise.all([sessions(ctx, !!ended), tabsOf(ctx)])
      const live = new Set([...ss.sessions.map((s) => s.id), ...(ss.starting ?? [])])
      const gone = [...tabs].filter(([t]) => !t.includes("@") && !live.has(t)).map(([t, at]) => ({ id: t, tabs: at, agent: freshAgent(t) }))
      const out: { sessions: (Session & { tabs: TabAt[] })[]; gone: typeof gone; ended?: Ended[]; machines?: Record<string, string> } =
        { sessions: ss.sessions.map((s) => ({ ...s, tabs: tabs.get(s.id) ?? [] })), gone, ...(ended ? { ended: ss.ended ?? [] } : {}) }
      if (machine === "all") {
        const all = await plugin.ask<Machine[]>("machines", [])
        const others = all.filter((x) => !x.self && x.online && x.plugins?.includes("terminal"))
        const lists = await Promise.all(others.map((x) => passOn(plugin, ctx, x.id, "terminal.list", {}).then((r) => ({ x, r }), (e: Error) => ({ x, e }))))
        out.machines = {}
        for (const l of lists) {
          if ("e" in l) { out.machines[l.x.id] = l.e.message; continue }
          out.machines[l.x.id] = "ok"
          out.sessions.push(...(l.r.sessions as Session[]).map((s) => ({ ...s, id: `${s.id}@${l.x.id}`, machine: l.x.id, machineLabel: l.x.label, tabs: tabs.get(`${s.id}@${l.x.id}`) ?? [] })))
        }
      }
      return out
    },
    text: (r) => {
      const rows = (r.sessions as (Session & { tabs: TabAt[] })[]).map(row)
      const gone = (r.gone as { id: string; tabs: TabAt[]; agent: boolean }[]).map((o) => `${o.id}  gone, ${where(o.tabs)}${o.agent ? " (an agent's: vau terminal tidy closes it)" : " (a new shell when shown)"}`)
      const ended = ((r.ended ?? []) as Ended[]).map((e) => `${e.id}  ${e.command || "-"}${e.name ? `  named "${e.name}"` : ""}  ended ${ago(e.exit.at)} (${how(e.exit)})`)
      const away = Object.entries((r.machines ?? {}) as Record<string, string>).filter(([, v]) => v !== "ok").map(([k, v]) => `${k}: ${v}`)
      return (rows.length ? rows.join("\n") : "(no terminal sessions)") + (gone.length ? `\n\nTabs with no session:\n${gone.join("\n")}` : "") +
        (ended.length ? `\n\nEnded lately:\n${ended.join("\n")}` : "") + (away.length ? `\n\nNot listed:\n${away.join("\n")}` : "")
    },
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.get",
    cli: "terminal get",
    summary: "One terminal: what runs in it, its state, folder, command, size, name, tabs, or how it ended.",
    help: `Its state is its program's (OSC 7501, else its agent's hooks, else a question on its screen): idle, working, blocked
(waiting on the user: kind permission, question or auth), done or error. One that ended in the last hour answers with
\`exit\` (its code, or the signal that ended it). Without an id: the one you run in (your own id is VAULTITE_TERMINAL).
--json adds what was sent into it from outside its tabs lately, and by whom (inputs).

  vau terminal get
  vau terminal get claude-k3j2h1g0
  vau terminal get "Release notes"
  vau terminal get h1g0@studio --json`,
    kind: "read",
    params: { id: OWN },
    args: ["id"],
    run: async ({ id }, ctx) => {
      if (!id) throw new OpError("which terminal? give its id (vau terminal lists them): you don't run in one of the app's (no VAULTITE_TERMINAL)")
      const [t, machine] = await target(plugin, ctx, id, { ended: true })
      if (machine) return await there(plugin, ctx, machine, "terminal.get", { id: t })
      const [r, tabs] = await Promise.all([sessions(ctx, true), tabsOf(ctx)])
      const s = r.sessions.find((x) => x.id === t)
      if (s) return { ...s, tabs: tabs.get(t) ?? [], inputs: (await ctx.api("GET", `terminals/${encodeURIComponent(t)}/inputs`).catch(() => ({ inputs: [] }))).inputs }
      const e = r.ended?.find((x) => x.id === t)
      if (e) return { ...e, ended: true }
      throw new OpError(`there's no terminal '${t}' (vau terminal lists them)`, 404)
    },
    text: (r) => {
      if (r.ended) return `${r.id}  ${r.command || "-"}${r.name ? `  named "${r.name}"` : ""}  ended ${ago(r.exit.at)} (${how(r.exit)})`
      const s = r as Session & { tabs: TabAt[] }
      const sent = ((r.inputs ?? []) as { at: number; by: string; text?: string; keys?: string[] }[]).slice(-3)
        .map((x) => `  ${ago(x.at)} by ${x.by}: ${x.text ? quoted(x.text, 60) : ""}${x.keys ? ` ${x.keys.join(" ")}` : ""}`)
      return [row(s), ...[s.pid && `pid: ${s.pid}`, s.command && `runs: ${s.command}`, s.cwd && `in: ${s.cwd}`, s.cols && `size: ${s.cols}x${s.rows}`, s.msg && `says: ${s.msg}`,
        `clients: ${s.clients}`, s.activity && `last activity: ${ago(s.activity)}`, sent.length && `sent lately:\n${sent.join("\n")}`].filter(Boolean)].join("\n")
    },
  })

  plugin.op({
    id: "terminal.instructions",
    cli: "terminal instructions",
    summary: "What a coding agent started in one of the app's terminals is told, word for word.",
    help: `Added to an agent's own instructions when it takes them (a system prompt's addition, an instructions file): that
it runs inside Vaultite, then each plugin's line for agents. The vault's rules, .vaultite/AGENTS.md, have the same lines.

  vau terminal instructions`,
    kind: "read",
    run: async (_p, ctx) => ctx.api("GET", "terminals/instructions"),
    text: (r) => String(r.text ?? ""),
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.start",
    cli: "terminal start",
    summary: "Start a terminal in the background, no tab: a shell, a command (the terminal ends with it) or a coding agent with its task; answers its id.",
    help: `A command runs alone in the terminal, through the login shell (so with the user's PATH): it ends when the command
does, and its exit code is the terminal's (vau terminal wait gives it; capture reads what it printed, for an hour after).
wait waits for that here and answers the exit code and the last lines. An agent (claude, codex...; claude_personal: in
one of its accounts) starts with prompt as its first message (with session, it resumes that session of the agent's,
prompt its next message); nothing: a shell. name names it (its tabs, the list, and
how to address it: vau terminal capture "<name>"); cwd is the folder it starts in (the vault's by default). open shows
its tab too (as vau terminal open does). With machine, on another of the Machines.

  vau terminal start --command "npm test" --name tests --wait
  vau terminal start --agent codex --prompt "Review the diff in core/" --name review
  vau terminal start --command "npm run dev" --cwd ~/code/site --machine studio`,
    kind: "write",
    lock: false, // starting a shell holds nothing of the vault
    params: {
      command: { type: "string", description: "a shell command to run, alone: the terminal ends when it does, with its exit code" },
      agent: { type: "string", description: "a coding agent to run instead (claude, codex, opencode...; claude_personal: one of its accounts)" },
      prompt: { type: "string", description: "the agent's first message: its task" },
      session: { type: "string", description: "the agent's session to resume (its id) instead of a new one; prompt is its next message" },
      name: { type: "string", description: "its name (at most 80 characters): its tabs and the list show it, and it addresses it" },
      cwd: { type: "string", description: "the folder it starts in, a full path (default: the vault's)" },
      ...HOW,
      machine: MACHINE,
      wait: { type: "boolean", description: "a command's: wait for it to end, and answer its exit code and last lines" },
      timeout: { type: "number", minimum: 0, maximum: 3600, default: 600, description: "with wait, seconds to wait at most" },
      open: { type: "boolean", description: "show its tab in the user's window too" },
    },
    run: async ({ command, agent, prompt, session, name, cwd, machine, wait, timeout, open, model, effort, mode, allow }, ctx) => {
      const how = howOf({ model, effort, mode, allow, cwd })
      if (session && (!agent || !/^[\w.-]{4,100}$/.test(session))) throw new OpError(agent ? `'${session}' isn't a session's id` : "a `session` is an agent's: name the `agent` (claude, codex...)")
      if (!agent && (model || effort || mode || allow?.length)) throw new OpError("`model`, `effort`, `mode` and `allow` are an agent's: name the `agent`")
      if (command && agent) throw new OpError("give a `command` or an `agent`, not both")
      if (agent && !TERMINAL_AGENT.test(agent)) throw new OpError(`'${agent}' isn't an agent's name (claude, codex, opencode...; claude_personal: one of its accounts)`)
      if (prompt?.trim() && !agent) throw new OpError("a `prompt` is an agent's: name the `agent` (claude, codex...)")
      if (wait && !command) throw new OpError("`wait` is a command's: an agent's turn is waited for with vau terminal wait")
      const m = await elsewhere(plugin, machine ?? "")
      if (m) {
        const out = await there(plugin, ctx, m, "terminal.start", { ...(command ? { command } : {}), ...(agent ? { agent } : {}), ...(prompt ? { prompt } : {}), ...(session ? { session } : {}),
          ...(name ? { name } : {}), ...how, ...(wait ? { wait, timeout } : {}) }, wait ? Number(timeout) + 30 : 30)
        return { ...out, shown: open ? await shown(ctx, out.id) : false }
      }
      const [who, profile] = (agent ?? "").split("_")
      const id = session ? resumeTerminalId(who, session, profile) : newTerminalId(agent)
      const body = { ...(command ? { command } : {}), ...(name ? { name } : {}), ...(cwd ? { cwd } : {}) }
      if (agent) {
        await startAgent(ctx, id, prompt?.trim() || undefined, how)
        if (name) await ctx.api("POST", `terminals/${id}/name`, { name })
      } else await ctx.api("POST", `terminals/${id}`, Object.keys(body).length ? body : undefined)
      const isShown = open ? await shown(ctx, id) : false
      if (!wait) return { id, ...(agent ? { agent } : {}), ...(command ? { command } : {}), ...(name ? { name } : {}), shown: isShown }
      const w = await ctx.api("POST", `terminals/${encodeURIComponent(id)}/wait`, { for: ["exit"], timeout })
      const c = await ctx.api("GET", `terminals/${encodeURIComponent(id)}/capture?lines=60`).catch(() => ({ text: "" }))
      return { id, command, ...(name ? { name } : {}), shown: isShown, ...w, output: String(c.text ?? "") }
    },
    text: (r) => r.met === undefined && !r.timedOut
      ? `Started ${r.id}${r.agent ? ` (${r.agent})` : r.command ? ` running ${quoted(r.command, 60)}` : ""}${r.name ? `, named "${r.name}"` : ""}${r.shown ? ", its tab open" : ""}.`
      : `${r.output ? `${r.output}\n\n` : ""}${r.timedOut ? `Still running after ${r.waited} s: ${r.id}` : `${r.id} ended (${how(r.exit)}) after ${r.waited} s`}.`,
    did: ({ command, agent }) => ({ action: "run", text: command ? `Started ${quoted(command, 60)} in a terminal` : `Started a terminal${agent ? ` running ${agent}` : ""}` }),
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.open",
    cli: "terminal open",
    summary: "Open a new terminal in a tab of the user's window: a shell, or a coding agent (claude, codex...), with its task.",
    help: `The session starts first, so it runs even with no window open (then it says no tab could be shown, and vau terminal
capture reads it). An agent with accounts starts in one with <agent>_<account> (claude_personal); model, effort, mode,
allow and cwd start it so. Opened by an agent, its tab goes behind the user's, with a toast to show it. It answers its
id (--json). In the background, without a tab: vau terminal start.

  vau terminal open
  vau terminal open claude --prompt "Fix the failing test in core/" --split right`,
    kind: "write",
    lock: false, // starting a shell holds nothing of the vault
    params: {
      agent: { type: "string", description: "the agent to run (claude, codex, opencode...; claude_personal: one of its accounts); none: a shell" },
      prompt: { type: "string", description: "the agent's first message: its task" },
      ...HOW,
      cwd: { type: "string", description: "the folder it starts in, a full path (default: the vault's)" },
      split: SPLIT,
    },
    args: ["agent"],
    run: async ({ agent, prompt, split, model, effort, mode, allow, cwd }, ctx) => {
      if (agent && !TERMINAL_AGENT.test(agent)) throw new OpError(`'${agent}' isn't an agent's name (claude, codex, opencode...; claude_personal: one of its accounts)`)
      const said = prompt?.trim(), how = howOf({ model, effort, mode, allow, cwd })
      if (said && !agent) throw new OpError("a prompt is an agent's: name the agent (claude, codex...)")
      if (!agent && (model || effort || mode || allow?.length)) throw new OpError("`model`, `effort`, `mode` and `allow` are an agent's: name the `agent`")
      const t = newTerminalId(agent)
      const r = agent ? await startAgent(ctx, t, said || undefined, how) : await ctx.api("POST", `terminals/${t}`, cwd ? { cwd } : undefined)
      return { ...r, id: t, shown: await shown(ctx, t, split ?? null) }
    },
    text: (r, p) => `Opened ${r.id}${p.agent ? ` (${p.agent})` : ""}${r.shown ? "" : ` in the background: no app window is open, so no tab (vau terminal capture ${r.id} reads it)`}.`,
    did: ({ agent }) => ({ action: "run", text: `Opened a terminal${agent ? ` running ${agent}` : ""}` }),
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.resume",
    cli: "terminal resume",
    summary: "Resume a coding agent's session in a tab (the one that has it, if it's open): by its id or, for Claude Code, its title.",
    help: `A Claude Code session by its title: the exact title, else the one title that has all the words (of the last 30
days); several are listed. Other agents: their session's id.

  vau terminal resume "Left sidebar scrollbar"
  vau terminal resume 3f2a9c1e-5b7d-4e2a-9c1f-0a2b3c4d5e6f
  vau terminal resume 019a6f3e-77c2-7d10-a1b2-c3d4e5f60718 --agent codex`,
    kind: "write",
    lock: false,
    params: {
      session: { type: "string", required: true, description: "the session's id, or a Claude Code session's title (or words of it)" },
      agent: { type: "string", default: "claude", description: "whose session it is (claude, codex...)" },
      split: SPLIT,
    },
    args: ["session"],
    run: async ({ session, agent, split }, ctx) => {
      const q = session.trim()
      let sid = q, title = ""
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(q)) {
        if (agent !== "claude") throw new OpError(`give ${agent}'s session id: titles are looked up for Claude Code only`)
        const all: Any[] = (await ctx.api("GET", "claude-code?days=30")).sessions ?? []
        const low = q.toLowerCase(), words: string[] = low.split(/\s+/)
        const exact = all.filter((s) => (s.title ?? "").toLowerCase() === low)
        const hits = exact.length ? exact : all.filter((s) => words.every((w) => (s.title ?? "").toLowerCase().includes(w)))
        if (!hits.length) throw new OpError(`no Claude Code session of the last 30 days is titled like '${q}'`)
        if (hits.length > 1) throw new OpError(`'${q}' is ${hits.length} sessions: ${hits.slice(0, 8).map((s) => `${s.id} "${s.title}"`).join(", ")}`)
        sid = hits[0].id; title = hits[0].title
      }
      const t = resumeTerminalId(agent, sid)
      await ctx.api("POST", `terminals/${t}`)
      await show(ctx, t, split ?? null, "resumed a session")
      return { id: t, session: sid, title }
    },
    text: (r) => `Resumed ${r.title ? `"${r.title}" ` : ""}in ${r.id}.`,
    did: ({ session }) => ({ action: "run", text: `Resumed the session ${quoted(session, 60)} in a terminal` }),
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.capture",
    cli: "terminal capture",
    summary: "What a terminal shows: its screen and the lines above it (lines, or all its history), as text, vt (colors) or html.",
    help: `Text has a wrapped line joined to the one before it and trailing blank lines left out. vt is the terminal's own
sequences (replayed in a terminal, it draws what this one shows, colors and all); html is the same as a page. --json
adds its cursor, whether a full-screen program has it (alternate), and the cursor's line with what's drawn plainly
(typed) apart from what's dim or grey (suggested: Claude Code's suggested reply, not typed). One that ended in the last
hour too (its last lines only, as text, after ten minutes).

  vau terminal capture claude-k3j2h1g0
  vau terminal capture tests --lines 200
  vau terminal capture h1g0@studio --all > session.txt
  vau terminal capture "Release notes" --format html > screen.html`,
    kind: "read",
    exact: true,
    params: {
      id: ID,
      lines: { type: "integer", minimum: 1, description: "how many lines, the last ones (its screen and those above); default: its screen" },
      all: { type: "boolean", description: "all it keeps (its whole history), not just the last lines" },
      format: { type: "string", enum: ["text", "vt", "html"], default: "text", description: "text, vt (its own sequences: colors, the cursor) or html" },
    },
    args: ["id"],
    run: async ({ id, lines, all, format }, ctx) => {
      const [t, machine] = await target(plugin, ctx, id, { ended: true })
      if (machine) return await there(plugin, ctx, machine, "terminal.capture", { id: t, ...(lines ? { lines } : {}), ...(all ? { all } : {}), format })
      const q = new URLSearchParams({ format, ...(all ? { lines: "all" } : lines ? { lines: String(lines) } : {}) })
      return await ctx.api("GET", `terminals/${encodeURIComponent(t)}/capture?${q}`)
    },
    text: (r) => String(r.text ?? ""),
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.wait",
    cli: "terminal wait",
    summary: "Wait until a terminal ends (its exit code), its agent is idle, blocked on the user or another state, or its output goes quiet; at most timeout.",
    help: `for names what ends the wait, one or more of: exit (the terminal's program ended: its exit code), idle, working,
blocked (waiting on the user: a permission, a question), done, error (its program's state, as the list shows it), quiet
(nothing printed for \`quiet\` seconds), and with match the screen showing a pattern. Idle and done count once they've
held for \`hold\` seconds (1.5), and a state once it's told after the last thing typed into the terminal, so
waiting for idle right after sending an agent a prompt waits for the end of that turn, not the idle before it. Left
out: an agent's turn over (idle, blocked, done or error) in an agent's terminal, exit in the rest. It answers what it
met (met: null when the time ran out), the state now, and how it ended if it did; vau exits with the terminal's exit
code when it waited for that (1 when it was lost: its terminal server went away), 124 when the time ran out. (vau terminal send --wait types and waits in one.)

  vau terminal send claude-k3j2h1g0 "Run the tests and fix what fails" && vau terminal wait claude-k3j2h1g0
  vau terminal wait tests --for exit --timeout 1200
  vau terminal wait h1g0@studio --for quiet --quiet 5
  vau terminal wait tests --match "passed|failed" --timeout 300`,
    kind: "read",
    params: {
      id: ID,
      for: { type: "array", items: { type: "string", enum: STATES }, description: "what ends the wait: exit, idle, working, blocked, done, error, quiet (default: an agent's turn over, else exit)" },
      timeout: { type: "number", minimum: 0, maximum: 3600, default: 600, description: "seconds to wait at most" },
      quiet: { type: "number", minimum: 0.2, maximum: 600, default: 2, description: "with for quiet: seconds without output that count as quiet" },
      match: { type: "string", description: "a pattern (a regular expression) its screen and the lines above it come to show: the wait ends then too" },
      hold: { type: "number", minimum: 0, maximum: 60, description: "seconds idle or done must hold before they count (default 1.5: an agent rests between steps of a turn)" },
    },
    args: ["id"],
    run: async ({ id, for: wants, timeout, quiet, match, hold }, ctx) => {
      const [t, machine] = await target(plugin, ctx, id, { ended: true })
      const body = { ...(wants?.length ? { for: wants } : {}), timeout, quiet, ...(match ? { match } : {}), ...(hold !== undefined ? { hold } : {}) }
      if (machine) return await there(plugin, ctx, machine, "terminal.wait", { id: t, ...body }, Number(timeout) + 30)
      return { id: t, ...await ctx.api("POST", `terminals/${encodeURIComponent(t)}/wait`, body) }
    },
    text: waited,
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.send",
    cli: "terminal send",
    summary: "Type text into a terminal, then Enter (--no-enter: not), saying whether an agent took it; wait: then wait for its turn to end. Keys by name: terminal.key.",
    help: `The text goes as typed (a long or multi-line one as a paste, so it arrives whole). Into an agent, with Enter, it
answers whether the agent took it (submitted: it started working on it), and when not why, as far as its screen says:
it was waiting on a question (what you typed went to that), or the text still sits in its input (vim mode, a survey or
a dialog took the Enter). wait then waits as vau terminal wait does with nothing in for (its turn over: idle, blocked,
done or error, told after this text; else the terminal's end), at most timeout seconds.

  vau terminal send k3j2h1g0 "npm test"
  vau terminal send review "Look at the diff in core/ and say what you'd change" --wait
  vau terminal send claude-k3j2h1g0 "yes" --no-enter`,
    kind: "write",
    lock: false,
    params: {
      id: ID,
      text: { type: "string", stdin: true, description: "what to type (piped in, when not given)" },
      enter: { type: "boolean", default: true, description: "press Enter after it (--no-enter: don't)" },
      wait: { type: "boolean", description: "then wait for its agent's turn to end (or the terminal's end), and say how it went" },
      timeout: { type: "number", minimum: 0, maximum: 3600, default: 600, description: "with wait, seconds to wait at most" },
    },
    args: ["id", "text"],
    run: async ({ id, text, enter, wait, timeout }, ctx) => {
      const [t, machine] = await target(plugin, ctx, id)
      if (!text && !enter) throw new OpError("give the text to type")
      if (machine) return await there(plugin, ctx, machine, "terminal.send", { id: t, text: text ?? "", enter, ...(wait ? { wait, timeout } : {}) }, wait ? Number(timeout) + 30 : 15)
      const r = await ctx.api("POST", `terminals/${encodeURIComponent(t)}/send`, { text: text ?? "", enter, confirm: true })
      return wait ? { ...r, ...await ctx.api("POST", `terminals/${encodeURIComponent(t)}/wait`, { timeout }) } : r
    },
    text: (r, p) => `Typed into ${r.id}${p.text ? `: ${p.text.length > 60 ? `${p.text.slice(0, 60)}…` : p.text}` : ""}${r.enter ? " (Enter)" : ""}.` +
      (r.submitted === true ? " It took it." : r.submitted === false ? ` It didn't take it: ${r.why}.` : r.why ? ` (${r.why}.)` : "") + (p.wait ? ` ${waited(r)}` : ""),
    did: ({ id, text }) => ({ action: "run", text: `Typed ${quoted(text, 60)} into the terminal ${id}` }),
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.key",
    cli: "terminal key",
    summary: "Press keys in a terminal, by name: Enter, Escape, Tab, C-c, Up, Down, PageUp, F1 to F12, M-x, S-Tab...",
    help: `Each key is a name (Enter, Tab, BTab, Escape, Space, BSpace, Delete, Insert, Home, End, PageUp, PageDown, Up,
Down, Left, Right, F1 to F12) or one character, with C- (control), M- (alt) or S- (shift) before it, as tmux names
them; arrows go as the terminal's mode has them (a full-screen program's). In order, at once.

  vau terminal key claude-k3j2h1g0 C-c
  vau terminal key review Down Down Enter
  vau terminal key h1g0@studio Escape`,
    kind: "write",
    lock: false,
    params: {
      id: ID,
      keys: { type: "array", items: { type: "string" }, commas: false, required: true, description: "the keys, in order (C-c, Enter, Up...)" },
    },
    args: ["id", "keys"],
    run: async ({ id, keys }, ctx) => {
      const [t, machine] = await target(plugin, ctx, id)
      if (!keys?.length) throw new OpError("which keys? Enter, C-c, Up...")
      if (machine) return await there(plugin, ctx, machine, "terminal.key", { id: t, keys })
      return await ctx.api("POST", `terminals/${encodeURIComponent(t)}/send`, { keys })
    },
    text: (r) => `Pressed ${(r.keys as string[]).join(" ")} in ${r.id}.`,
    did: ({ id, keys }) => ({ action: "run", text: `Pressed ${(keys ?? []).join(" ")} in the terminal ${id}` }),
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.rename",
    cli: "terminal rename",
    summary: "Name a terminal's session (its tabs, Terminals and this list show it, before its program's title; ops address it by it); an empty name takes it back. Without an id, your own.",
    help: `The name is kept with the session by the terminal server while it runs: every device's tab shows it, as Rename
tab… in the app names it.

  vau terminal rename claude-k3j2h1g0 "Release notes"
  vau terminal rename --name "Fixing the sidebar"
  vau terminal rename k3j2h1g0 ""`,
    kind: "write",
    lock: false,
    params: {
      id: OWN,
      name: { type: "string", default: "", description: "its name, at most 80 characters; empty: back to what its program titles it" },
    },
    args: ["id", "name"],
    run: async ({ id, name }, ctx) => {
      if (!id) throw new OpError("which terminal? give its id (vau terminal lists them): you don't run in one of the app's")
      const [t, machine] = await target(plugin, ctx, id)
      if (machine) return await there(plugin, ctx, machine, "terminal.rename", { id: t, name: name ?? "" })
      return await ctx.api("POST", `terminals/${encodeURIComponent(t)}/name`, { name: name ?? "" })
    },
    text: (r) => (r.name ? `Named ${r.id} "${r.name}".` : `${r.id} goes by its program's title again.`),
    did: ({ id, name }) => ({ action: "ui", text: name ? `Named the terminal ${id ?? ""} ${quoted(name, 60)}` : `Took the name off the terminal ${id ?? ""}` }),
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.end",
    cli: "terminal end",
    summary: "End a terminal's session for good (like its tab's End session) and close its tabs everywhere (keepTabs: not); without an id, your own.",
    help: `An agent asked to close itself runs it last, without an id: its session ends and its tab closes (tell the user
what you did first: the tab and what's in it go).

  vau terminal end claude-k3j2h1g0
  vau terminal end tests@studio
  vau terminal end`,
    kind: "destructive",
    params: {
      id: OWN,
      keepTabs: { type: "boolean", description: "leave its tabs open, saying the session ended (with Restart)" },
    },
    args: ["id"],
    run: async ({ id, keepTabs }, ctx) => {
      if (!id) throw new OpError("which terminal? give its id (vau terminal lists them): you don't run in one of the app's")
      const [t, machine] = await target(plugin, ctx, id)
      if (machine) {
        const r = await there(plugin, ctx, machine, "terminal.end", { id: t, ...(keepTabs ? { keepTabs } : {}) })
        return { ...r, closedTabs: (r.closedTabs ?? 0) + (keepTabs ? 0 : await closeTabs(ctx, r.id)) }
      }
      const r = await ctx.api("DELETE", `terminals/${encodeURIComponent(t)}${keepTabs ? "?keep=1" : ""}`)
      return { ...r, closedTabs: keepTabs ? 0 : await closeTabs(ctx, t) }
    },
    text: (r) => `Ended ${r.id}${r.closedTabs ? `, closed its tab${r.closedTabs === 1 ? "" : "s"}` : ""}.`,
    did: ({ id }) => ({ action: "delete", text: `Ended the terminal ${id}` }),
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.tidy",
    cli: "terminal tidy",
    summary: "Close the tabs whose agent's session is gone (an ended Claude Code, a machine restarted); shells' tabs stay.",
    help: `An agent's session that died (or a machine restarted, or ended after its report) keeps its tabs (saying it
ended, with Restart) until you close them or run this; exiting the shell after the agent closes them.

  vau terminal tidy`,
    kind: "write",
    params: { id: { type: "string", description: "only this terminal's tabs" } },
    run: async ({ id }, ctx) => {
      const [ss, tabs] = await Promise.all([sessions(ctx), tabsOf(ctx)])
      const live = new Set([...ss.sessions.map((s) => s.id), ...(ss.starting ?? [])])
      const dead = [...tabs.keys()].filter((t) => !t.includes("@") && !live.has(t) && freshAgent(t) && (!id || t === id))
      let closed = 0
      for (const t of dead) closed += await closeTabs(ctx, t)
      return { closed: dead, tabs: closed }
    },
    text: (r) => (r.closed.length ? `Closed ${r.tabs} tab${r.tabs === 1 ? "" : "s"} of gone sessions: ${r.closed.join(", ")}.` : "No tabs of gone sessions."),
    did: () => ({ action: "ui", text: "Closed the tabs of terminals that are gone" }),
  })
}
