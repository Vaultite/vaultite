// terminal.run: a file handed to an agent (or a command) in a new terminal, here or on another machine (Dispatch,
// schedules, `vau`); terminal.ask: a question for an agent in a new background terminal (the Ask box).
import fs from "node:fs"
import path from "node:path"
import { agentIn, MODEL_NAME, newTerminalId, shellQuote, startAgent, TERMINAL_AGENT } from "../../../core/agents.ts"
import { type Machine, MACHINE_CLIENT, type OpCtx, OpError, type Plugin, quoted } from "../../../core/plugins.ts"
import { show } from "./ops.ts"

export const DEFAULT_PROMPT = "Read the note {path} and do what it asks."
/** What an agent is told after its prompt while the Inbox is on: it works alone, and its report is where the user answers. */
export const REPORT = "Do it all the way, then end with `vau inbox report` (vau inbox report --help): the user reads it in their " +
  "inbox, your terminal ends after this turn, and their reply comes back to you."
/** How the refusal of a command not yet allowed here starts (the app asks the user on it). */
export const COMMAND_UNSEEN = "This machine hasn't run this action's command before:"

/** What to start: an agent with its prompt (`report: false`: no report asked, nor terminal ended), or a shell command. */
type What = { agent?: string; prompt?: string; command?: string; report?: boolean }
type Started = { id: string; handed: boolean; running?: boolean }

/** A template with {path}, {file}, {title} and {vault} filled in (shell-quoted in a command); other braces stay. */
export function fill(template: string, vars: Record<string, string>, shell = false) {
  return template.replace(/\{(path|file|title|vault)\}/g, (_m, k: string) => (shell ? shellQuote(vars[k]) : vars[k]))
}

