import crypto from "node:crypto"
import path from "node:path"
import { choiceOf, HOME, repoName } from "../../../core/agents.ts"
import { byUser, type Machine, MACHINE_CLIENT, NOT_THE_USER, type Op, type OpCtx, OpError, type Plugin, splitMachine, userSurface } from "../../../core/plugins.ts"
import type { ChatCore } from "./chat.ts"
import { entryText } from "./chatentries.ts"
import type { Entry } from "./chatlog.ts"
import { EFFORTS, type Mode, MODES, type Summary } from "./chathost.ts"
import { IMAGES_PARAM, picturesFor } from "./chatpictures.ts"
import { MODE_LABELS } from "./chatsocket.ts"

type Needs = Pick<ChatCore, "start" | "send" | "hostedOr404" | "ask" | "answer" | "asking" | "runsAs" | "hello" | "hosted" | "keeper" | "titleOf" | "d">

export function chatOps(plugin: Plugin, c: Needs) {
  const { start, send, hostedOr404, ask, answer, asking, runsAs, hello, hosted, keeper, titleOf, d } = c

  const ID = { type: "string", required: true, description: "the session's id (vau chat list; <id>@<machine>: another machine's)" } as const

  /** An op on a session, which another machine's (`<id>@<machine>`) runs there, once (not passed on again). */
  function onMachines(def: Op) {
    plugin.op({ ...def, run: async (p, ctx) => {
      const [sid, at] = splitMachine(String(p.id ?? ""))
      const m = at ? await plugin.ask<Machine | null>("machines:machine", null, at) : null
      if (!at || m?.self) return def.run({ ...p, id: sid }, ctx)
      if (!m) throw new OpError(`no machine '${at}' (Machines lists them)`, 404)
      const out = await onMachine(ctx, m, def.id, { ...p, id: sid })
      return { ...out, ...(typeof out.id === "string" ? { id: `${out.id}@${m.id}` } : {}) }
    } })
  }
  /** An op of this plugin run on another machine (a call passed on from one runs where it's sent). */
  async function onMachine(ctx: { who: { client: string | null } }, m: Machine, op: string, body: Record<string, unknown>) {
    if (ctx.who.client?.startsWith("machine/")) throw new OpError(`a call passed on from another machine runs where it's sent, not on ${m.label}`, 409)
    if (!m.online) throw new OpError(`${m.label} is offline`, 502)
    let r: Response
    try {
      r = await fetch(`${m.url}/api/ops/${op}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
    } catch { throw new OpError(`${m.label} doesn't answer`, 502) }
    const out = await r.json().catch(() => ({})) as Record<string, unknown>
    if (!r.ok) throw new OpError(`${m.label}: ${String(out.error ?? `answered ${r.status}`)}`, r.status)
    return out
  }
  const OWNER = "Claude Code's chat"
  /** A session as chat-list gives it: its title too (another machine's knows its own). */
  type Listed = Summary & { title?: string }
  const line = (s: Listed) => `- ${s.id} · ${s.state}${s.asks.length ? " (asks)" : ""} · ${s.title || titleOf(s.id) || path.basename(s.cwd)} · ${d.modelName(s.model) || "default model"} · ${MODE_LABELS[s.mode] ?? s.mode}${s.account ? ` · ${s.account}` : ""}`
  const theUser = (ctx: OpCtx) => { if (!userSurface(ctx.who)) throw new OpError(NOT_THE_USER, 403) }

  /** Open its tab in the user's window: theirs at once, an agent's behind their tab with a toast. */
  async function show(ctx: OpCtx, id: string) {
    const path = `view:claude-session/${id}`
    try {
      if (byUser(ctx.who)) return void await ctx.ui({ action: "open", path, newTab: true })
      await ctx.ui({ action: "open", path, background: true })
      const who = ctx.who.label
      await ctx.ui({ action: "notify", text: `${who[0].toUpperCase()}${who.slice(1)} started a chat with Claude`, button: { label: "Show", open: path } })
    } catch (e) {
      if (!(e instanceof OpError && e.status === 409)) throw e
    }
  }

  plugin.op({
    id: "claude-code.chat-start", cli: "chat start", mcp: "chat_start", owner: OWNER, kind: "write", lock: false,
    summary: "Start a Claude Code chat session: run in the app (not a terminal), drawn in a chat tab, its questions and permissions answered there and in the inbox.",
    help: `It runs in the app's chat keeper, so it goes on when the server restarts, and it's a normal Claude Code session:
claude --resume <id> in a terminal opens the same conversation. account: one of Claude Code's accounts (its config
folders; vau chat start --help lists none: GET /api/claude-code/accounts); cwd: the folder it works in (the vault by
default); model (sonnet, opus, haiku, fable or a full id), effort (low to max) and mode (default, acceptEdits, plan,
auto, dontAsk, bypassPermissions; none: the account's permissions.defaultMode, else auto). open: show its tab (an agent's opens behind the user's, with a toast).

  vau chat start "Fix the flaky upload test" --cwd ~/code/lighthouse --model sonnet
  vau chat start "Plan the release" --mode plan --open`,
    params: {
      prompt: { type: "string", description: "its first message (none: it waits for one)" },
      cwd: { type: "string", description: "the folder it works in (default: the vault's)" },
      account: { type: "string", description: "the Claude Code account to run in (default: default)" },
      model: { type: "string", description: "sonnet, opus, haiku, fable, or a model's full id" },
      effort: { type: "string", enum: EFFORTS, description: "how hard it thinks" },
      mode: { type: "string", enum: MODES, description: "its permission mode (default: the account's permissions.defaultMode, else auto)" },
      open: { type: "boolean", description: "open its chat tab in the user's window" },
      images: IMAGES_PARAM,
    },
    args: ["prompt"],
    run: async (p, ctx) => {
      const uuid = crypto.randomUUID(), images = picturesFor(uuid, p.images)
      const s = await start({ prompt: p.prompt, cwd: p.cwd ? path.resolve(String(p.cwd).replace(/^~(?=$|\/)/, HOME)) : undefined, account: p.account,
        model: p.model, effort: p.effort, mode: p.mode, by: byUser(ctx.who) ? "app" : ctx.who.agent || ctx.who.client || "agent", ...(images.length ? { images, uuid } : {}) })
      if (p.open) await show(ctx, s.id)
      return { id: s.id, state: s.state, cwd: s.cwd, account: s.account }
    },
    text: (r) => `Started chat ${r.id} in ${r.cwd} (${r.account}): vau chat read ${r.id}.`,
    did: ({ prompt }) => ({ action: "run", text: prompt ? `Started a chat: ${String(prompt).slice(0, 60)}` : "Started a chat" }),
  })

  onMachines({
    id: "claude-code.chat-send", cli: "chat send", mcp: "chat_send", owner: OWNER, kind: "write", lock: false,
    summary: "Tell a Claude Code session something: straight into it while it runs in the app (queued during a turn), else it's resumed with it.",
    help: `While it asks something (a permission, a plan), the message is the answer: no, and do this instead; to questions,
a reply in their place. A session running in a terminal is answered there, not here.

  vau chat send 3f2a... "Also update the changelog"`,
    params: { id: ID, text: { type: "string", description: "what to say (none: only its pictures)" },
      model: { type: "string", description: "resuming it: the model to run" }, effort: { type: "string", enum: EFFORTS, description: "resuming it: its effort" },
      mode: { type: "string", enum: MODES, description: "resuming it: its permission mode" }, images: IMAGES_PARAM },
    args: ["id", "text"],
    run: async (p) => {
      const uuid = crypto.randomUUID(), images = picturesFor(uuid, p.images)
      return { id: p.id, ...(await send(p.id, String(p.text ?? ""), { model: p.model, effort: p.effort, mode: p.mode, ...(images.length ? { images, uuid } : {}) })) }
    },
    text: (r) => (r.answered ? "It was asking: that's its answer." : r.resumed ? "Resumed it with that." : "Sent."),
  })

  onMachines({
    id: "claude-code.chat-interrupt", cli: "chat interrupt", mcp: "chat_interrupt", owner: OWNER, kind: "write", lock: false,
    summary: "Stop a Claude Code chat session's turn, as Esc does in the terminal: what it was doing stops, the session stays.",
    help: `Messages sent while it worked that it hadn't started on are taken back (taken: each one's id, text and pictures, to
send again), as Esc gives them back in a terminal.`,
    params: { id: ID }, args: ["id"],
    run: async (p) => {
      hostedOr404(p.id)
      const r = await ask("interrupt", { id: p.id }) as { taken?: Extract<Entry, { k: "user" }>[] }
      return { id: p.id, taken: r.taken ?? [] }
    },
    text: (r) => `Interrupted.${r.taken.length ? ` Taken back, not sent: ${r.taken.map((e: Entry) => (e.k === "user" ? JSON.stringify(e.text) : "")).join(", ")}.` : ""}`,
  })

  onMachines({
    id: "claude-code.chat-answer", cli: "chat answer", owner: OWNER, kind: "write", lock: false,
    summary: "Answer what a Claude Code chat session asks: allow or deny a permission (always: and its rule), pick answers to its questions (or Chat about this), approve its plan or keep planning.",
    help: `The user's alone: from the app or their phone, never an agent nor vau. picks: one per question, an option's number
or name (several, comma-separated, in a multi-select) or text of its own; typed: what's typed in each one's Type
something row (with a multi-select's picks). chat: Chat about this, its questions put aside for it to ask what to
clarify. message: with a denial, what to do instead; with a plan sent back, what to change. mode: the permission mode
after an approved plan (acceptEdits, default...).`,
    params: {
      id: ID,
      ask: { type: "string", description: "which ask (its entry id); default: the newest" },
      allow: { type: "boolean", description: "allow the permission, approve the plan" },
      always: { type: "boolean", description: "with allow: its suggested rule too, so it isn't asked again" },
      picks: { type: "array", items: { type: "string" }, description: "the questions' answers, in order" },
      typed: { type: "array", items: { type: "string" }, commas: false, description: "with picks: what's typed in each question's Type something row (\"\" for none)" },
      chat: { type: "boolean", description: "Chat about this: its questions put aside" },
      message: { type: "string", description: "why not, or what to do instead" },
      mode: { type: "string", enum: MODES, description: "after an approved plan, the permission mode" },
    },
    args: ["id"],
    run: async (p, ctx) => {
      theUser(ctx)
      const qs = [...(asking.get(p.id)?.values() ?? [])].find((e) => !p.ask || e.id === p.ask)?.questions ?? []
      const typed = (p.typed ?? []) as string[]
      if (p.picks?.length && p.picks.length !== qs.length) throw new OpError(`picks: an answer for each of its ${qs.length} questions`)
      const answers = p.picks?.length ? (p.picks as string[]).map((x, i) => choiceOf(qs[i], x, typed[i] ?? "")) : undefined
      const s = await answer(p.id, { ...(p.allow !== undefined ? { allow: p.allow } : {}), ...(p.always ? { always: true } : {}), ...(p.chat ? { chat: true } : {}),
        ...(answers ? { answers } : {}), ...(p.message ? { message: p.message } : {}), ...(p.mode ? { mode: p.mode } : {}) }, p.ask)
      return { id: p.id, state: s.state }
    },
    text: () => "Answered.",
  })

  onMachines({
    id: "claude-code.chat-set", cli: "chat set", mcp: "chat_set", owner: OWNER, kind: "write", lock: false,
    summary: "Change how a Claude Code chat session runs from its next step: its model, effort or permission mode.",
    params: { id: ID, model: { type: "string", description: "sonnet, opus, haiku, fable, or a full id" },
      effort: { type: "string", enum: EFFORTS, description: "how hard it thinks" }, mode: { type: "string", enum: MODES, description: "its permission mode" } },
    args: ["id"],
    run: async (p) => {
      hostedOr404(p.id)
      if (!p.model && !p.effort && !p.mode) throw new OpError("`model`, `effort` or `mode`: what to change")
      const { s } = await ask("set", { id: p.id, ...(p.model ? { model: runsAs(p.model) } : {}), ...(p.effort ? { effort: p.effort } : {}), ...(p.mode ? { mode: p.mode } : {}) }) as { s: Summary }
      return { id: p.id, model: s.model, effort: s.effort, mode: s.mode }
    },
    text: (r) => `Now ${d.modelName(r.model) || "its model"}${r.effort ? `, ${r.effort} effort` : ""}, ${MODE_LABELS[r.mode as Mode] ?? r.mode}.`,
  })

  /** The sessions running in the app's chat here, on machine `at`, or on every machine (`all`): another's are <id>@<machine>. */
  async function chatList(at: string, ctx: { who: { client: string | null } }): Promise<{ sessions: Listed[]; away?: Record<string, string> }> {
    const here = async () => {
      await keeper(false).catch(() => null)
      return [...hosted.values()].map((s) => ({ ...s, title: titleOf(s.id) }))
    }
    if (at && at !== "all") {
      const m = await plugin.ask<Machine | null>("machines:machine", null, at)
      if (!m) throw new OpError(`no machine '${at}' (Machines lists them)`, 404)
      if (m.self) return { sessions: await here() }
      const r = await onMachine(ctx, m, "claude-code.chat-list", {}) as { sessions: Listed[] }
      return { sessions: r.sessions.map((s) => ({ ...s, id: `${s.id}@${m.id}` })) }
    }
    const sessions: Listed[] = await here()
    if (at !== "all") return { sessions }
    const others = (await plugin.ask<Machine[]>("machines", [])).filter((m) => !m.self && m.online && m.plugins?.includes("claude-code"))
    const away: Record<string, string> = {}
    await Promise.all(others.map((m) => onMachine(ctx, m, "claude-code.chat-list", {}).then(
      (r) => { sessions.push(...(r.sessions as Listed[]).map((s) => ({ ...s, id: `${s.id}@${m.id}` }))) },
      (e: Error) => { away[m.id] = e.message })))
    return { sessions, ...(Object.keys(away).length ? { away } : {}) }
  }

  // Every machine's chats, for the Agents panel (polled while it shows): a route, so a look isn't an op call in Activity.
  plugin.route("GET", "claude-code/chats", async (req) => {
    await plugin.ownerOnly(req, OWNER)
    const client = req.http?.headers["x-vaultite-client"]
    const r = await chatList("all", { who: { client: typeof client === "string" ? client : null } })
    // (a turn's words cut to what a row can say: a list polled every few seconds)
    const progress = plugin.service("inbox:progress") as ((t: string, s: string) => string | null) | null
    return { ...r, sessions: r.sessions.map((s) => {
      const said = progress?.("", splitMachine(s.id)[0]) ?? null
      // (its repository named here, where its folder is: another machine's says its own)
      const project = (s as { project?: string }).project ?? (s.id.includes("@") ? "" : repoName(s.cwd))
      return { ...s, turn: s.turn && { prompt: s.turn.prompt.slice(0, 200), text: s.turn.text.slice(-200), error: s.turn.error }, ...(said ? { progress: said } : {}), ...(project ? { project } : {}) }
    }) }
  }, { sync: false })

  plugin.op({
    id: "claude-code.chat-list", cli: "chat list", mcp: "chat_list", owner: OWNER, kind: "read", lock: false,
    summary: "The Claude Code sessions running in the app's chat now: each one's state, what it asks, folder, model and mode; machine all: every machine's.",
    help: `Claude Code sessions the app runs itself, through the Agent SDK, not in a terminal: chat tabs, the companion, and the
sessions a companion's job or an inbox reply resumes. So vau terminal doesn't list them. machine names another of the
Machines (its sessions are <id>@<machine>), all every machine's.

  vau chat list
  vau chat list --machine all`,
    params: { machine: { type: "string", description: "another of the Machines, by its id (studio), or all: every machine's" } },
    run: ({ machine }, ctx) => chatList(String(machine ?? ""), ctx),
    text: (r) => (r.sessions.length ? r.sessions.map(line).join("\n") : "No chat sessions are running.") +
      Object.entries((r.away ?? {}) as Record<string, string>).map(([k, v]) => `\n${k}: ${v}`).join(""),
  })

  onMachines({
    id: "claude-code.chat-read", cli: "chat read", mcp: "chat_read", owner: OWNER, kind: "read", lock: false,
    summary: "A Claude Code session's conversation as the chat tab shows it: what was said, each tool call, what it asks now.",
    params: { id: ID, limit: { type: "number", description: "how many of the newest entries (default 30)" } },
    args: ["id"],
    run: async (p) => {
      const h = await hello(p.id)
      if (!h.found) throw new OpError(`no session ${p.id} on this machine (or it's in a private account)`, 404)
      return { id: p.id, title: h.title, cwd: h.cwd, state: h.s?.state ?? (h.tui !== null ? "in a terminal" : "ended"), entries: h.history.entries.slice(-(Number(p.limit) || 30)) }
    },
    text: (r) => [`# ${r.title || "Chat"} (${r.state})`, ...r.entries.map(entryText).filter(Boolean)].join("\n\n"),
  })

  onMachines({
    id: "claude-code.chat-stop", cli: "chat stop", mcp: "chat_stop", owner: OWNER, kind: "write", lock: false,
    summary: "End a Claude Code chat session's process (what it was doing stops); the conversation stays, to resume with a message or in a terminal.",
    params: { id: ID }, args: ["id"],
    run: async (p) => {
      const s = hosted.get(p.id)
      if (!s) return { id: p.id, stopped: false }
      if (s.state === "error") await ask("forget", { id: p.id })
      else await ask("stop", { id: p.id })
      return { id: p.id, stopped: true }
    },
    text: (r) => (r.stopped ? "Stopped; claude --resume " + r.id + " opens it in a terminal." : "It wasn't running."),
  })
}
