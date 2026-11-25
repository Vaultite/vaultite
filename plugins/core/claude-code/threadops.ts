import path from "node:path"
import { logger, OpError, type Plugin } from "../../../core/plugins.ts"
import type { Summary } from "./chatprotocol.ts"
import { parseDiff } from "./diffparse.ts"
import { harnessOps } from "./harnessops.ts"
import { GIT_ACTIONS, gitAction, isGitAction, tidyThread } from "./threadgit.ts"
import { checkpoint, GitError, isSource, patchOf, repoOf, snapshot, type Thread, threadFor, turnsOf } from "./threads.ts"
const log = logger("threads")

type Needs = { cwdOf: (id: string) => Promise<string>; busy: (id: string) => boolean; vault: () => string }
const ID = { type: "string", required: true, description: "the chat session's id (vau chat list)" } as const
const inside = (dir: string, folder: string) => { const r = path.relative(folder, dir); return !r.startsWith("..") && !path.isAbsolute(r) }
async function asOp<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (e) { throw e instanceof GitError ? new OpError(e.message, 409) : e }
}

type Store = { all: () => Record<string, Thread>; put: (id: string, t: Thread | null) => void }
const ENDS = new Set(["idle", "error"]), TURNS = new Set(["working", "starting", "waiting"])

function turnKeeper({ all, put }: Store) {
  const queue = new Map<string, Promise<void>>()
  const inTurn = (id: string, fn: () => Promise<void>) => {
    const p = (queue.get(id) ?? Promise.resolve()).then(fn).catch((e) => log.error("a thread's checkpoint", e, { id }))
    queue.set(id, p)
    return p
  }
  const next = async (t: Thread, id: string) => { const turns = await turnsOf(t.dir, id); await checkpoint(t.dir, id, (turns.at(-1) ?? 0) + 1) }
  const was = new Map<string, string>(), missed = new Map<string, number>()
  async function record(id: string, p: { t: Thread; at: string }) {
    put(id, p.t)
    await inTurn(id, async () => { await checkpoint(p.t.dir, id, 0, p.at) })
    if (missed.delete(id)) await inTurn(id, () => next(p.t, id))
  }
  function heard(id: string, s: Summary | null) {
    const before = was.get(id) ?? "", now = s?.state ?? "closed"
    was.set(id, now)
    if (!ENDS.has(now) || !TURNS.has(before)) return
    const t = all()[id]
    if (t) return void inTurn(id, () => next(t, id))
    for (const [k, at] of missed) if (Date.now() - at > 60_000) missed.delete(k)
    missed.set(id, Date.now())
  }
  return { record, heard }
}

function lookup(n: Needs, all: Store["all"]) {
  async function threadOf(id: string): Promise<Thread | null> {
    const t = all()[id]
    if (t) return t
    const cwd = await n.cwdOf(id), repo = cwd && !inside(cwd, n.vault()) ? await repoOf(cwd) : null
    return repo ? { repo, dir: repo, cwd, branch: "", base: "HEAD", worktree: false } : null
  }
  async function needThread(id: string) {
    const t = await threadOf(id)
    if (!t) throw new OpError("its folder isn't in a git repository", 404)
    return t
  }
  return { threadOf, needThread }
}

function sweeper(n: Needs, { all, put }: Store) {
  return async function sweep() {
    const out: Record<string, string> = {}
    for (const [id, t] of Object.entries(all())) {
      if (n.busy(id)) continue
      let r = "open"
      try { r = await tidyThread(t, id) } catch (e) { log.error("tidying a thread's worktree", e, { id }) }
      if (r === "removed" || r === "gone") put(id, null)
      if (r !== "open") out[id] = r
    }
    return out
  }
}

export function codeThreads(plugin: Plugin, n: Needs) {
  const all = () => plugin.kept<Record<string, Thread>>("threads", {})
  const put = (id: string, t: Thread | null) => { const m = all(); if (t) m[id] = t; else delete m[id]; plugin.keep("threads", m) }
  const { record, heard } = turnKeeper({ all, put }), { threadOf, needThread } = lookup(n, all), sweep = sweeper(n, { all, put })
  async function prepare(cwd: string | undefined, said: string, worktree: boolean) {
    if (!cwd || inside(cwd, n.vault())) return null
    const t = await asOp(() => threadFor(cwd, said, worktree))
    return t ? { t, at: await snapshot(t.dir) } : null
  }
  tidyEvery(plugin, sweep)
  harnessOps(plugin)
  threadOps(plugin, { needThread, threadOf, sweep, turns: (t, id) => turnsOf(t.dir, id) })
  return { prepare, record, heard, threadOf }
}