/** A question's first words, as its session is called until the agent names it: one line, at most about 60 letters. */
export function askTitle(prompt: string) {
  const line = prompt.replace(/\s+/g, " ").trim()
  if (line.length <= 60) return line
  const cut = line.slice(0, 60), space = cut.lastIndexOf(" ")
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** What the server keeps of a run: the note a session was started on (its tab opens by that note's), and a way to tell
 *  the app's lists now, so a tab opened right after knows it. */
type Keep = { startedOn: (id: string, rel: string) => void; listNow: () => Promise<void> }

export function runOps(plugin: Plugin, keep: Keep) {
  /** The machine `id` names when it isn't this one (Machines), else null. */
  async function machineFor(id: string | undefined): Promise<Machine | null> {
    if (!id) return null
    const m = await plugin.ask<Machine | null>("machines:machine", null, id)
    if (m) return m.self ? null : m
    const ids = await plugin.ask<string[]>("machines:ids", [])
    throw new OpError(`no machine '${id}'${ids.length ? ` (${ids.join(", ")})` : ": Machines is off or lists none"}`, 404)
  }

  /** Waits (20 s at most) for machine `m`'s copy of `rel` to read as this one's: iCloud may still be bringing it there. */
  async function sameCopy(m: Machine, rel: string) {
    const mine = fs.readFileSync(plugin.vault.abs(rel), "utf8")
    let found = false
    for (const until = Date.now() + 20000; Date.now() < until; await pause(1000)) {
      try {
        const r = await fetch(`${m.url}/api/file?path=${encodeURIComponent(rel)}`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(5000) })
        if (r.status === 413 || r.status === 415) return // not text: there, as far as it says
        if (r.ok) { found = true; if ((await r.json() as { text?: string }).text === mine) return }
      } catch { /* tried again */ }
    }
    if (!found) throw new OpError(`${m.label} doesn't have ${rel} yet (its sync may still be bringing it there)`, 409)
  }

  /** Runs it on machine `m` (its server), once its copy of the file is this one's. */
  async function onMachine(ctx: OpCtx, m: Machine, rel: string, w: What, o: { account: string; allow: boolean; again: boolean }) {
    reachable(ctx, m)
    if (!m.vault || m.vault !== await plugin.ask<string>("machines:vault", "")) {
      throw new OpError(`${m.label} ${m.vault ? "has a vault of its own, not this one" : "doesn't say which vault it has (an older Vaultite)"}, so it can't open ${rel}`, 409)
    }
    await sameCopy(m, rel)
    const out = await passOn<{ handed?: boolean; running?: boolean }>(ctx, m, "terminal.run", { path: rel, ...w, open: false, ...(o.allow ? { allow: true } : {}),
      ...(o.account ? { account: o.account } : {}), ...(o.again ? { again: true } : {}) })
    return { id: out.id, handed: !!out.handed, running: !!out.running }
  }

  /** Machine `m` can be asked: it's online, and this call wasn't passed on from another machine (passed on once only). */
  function reachable(ctx: OpCtx, m: Machine) {
    if (ctx.who.client?.startsWith("machine/")) throw new OpError(`a call passed on from another machine runs where it's sent, not on ${m.label}`, 409)
    if (!m.online) throw new OpError(`${m.label} is offline`, 502)
  }

  /** Op `id` run by machine `m`'s server with `body` (it checks its owner again): its answer, its terminal named with
   *  the machine. */
  async function passOn<T>(ctx: OpCtx, m: Machine, id: string, body: object): Promise<T & { id: string }> {
    reachable(ctx, m)
    let r: Response
    try {
      r = await fetch(`${m.url}/api/ops/${id}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
    } catch {
      throw new OpError(`${m.label} doesn't answer`, 502)
    }
    let out: { id?: string; error?: string } = {}
    try { out = await r.json() as typeof out } catch { /* not JSON */ }
    if (r.status === 404 && !out.id) throw new OpError(`${m.label} runs an older Vaultite, without ${id}`, 409)
    if (!r.ok || !out.id) throw new OpError(`${m.label}: ${out.error || `answered ${r.status}`}`, r.ok ? 502 : r.status)
    return { ...out as T, id: `${out.id}@${m.id}` }
  }

  const vaultDir = () => { try { return fs.realpathSync(plugin.vault.path) } catch { return plugin.vault.path } }

  /** Starts it in a new terminal here: the agent with its prompt (told to report, with the Inbox on), or the command. */
  async function startHere(ctx: OpCtx, rel: string, w: What, account: string, allow: boolean): Promise<Started> {
    // A command comes from the vault, and a synced or shared vault mustn't pick what runs here: this machine says yes once.
    if (w.command && !plugin.allows(`command:${w.command}`)) {
      if (!allow) throw new OpError(`${COMMAND_UNSEEN} it runs \`${w.command}\`. Ask the user, then run it again with allow`, 409)
      plugin.allow(`command:${w.command}`)
    }
    const vars = { path: rel, file: path.join(vaultDir(), rel), title: path.basename(rel).replace(/\.md$/i, ""), vault: vaultDir() }
    if (w.agent) {
      const id = newTerminalId(account ? agentIn(w.agent.split("_")[0], account) : w.agent)
      const hand = w.report === false ? null : plugin.service("inbox:handed") as ((t: string) => void) | null
      await startAgent(ctx, id, fill(w.prompt || DEFAULT_PROMPT, vars) + (hand ? `\n\n${REPORT}` : ""))
      hand?.(id)
      return { id, handed: !!hand }
    }
    const id = newTerminalId()
    await ctx.api("POST", `terminals/${id}`)
    await ctx.api("POST", `terminals/${id}/send`, { text: fill(w.command!, vars, true), enter: true })
    return { id, handed: false }
  }

  /** Whether session `id` runs: here, or (id@machine) on that machine. */
  async function stillRuns(id: string) {
    const [own, machine] = id.split("@")
    if (!machine) return !!(await plugin.ask<boolean>("terminal:runs", false, own))
    return (await plugin.ask<string | null>("terminal:locate", null, own)) === machine
  }

  /** The sessions started here, by what they run (agent or command, prompt, file, account): asked the same again while
   *  one still runs, that one answers (a second click, a phone's double tap), unless asked `again`. */
  const started = new Map<string, Promise<Started>>()

  plugin.op({
    owner: "the terminal",
    id: "terminal.run",
    cli: "terminal run",
    summary: "Hand a file to a coding agent (Claude Code by default), or a shell command, in a new terminal on this machine or another.",
    help: `The agent is told the file's path, not its text, so it reads the latest version and can edit it: prompt (default
"${DEFAULT_PROMPT}"), where {path} is the file's vault path, {file} its full path, {title} its name and {vault} the
vault's folder. While the Inbox is on it works alone and ends with a report there (its terminal ends with that turn;
the user's reply resumes it), so it runs in the background unless asked to open; report false: neither. A command is
typed into a new shell with the same braces filled in (shell-quoted), and its tab opens. With machine, on another of
the Machines (one with this vault): its terminal is <id>@<machine>. With account, the agent runs in that one of its
accounts (Claude Code: its config folders). A vault plugin's schedule runs a note with it every morning.

  vau terminal run "Notes/Garden plan.md"
  vau terminal run Notes/Idea.md --agent codex --open
  vau terminal run Notes/Idea.md --machine studio --account personal`,
    kind: "write",
    lock: false, // starting a shell holds nothing of the vault
    params: {
      path: { type: "string", format: "path", required: true, description: "the file to hand over (Notes/Idea.md)" },
      agent: { type: "string", description: "the agent to run (claude, codex, opencode...; claude_personal: one of its accounts); claude when there's no command" },
      prompt: { type: "string", description: `what the agent is told, {path} and the like filled in (default: "${DEFAULT_PROMPT}")` },
      command: { type: "string", description: "a shell command to type into a new shell instead of an agent, {path} and the like filled in, shell-quoted" },
      report: { type: "boolean", description: "with the Inbox on, the agent ends with a report there and its terminal with it (default true)" },
      machine: { type: "string", description: "run it on another of the Machines, by its id (studio); this one when left out" },
      account: { type: "string", description: "the agent's account to run in (personal)" },
      open: { type: "boolean", description: "open its terminal's tab in the user's window (default: only when nothing comes back to the inbox)" },
      allow: { type: "boolean", description: "run a command this machine hasn't run before (ask the user first: a file or setting names it)" },
      again: { type: "boolean", description: "start another session even when the same run on this file still runs (else that one answers, running: true)" },
    },
    args: ["path"],
    run: async ({ path: rel, agent, prompt, command, report, machine, account, open, allow, again }, ctx) => {
      if (agent && command) throw new OpError("give an agent or a command, not both")
      const w: What = command ? { command } : { agent: agent || "claude", ...(prompt ? { prompt } : {}), ...(report === false ? { report } : {}) }
      if (w.agent && !TERMINAL_AGENT.test(w.agent)) throw new OpError(`'${w.agent}' isn't an agent's name (claude, codex, opencode...; claude_personal: one of its accounts)`)
      if (account && (!w.agent || !/^[a-z0-9]{1,32}$/.test(account))) throw new OpError(w.agent ? `'${account}' isn't an account's id` : "a command has no accounts")
      if (rel.startsWith("/") || rel.split("/").includes("..")) throw new OpError(`'${rel}' isn't a path in the vault`)
      try { if (!fs.statSync(plugin.vault.abs(rel)).isFile()) throw new Error() } catch { throw new OpError(`there's no file '${rel}'`, 404) }
      const m = await machineFor(machine)
      const key = JSON.stringify([w, rel, account ?? ""])
      let r: Started | null = null
      if (m) r = await onMachine(ctx, m, rel, w, { account: account ?? "", allow: !!allow, again: !!again })
      else if (!again && started.has(key)) {
        try { const was = await started.get(key)!; if (await stillRuns(was.id)) r = { ...was, running: true } } catch { /* it didn't start */ }
      }
      if (!r) {
        const p = startHere(ctx, rel, w, account ?? "", !!allow)
        started.set(key, p)
        p.catch(() => { if (started.get(key) === p) started.delete(key) })
        r = await p
      }
      if (!m) {
        keep.startedOn(r.id, rel)
        await keep.listNow().catch(() => {})
      }
      let shown = false
      if (open ?? !r.handed) {
        try { await show(ctx, r.id); shown = true } catch (e) {
          if (!(e instanceof OpError && e.status === 409)) throw e
        }
      }
      return { id: r.id, path: rel, ...(w.agent ? { agent: w.agent } : { command: w.command }), shown, handed: r.handed, ...(r.running ? { running: true } : {}),
        ...(m ? { machine: m.id } : {}), ...(account ? { account } : {}) }
    },
    text: (r) => `${r.running ? "Already running:" : "Started"} ${r.path} ${r.agent ? `with ${r.agent}` : "in a shell"}${r.account ? ` (${r.account})` : ""}${r.machine ? ` on ${r.machine}` : ""} in ${r.id}${r.shown ? "" : ` (${r.handed
      ? "in the background: its report comes to the inbox" : "no tab open"}; vau terminal screen ${r.machine ? `${r.id.split("@")[0]} on that machine` : r.id})`}.`,
    did: ({ path: rel, agent, command }) => ({ action: "run", text: `Handed ${rel} to ${command ? "a shell command" : agent || "claude"}` }),
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.ask",
    cli: "terminal ask",
    summary: "Ask a coding agent (Claude Code by default) something in a new terminal that runs in the background, here or on another machine.",
    help: `The agent starts with the prompt as its first message, in a terminal with no tab (open: show it): it's listed
with the others (vau terminal) and answers there. With machine, on another of the Machines (its terminal is
<id>@<machine>); with account, in that one of the agent's accounts; with model, that model (haiku, sonnet...). title:
the prompt's first words, until the agent names its session.

  vau terminal ask "What changed in the release notes this week?"
  vau terminal ask "Summarize Notes/Idea.md" --machine studio --account personal`,
    kind: "write",
    lock: false, // starting a shell holds nothing of the vault
    params: {
      prompt: { type: "string", required: true, description: "what to ask, the agent's first message" },
      agent: { type: "string", default: "claude", description: "the agent to ask (claude, codex, opencode...; claude_personal: one of its accounts)" },
      account: { type: "string", description: "the agent's account to run in (personal)" },
      machine: { type: "string", description: "ask on another of the Machines, by its id (studio); this one when left out" },
      model: { type: "string", description: "the model to run, for an agent that takes one (haiku, sonnet...); its default when left out" },
      open: { type: "boolean", description: "open its terminal's tab in the user's window (default false: in the background)" },
    },
    args: ["prompt"],
    run: async ({ prompt, agent, account, machine, model, open }, ctx) => {
      const said = prompt.trim()
      if (!said) throw new OpError("say what to ask")
      if (!TERMINAL_AGENT.test(agent)) throw new OpError(`'${agent}' isn't an agent's name (claude, codex, opencode...; claude_personal: one of its accounts)`)
      if (account && !/^[a-z0-9]{1,32}$/.test(account)) throw new OpError(`'${account}' isn't an account's id`)
      if (model && !MODEL_NAME.test(model)) throw new OpError(`'${model}' isn't a model's name`)
      const m = await machineFor(machine)
      let id: string
      if (m) id = (await passOn(ctx, m, "terminal.ask", { prompt: said, agent, ...(account ? { account } : {}), ...(model ? { model } : {}) })).id
      else {
        id = newTerminalId(account ? agentIn(agent.split("_")[0], account) : agent)
        await startAgent(ctx, id, said, model ? { model } : {})
      }
      let shown = false
      if (open) {
        try { await show(ctx, id); shown = true } catch (e) {
          if (!(e instanceof OpError && e.status === 409)) throw e
        }
      }
      return { id, agent, title: askTitle(said), shown, ...(m ? { machine: m.id } : {}), ...(account ? { account } : {}) }
    },
    text: (r) => `Asked ${r.agent}${r.account ? ` (${r.account})` : ""}${r.machine ? ` on ${r.machine}` : ""}: "${r.title}", in ${r.id}${r.shown ? "" : ` (in the background: vau terminal screen ${r.machine ? `${r.id.split("@")[0]} on that machine` : r.id})`}.`,
    did: ({ prompt, agent }) => ({ action: "run", text: `Asked ${agent} ${quoted(prompt, 60)}` }),
  })
}
