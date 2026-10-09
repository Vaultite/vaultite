// Terminal's operations (`vau terminal`), through the plugin's own routes, Workspaces' and the user's window, so they
// can do what the routes allow and nothing more.
import { startAgent } from "../../../core/codingagents.ts"
import { AGENT, newTerminalId, parseTerminal, resumeTerminalId } from "../../../core/terminalids.ts"
import { OpError, type OpCtx, type Plugin } from "../../../core/plugins.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
type Session = { id: string; agent: string | null; process: string; clients: number; started: number; title?: string; state?: string; backend?: string }
type TabAt = { workspace: number; tab: string }

/** A new session id, like the app's (8 letters and digits). */
/** An id that starts a new agent's session (`claude-k3j2h1g0`, `claude_personal-k3j2h1g0`): a tab showing one that's
 *  gone offers a new one, it never starts again by itself. Plain shells (`k3j2h1g0`) start again; resumes resume. */
const freshAgent = (id: string) => { const t = parseTerminal(id); return !!t && !t.resume && !t.machine }

async function sessions(ctx: OpCtx): Promise<Session[]> {
  return (await ctx.api("GET", "terminals/sessions")).sessions
}

/** Where each terminal is shown: terminal id -> its tabs (Workspaces' layouts; none without Workspaces). */
async function tabsOf(ctx: OpCtx): Promise<Map<string, TabAt[]>> {
  const out = new Map<string, TabAt[]>()
  let ws: unknown[] = []
  try { ws = (await ctx.api("GET", "workspaces")).workspaces ?? [] } catch (e) { if (!(e instanceof OpError)) throw e }
  ws.forEach((w, i) => {
    const walk = (x: Any) => {
      if (!x || typeof x !== "object") return
      if (Array.isArray(x.kids)) return void x.kids.forEach(walk)
      for (const t of Array.isArray(x.tabs) ? x.tabs : []) {
        const m = typeof t?.to === "string" ? /^view:terminal\/(.+)$/.exec(t.to) : null
        if (m) out.set(m[1], [...(out.get(m[1]) ?? []), { workspace: i + 1, tab: String(t.id) }])
      }
    }
    walk((w as Any)?.layout?.root)
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

/** Show terminal `to` in the user's window: a new tab, or a split. */
async function show(ctx: OpCtx, to: string, split: "right" | "down" | null) {
  try {
    await ctx.ui({ action: "open", path: `view:terminal/${to}`, ...(split ? { split } : {}), newTab: !split })
  } catch (e) {
    if (e instanceof OpError && e.status === 409) throw new OpError(`no app window is open: open the app first (the session is running: vau terminal screen ${to})`, 409)
    throw e
  }
}

/** A terminal id as given (or a tab's address), this machine's. */
function localId(raw: string) {
  const x = raw.trim().replace(/^view:terminal\//, "")
  if (x.includes("@")) throw new OpError(`${x} is another machine's terminal: ask its server (vau --url <its address> terminal ...)`)
  return x
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}
const where = (tabs: TabAt[] | undefined) => (tabs?.length ? `tab in workspace ${[...new Set(tabs.map((t) => t.workspace))].join(", ")}` : "no tab")
const SPLIT = { type: "string", enum: ["right", "down"], description: "in a pane beside (right) or below (down) the current one, not a new tab" } as const
const ID = { type: "string", required: true, description: "the terminal's id (vau terminal lists them)" } as const

export function terminalOps(plugin: Plugin) {
  plugin.op({
    owner: "the terminal",
    id: "terminal.list",
    cli: "terminal",
    summary: "The app's terminals on this machine: each session (what runs in it, its title, its tabs), then tabs whose session is gone.",
    help: `The Terminal plugin's sessions on the machine the server runs on: shells and coding agents (Claude Code, Codex...),
kept running apart from the server (Vaultite's own keeper, tmux, or herdr), so they outlive the app. A terminal's id
names what it runs: <agent>-<id> a new session of that agent, resume-<agent>-<session id> an agent's session resumed in
its folder, anything else a shell. Another machine's terminals (id@machine) are that machine's: ask its server (--url).
After the sessions, the tabs whose terminal is gone: an agent's (it won't start again by itself: it says
its session ended, with Restart; terminal.tidy closes them) or a
shell's (a new shell when shown). The others: vau terminal open|resume|screen|send|end|tidy.

  vau terminal`,
    kind: "read",
    run: async (_p, ctx) => {
      const [ss, tabs] = await Promise.all([sessions(ctx), tabsOf(ctx)])
      const live = new Set(ss.map((s) => s.id))
      const gone = [...tabs].filter(([t]) => !t.includes("@") && !live.has(t)).map(([t, at]) => ({ id: t, tabs: at, agent: freshAgent(t) }))
      return { sessions: ss.map((s) => ({ ...s, tabs: tabs.get(s.id) ?? [] })), gone }
    },
    text: (r) => {
      const rows = (r.sessions as (Session & { tabs: TabAt[] })[]).map((s) => `${s.id}  ${s.process || "-"}${s.state ? ` (${s.state})` : ""}${s.title ? `  "${s.title}"` : ""}  ${ago(s.started)} ago, ${where(s.tabs)}${s.backend === "pty" ? " (in the server: a restart ends it)" : ""}`)
      const gone = (r.gone as { id: string; tabs: TabAt[]; agent: boolean }[]).map((o) => `${o.id}  gone, ${where(o.tabs)}${o.agent ? " (an agent's: vau terminal tidy closes it)" : " (a new shell when shown)"}`)
      return (rows.length ? rows.join("\n") : "(no terminal sessions on this machine)") + (gone.length ? `\n\nTabs with no session:\n${gone.join("\n")}` : "")
    },
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.open",
    cli: "terminal open",
    summary: "Open a new terminal in a tab of the user's window: a shell, or a coding agent (claude, codex...).",
    help: `The session starts first, so it runs even with no window open (then its tab can't be shown: vau terminal screen
reads it). An agent with accounts starts in one with <agent>_<account> (claude_personal).

  vau terminal open
  vau terminal open claude --split right`,
    kind: "write",
    lock: false, // starting a shell holds nothing of the vault
    params: {
      agent: { type: "string", description: "the agent to run (claude, codex, opencode...; claude_personal: one of its accounts); none: a shell" },
      split: SPLIT,
    },
    args: ["agent"],
    run: async ({ agent, split }, ctx) => {
      if (agent && !AGENT.test(agent)) throw new OpError(`'${agent}' isn't an agent's name (claude, codex, opencode...; claude_personal: one of its accounts)`)
      const t = newTerminalId(agent)
      const r = agent ? await startAgent(ctx, t) : await ctx.api("POST", `terminals/${t}`)
      await show(ctx, t, split ?? null)
      return { ...r, id: t }
    },
    text: (r, p) => `Opened ${r.id}${p.agent ? ` (${p.agent})` : ""}.`,
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
      await show(ctx, t, split ?? null)
      return { id: t, session: sid, title }
    },
    text: (r) => `Resumed ${r.title ? `"${r.title}" ` : ""}in ${r.id}.`,
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.screen",
    cli: "terminal screen",
    summary: "What a terminal shows now, as text, and the lines above it.",
    help: "  vau terminal screen claude-k3j2h1g0 --lines 20",
    kind: "read",
    params: { id: ID, lines: { type: "integer", minimum: 1, maximum: 5000, default: 50, description: "how many lines, the screen's last ones and those above" } },
    args: ["id"],
    run: async ({ id, lines }, ctx) => await ctx.api("GET", `terminals/${encodeURIComponent(localId(id))}/screen?lines=${lines}`),
    text: (r) => (r.lines as string[]).join("\n"),
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.send",
    cli: "terminal send",
    summary: "Type text into a terminal, then Enter (noEnter: not). The text goes as typed, not as keys.",
    help: `  vau terminal send k3j2h1g0 "npm test"
  vau terminal send claude-k3j2h1g0 "yes" --no-enter`,
    kind: "write",
    lock: false,
    params: {
      id: ID,
      text: { type: "string", description: "what to type" },
      noEnter: { type: "boolean", description: "don't press Enter after it" },
    },
    args: ["id", "text"],
    run: async ({ id, text, noEnter }, ctx) => {
      const t = localId(id), enter = !noEnter
      if (!text && !enter) throw new OpError("give the text to type")
      return await ctx.api("POST", `terminals/${encodeURIComponent(t)}/send`, { text: text ?? "", enter })
    },
    text: (r, p) => `Typed into ${r.id}${p.text ? `: ${p.text.length > 60 ? `${p.text.slice(0, 60)}…` : p.text}` : ""}${r.enter ? " (Enter)" : ""}.`,
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.end",
    cli: "terminal end",
    summary: "End a terminal's session for good (like its tab's End session) and close its tabs everywhere (keepTabs: not); without an id, your own.",
    help: `An agent asked to close itself runs it last, without an id: its session ends and its tab closes (tell the user
what you did first: the tab and what's in it go).

  vau terminal end claude-k3j2h1g0
  vau terminal end`,
    kind: "destructive",
    params: {
      id: { type: "string", env: "VAULTITE_TERMINAL", description: "the terminal's id (vau terminal lists them); left out, the one you run in (VAULTITE_TERMINAL)" },
      keepTabs: { type: "boolean", description: "leave its tabs open, saying the session ended (with Restart)" },
    },
    args: ["id"],
    run: async ({ id, keepTabs }, ctx) => {
      if (!id) throw new OpError("which terminal? give its id (vau terminal lists them): you don't run in one of the app's")
      const t = localId(id)
      const r = await ctx.api("DELETE", `terminals/${encodeURIComponent(t)}${keepTabs ? "?keep=1" : ""}`)
      return { ...r, closedTabs: keepTabs ? 0 : await closeTabs(ctx, t) }
    },
    text: (r) => `Ended ${r.id}${r.closedTabs ? `, closed its tab${r.closedTabs === 1 ? "" : "s"}` : ""}.`,
  })

  plugin.op({
    owner: "the terminal",
    id: "terminal.tidy",
    cli: "terminal tidy",
    summary: "Close the tabs whose agent's session is gone (an ended Claude Code, a machine restarted); shells' tabs stay.",
    help: `An agent's session that ends by itself keeps its tabs (saying it ended, with Restart) until you close them or
run this.

  vau terminal tidy`,
    kind: "write",
    params: { id: { type: "string", description: "only this terminal's tabs" } },
    run: async ({ id }, ctx) => {
      const [ss, tabs] = await Promise.all([sessions(ctx), tabsOf(ctx)])
      const live = new Set(ss.map((s) => s.id))
      const dead = [...tabs.keys()].filter((t) => !t.includes("@") && !live.has(t) && freshAgent(t) && (!id || t === id))
      let closed = 0
      for (const t of dead) closed += await closeTabs(ctx, t)
      return { closed: dead, tabs: closed }
    },
    text: (r) => (r.closed.length ? `Closed ${r.tabs} tab${r.tabs === 1 ? "" : "s"} of gone sessions: ${r.closed.join(", ")}.` : "No tabs of gone sessions."),
  })
}
