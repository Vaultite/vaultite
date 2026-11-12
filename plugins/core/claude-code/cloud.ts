// Cloud sessions for an account here, through Claude Code itself (no credential read): `claude --cloud` under `script`'s
// terminal (it starts none without one), `-p --cloud` to tell one, its stream-json control requests to read them.
import { type ChildProcessByStdio, execFile, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { Readable, Writable } from "node:stream"
import { lastTurn } from "../../../core/agents.ts"
import { gitEnv, OpError, type Plugin } from "../../../core/plugins.ts"
import { askingIn, Conversation, WANTED } from "./transcript.ts"

type Account = { id: string; dir: string; label: string; private: boolean }
const SESSION = /^session_\w{4,80}$/, REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/, BRANCH = /^[\w./-]{1,200}$/, COMMIT = /^[0-9a-f]{7,64}$/
/** A cloud session as its list says: running, idle, requires_action, archived, pending or failed. */
export type CloudSeen = { status: string; title: string; updated: number; branch?: string }
/** Its latest turn, from its transcript: as agent-turn's, with the question it waits on. */
export type CloudTurn = { prompt: string; text: string; at: number; final: boolean; files: string[]; asks?: { question: string; choices: string[] }[] }

const git = (cwd: string, args: string[]) => new Promise<string>((ok, fail) =>
  execFile("git", ["-C", cwd, ...args], { env: gitEnv(), timeout: 60_000, maxBuffer: 4 << 20 }, (e, out, err) => (e ? fail(new Error(String(err || e.message).trim().slice(0, 300))) : ok(String(out)))))
const plainText = (s: string) => s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, "").replace(/\x1b[()][\w]|\x1b[78=>]/g, "").replace(/\r/g, "")