function tidyEvery(plugin: Plugin, sweep: () => Promise<Record<string, string>>) {
  const tidying = setInterval(() => void sweep(), 10 * 60_000)
  tidying.unref?.()
  setTimeout(() => void sweep(), 30_000).unref?.()
  plugin.onUnload(() => clearInterval(tidying))
}

type Ops = { needThread: (id: string) => Promise<Thread>; threadOf: (id: string) => Promise<Thread | null>; sweep: () => Promise<Record<string, string>>
  turns: (t: Thread, id: string) => Promise<number[]> }

const OWNER = "Claude Code's chat"
function threadOps(plugin: Plugin, o: Ops) {
  plugin.op({
    id: "claude-code.chat-thread", cli: "chat thread", owner: OWNER, kind: "read", lock: false,
    summary: "A chat session's checkout: its repository, worktree folder, branch, and the turns it has checkpoints of.",
    params: { id: ID }, args: ["id"],
    run: async (p) => {
      const t = await o.threadOf(p.id)
      if (!t) return { id: p.id, git: false }
      return { id: p.id, git: true, repo: t.repo, dir: t.dir, cwd: t.cwd, branch: t.branch, worktree: t.worktree, turns: (await o.turns(t, p.id)).filter((x) => x > 0) }
    },
    text: (r) => ("dir" in r ? `${r.worktree ? "Worktree" : "Checkout"} ${r.dir}${r.branch ? ` on ${r.branch}` : ""}` : "Not in a git repository."),
  })

  plugin.op({
    id: "claude-code.chat-diff", cli: "chat diff", owner: OWNER, kind: "read", lock: false,
    summary: "What a chat session changed in its checkout, as files and hunks: all since it started, its latest turn's, turn N's, or what isn't committed.",
    help: `source: all (since the thread started, uncommitted changes too), latest (its last turn's), turn:N, uncommitted.

  vau chat diff 3f2a... --source latest`,
    params: { id: ID, source: { type: "string", description: "all, latest, turn:N or uncommitted (default: all)" } },
    args: ["id"],
    run: async (p) => {
      const source = String(p.source ?? "all")
      if (!isSource(source)) throw new OpError(`source: all, latest, turn:N or uncommitted, not '${source}'`)
      const t = await o.needThread(p.id)
      const { patch, truncated } = await asOp(() => patchOf(t, p.id, source))
      return { id: p.id, source, branch: t.branch, dir: t.dir, worktree: t.worktree, turns: (await o.turns(t, p.id)).filter((x) => x > 0), truncated, files: parseDiff(patch) }
    },
    text: (r) => (r.files.length ? r.files.map((f) => `${f.path} +${f.added} -${f.removed}`).join("\n") : "No changes."),
  })

  threadWrites(plugin, o)
}

function threadWrites(plugin: Plugin, o: Ops) {
  plugin.op({
    id: "claude-code.chat-git", cli: "chat git", owner: OWNER, kind: "write", lock: false,
    summary: "Act on a chat session's checkout: commit everything in it, push its branch, or open a pull request from it (gh).",
    params: { id: ID, action: { type: "string", enum: GIT_ACTIONS, required: true, description: "commit, push or pr" },
      message: { type: "string", description: "commit: its message" }, title: { type: "string", description: "pr: its title (default: from the commits)" },
      body: { type: "string", description: "pr: its description" } },
    args: ["id", "action"],
    run: async (p) => {
      const t = await o.needThread(p.id), action = String(p.action)
      if (!isGitAction(action)) throw new OpError(`action: commit, push or pr, not '${action}'`)
      return { id: p.id, ...(await asOp(() => gitAction(t, action, p))) }
    },
    text: (r) => r.text,
    did: (p) => ({ action: "run", text: `Ran ${String(p.action)} on a chat's checkout` }),
  })

  plugin.op({
    id: "claude-code.chat-tidy", cli: "chat tidy", owner: OWNER, kind: "write", lock: false,
    summary: "Remove chat threads' worktrees whose branch is merged or deleted and that have nothing uncommitted (also done every 10 minutes).",
    run: async () => ({ threads: await o.sweep() }),
    text: (r) => Object.entries(r.threads).map(([id, s]) => `${id}: ${s}`).join("\n") || "Nothing to tidy.",
    did: () => ({ action: "run", text: "Tidied chat threads' worktrees" }),
  })
}