export function cloudSessions(plugin: Plugin, o: { accounts: () => Account[]; bin: () => string | null; envOf: (a: Account) => NodeJS.ProcessEnv; trust: (a: Account, dir: string) => Promise<unknown> }) {
  const accountOf = (id: string) => {
    const a = o.accounts().find((x) => x.id === (id || "default"))
    if (!a) throw new OpError(`no Claude Code account '${id}' here (vau limits lists them)`, 404)
    return a
  }
  /** Why cloud sessions can't be started here, "" when they can: `script` gives `claude --cloud` the terminal it needs. */
  function unready(account: string) {
    if (process.platform === "win32") return "Windows has no `script` to start one with"
    if (!o.bin()) return "Claude Code isn't installed here"
    try { accountOf(account) } catch (e) { return (e as Error).message }
    return ""
  }

  // ---------- started: from a sparse checkout of its own (only what's on GitHub: never a checkout's unpushed work)
  const queue = new Map<string, Promise<unknown>>()
  async function start(account: string, s: { repo: string; branch: string; base: string; from: string; prompt: string }) {
    const why = unready(account)
    if (why) throw new OpError(`can't start a cloud session: ${why}`, 409)
    if (!REPO.test(s.repo) || !BRANCH.test(s.branch) || !COMMIT.test(s.base)) throw new OpError("a cloud session needs a GitHub repo (owner/name), a branch and the commit it starts from")
    const a = accountOf(account), dir = path.join(plugin.localDir(), "cloud", s.repo.replace("/", "__"))
    // (one at a time per repo: they share the folder)
    const run = (queue.get(dir) ?? Promise.resolve()).catch(() => {}).then(async () => {
      fs.mkdirSync(dir, { recursive: true })
      if (!fs.existsSync(path.join(dir, ".git"))) {
        await git(dir, ["init", "-q"])
        await git(dir, ["sparse-checkout", "set", "--no-cone", "/CLAUDE.md"])
      }
      await git(dir, ["remote", "remove", "origin"]).catch(() => {})
      await git(dir, ["remote", "add", "origin", `https://github.com/${s.repo}.git`])
      await git(dir, ["fetch", "-q", "--depth=1", "--no-tags", s.from, s.base])
      await git(dir, ["update-ref", `refs/heads/${s.branch}`, s.base])
      await git(dir, ["symbolic-ref", "HEAD", `refs/heads/${s.branch}`])
      await git(dir, ["update-ref", `refs/remotes/origin/${s.branch}`, s.base])
      await git(dir, ["read-tree", "-mu", "HEAD"])
      await o.trust(a, fs.realpathSync(dir))
      return await cloudStart(o.bin()!, { ...o.envOf(a), VAULTITE_TASK: s.prompt }, dir)
    })
    queue.set(dir, run)
    return await run
  }

  async function tell(account: string, session: string, text: string) {
    if (!SESSION.test(session)) throw new OpError(`'${session}' isn't a cloud session's id`)
    const bin = o.bin(), a = accountOf(account)
    if (!bin) throw new OpError("Claude Code isn't installed here", 409)
    const out = await new Promise<string>((ok) => {
      const p = execFile(bin, ["-p", "--cloud", session, "--output-format", "json"], { env: o.envOf(a), timeout: 60_000, maxBuffer: 1 << 20 }, (_e, so, se) => ok(`${so}\n${se}`))
      p.stdin?.end(text)
    })
    const r = (() => { try { return JSON.parse(out.trim().split("\n").find((l) => l.startsWith("{")) ?? "") } catch { return null } })() as { ok?: boolean; error?: string } | null
    if (!r?.ok) throw new OpError(`the cloud session didn't take it: ${r?.error ?? plainText(out).trim().split("\n").pop() ?? "no answer"}`, 502)
    return { submitted: true }
  }

  // ---------- read: one Claude Code per account kept running a minute after its last read, asked over its stdin
  const readers = new Map<string, Reader>()
  const readerOf = (a: Account) => {
    let r = readers.get(a.id)
    if (!r) { r = new Reader(o.bin()!, o.envOf(a), path.join(plugin.localDir(), "cloud")); readers.set(a.id, r) }
    return r
  }
  plugin.onUnload(() => { for (const r of readers.values()) r.close() })
  /** Each session's transcript lines read so far (user and assistant ones, the last 3000) and the cursor of its last page. */
  const pages = new Map<string, { lines: string[]; cursor?: string }>()
  let listed: { at: number; account: string; got: Record<string, CloudSeen> } | null = null

  async function read(account: string, ids: string[], turns: string[] = []) {
    const why = unready(account)
    if (why) throw new OpError(why, 409)
    const r = readerOf(accountOf(account))
    if (!listed || listed.account !== account || Date.now() - listed.at > 4000) {
      const got = await r.ask({ subtype: "list_cloud_sessions" }) as { status?: string; message?: string; sessions?: { id: string; title?: string; status?: string; updated_at?: string; branch?: string }[] }
      if (got?.status !== "ok") throw new OpError(got?.message ?? "Claude Code didn't list its cloud sessions", 502)
      listed = { at: Date.now(), account, got: Object.fromEntries((got.sessions ?? []).map((s) => [s.id, { status: s.status ?? "idle", title: s.title ?? "", updated: Date.parse(s.updated_at ?? "") || 0,
        ...(s.branch && BRANCH.test(s.branch) ? { branch: s.branch } : {}) }])) }
    }
    const sessions: Record<string, CloudSeen | null> = Object.fromEntries(ids.map((id) => [id, listed!.got[id] ?? null]))
    const out: Record<string, CloudTurn | null> = {}
    for (const id of turns.filter((x) => SESSION.test(x))) out[id] = await turnOf(r, id).catch(() => null)
    return { sessions, turns: out }
  }
  async function turnOf(r: Reader, id: string): Promise<CloudTurn | null> {
    const had = pages.get(id) ?? { lines: [] }
    let cursor = had.cursor, lines = had.lines, last: string[] = []
    for (let i = 0; i < 40; i++) {
      const got = await r.ask({ subtype: "get_cloud_session_transcript", session_id: id, ...(cursor ? { cursor } : {}) }) as { status?: string; entries?: unknown[]; next_cursor?: string }
      if (got?.status !== "ok") return null
      const page = (got.entries ?? []).map((e) => JSON.stringify(e)).filter((l) => WANTED.slice(0, 2).some((w) => l.includes(w)))
      if (!got.next_cursor) { last = page; break }
      // (a full page is kept; the last one is read again next time, from its cursor)
      lines = [...lines, ...page].slice(-3000)
      cursor = got.next_cursor
    }
    pages.set(id, { lines, ...(cursor ? { cursor } : {}) })
    const all = [...lines, ...last], c = new Conversation()
    for (const l of all) c.line(l)
    const t = lastTurn(c.entries), asking = askingIn(all.slice(-200).join("\n"))
    const asks = asking?.kind === "question" ? asking.questions.map((q) => ({ question: q.question, choices: q.multi ? [] : q.options.map((x) => x.label) })) : undefined
    return { ...t, ...(asks?.length ? { asks } : {}) }
  }

  plugin.provide("cloud-ready:claude", (account: string) => unready(account))
  plugin.provide("cloud-start:claude", start)
  plugin.provide("cloud-tell:claude", tell)
  plugin.provide("cloud-read:claude", read)
}

/** `claude --cloud "$VAULTITE_TASK"` in `cwd`, in a terminal `script` makes (it starts none without one): the session it
 *  printed, else why not, from its last words. */
function cloudStart(bin: string, env: NodeJS.ProcessEnv, cwd: string): Promise<{ session: string; url: string; title: string; note?: string }> {
  const args = process.platform === "darwin" ? ["-q", "/dev/null", bin, "--cloud", env.VAULTITE_TASK ?? ""]
    : ["-qec", `exec "$VAULTITE_CLAUDE" --cloud "$VAULTITE_TASK"`, "/dev/null"]
  return new Promise((ok, fail) => execFile("script", args, { cwd, env: { ...env, SHELL: "/bin/sh", VAULTITE_CLAUDE: bin }, timeout: 120_000, maxBuffer: 4 << 20 }, (e, so, se) => {
    const text = plainText(`${so}\n${se}`), m = /View:\s*(https:\/\/claude\.ai\/code\/(session_\w{4,80})\S*)/.exec(text)
    if (!m) return fail(new OpError(`claude --cloud started no session: ${text.trim().split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 400) || e?.message || "it said nothing"}`, 502))
    const note = /Branch \S+ is not on GitHub[^\n]*/.exec(text)?.[0]
    ok({ session: m[2], url: m[1].replace(/\?.*$/, ""), title: /Created cloud session:\s*(.+)/.exec(text)?.[1]?.trim() ?? "", ...(note ? { note } : {}) })
  }))
}

/** A `claude -p` in stream-json kept open to ask control requests of, closed a minute after the last one. */
class Reader {
  private p: ChildProcessByStdio<Writable, Readable, null> | null = null
  private waiting = new Map<string, (v: unknown) => void>()
  private n = 0
  private idle: ReturnType<typeof setTimeout> | undefined
  private bin: string
  private env: NodeJS.ProcessEnv
  private cwd: string
  constructor(bin: string, env: NodeJS.ProcessEnv, cwd: string) { this.bin = bin; this.env = env; this.cwd = cwd }
  private open() {
    fs.mkdirSync(this.cwd, { recursive: true })
    const p = spawn(this.bin, ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--strict-mcp-config"],
      { cwd: this.cwd, env: this.env, stdio: ["pipe", "pipe", "ignore"] })
    let buf = ""
    p.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf8")
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let m: { type?: string; response?: { request_id?: string; subtype?: string; response?: unknown; error?: string } }
        try { m = JSON.parse(line) } catch { continue }
        const r = m?.type === "control_response" ? m.response : null, done = r?.request_id ? this.waiting.get(r.request_id) : undefined
        if (!done) continue
        this.waiting.delete(r!.request_id!)
        done(r!.subtype === "success" ? r!.response ?? null : { status: "unavailable", message: r!.error ?? "refused" })
      }
    })
    const gone = () => { if (this.p === p) this.p = null; for (const done of this.waiting.values()) done(null); this.waiting.clear() }
    p.on("exit", gone)
    p.on("error", gone)
    p.stdin.on("error", () => {})
    this.p = p
    this.send("init", { subtype: "initialize" })
  }
  private send(id: string, request: object) { this.p?.stdin.write(`${JSON.stringify({ type: "control_request", request_id: id, request })}\n`) }
  ask(request: object, ms = 30_000): Promise<unknown> {
    if (!this.p) this.open()
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.close(), 60_000)
    this.idle.unref?.()
    const id = `r${++this.n}`
    return new Promise((ok) => {
      const t = setTimeout(() => { this.waiting.delete(id); ok(null) }, ms)
      this.waiting.set(id, (v) => { clearTimeout(t); ok(v) })
      this.send(id, request)
    })
  }
  close() { clearTimeout(this.idle); this.p?.kill(); this.p = null }
}
