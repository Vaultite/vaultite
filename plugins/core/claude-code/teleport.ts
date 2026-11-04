// A Claude Code on the web session continued here (`claude --teleport`) in a terminal, in the account signed in to its
// organization, in a worktree beside a checkout of its repository: none of the user's checkouts changes branch.
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { byUser, type OpCtx, OpError, type Plugin } from "../../../core/plugins.ts"
import { resumeTerminalId } from "../../../core/agents.ts"
import { gitEnv } from "../../../core/gitenv.ts"
import { type Item } from "../../../core/vault.ts"

type Account = { id: string; dir: string; label: string; private: boolean }
const SESSION = /^session_\w{4,80}$/
const REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/
const BRANCH = /^[\w./-]{1,200}$/

const git = (cwd: string, ...args: string[]) => new Promise<string>((ok, fail) =>
  execFile("git", ["-C", cwd, ...args], { env: gitEnv(), timeout: 30_000, maxBuffer: 4 << 20 }, (e, out, err) => (e ? fail(new Error(String(err || e.message).trim())) : ok(String(out)))))

/** The claude.ai organization an account is signed in to (its .claude.json's), or "". */
function orgOf(a: Account, json: (a: Account) => string) {
  try { return String((JSON.parse(fs.readFileSync(json(a), "utf8")) as Item).oauthAccount?.organizationUuid ?? "") } catch { return "" }
}

/** Whether `remotes` (git remote -v) name GitHub's `repo`. */
const names = (remotes: string, repo: string) => remotes.split("\n").some((l) => {
  const u = l.split(/\s+/)[1] ?? ""
  return new RegExp(`github\\.com[:/]${repo.replace(/[.]/g, "\\.")}(\\.git)?/?$`, "i").test(u)
})

/** A folder in one spelling, to compare and hand on: Windows' git says C:/a/b, its temp folder may be C:\Users\RUNNER~1. */
const real = (p: string) => { const r = path.resolve(p); try { return fs.realpathSync.native(r) } catch { return r } }
const same = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b)

/** A checkout of `repo` among `roots` (the projects Claude Code ran in lately, most recent first): a main one first. */
export async function checkoutOf(repo: string, roots: string[]) {
  const found: { root: string; main: boolean }[] = []
  for (const r of roots.slice(0, 80)) {
    try {
      const top = real((await git(r, "rev-parse", "--show-toplevel")).trim())
      if (found.some((f) => same(f.root, top)) || !names(await git(top, "remote", "-v"), repo)) continue
      found.push({ root: top, main: fs.statSync(path.join(top, ".git")).isDirectory() })
      if (found.at(-1)!.main) break
    } catch { /* not a checkout */ }
  }
  return found.find((f) => f.main)?.root ?? found[0]?.root ?? null
}

/** The worktree to teleport in: the one that has `branch` already (it was continued here before), else a new one beside
 *  the checkout, named for the branch (megaset-vibrant-pasteur-7o0vgx) or the session. */
export async function worktreeFor(checkout: string, session: string, branch: string | undefined) {
  const root = real(checkout), list = await git(root, "worktree", "list", "--porcelain")
  const where = (block: string) => { const l = block.split("\n").find((x) => x.startsWith("worktree ")); return l ? real(l.slice(9).trim()) : null }
  if (branch) {
    const p = where(list.split("\n\n").find((b) => b.split("\n").includes(`branch refs/heads/${branch}`)) ?? "")
    if (p && fs.existsSync(p)) return p
  }
  const tail = (branch?.split("/").pop() || session.slice(-8)).toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60)
  const dir = path.join(path.dirname(root), `${path.basename(root)}-${tail}`)
  if (fs.existsSync(dir)) {
    if (list.split("\n\n").some((b) => { const w = where(b); return !!w && same(w, real(dir)) })) return real(dir)
    throw new OpError(`${dir} is there already and isn't a worktree of ${path.basename(root)}: give cwd`, 409)
  }
  await git(root, "worktree", "add", "--detach", dir)
  return real(dir)
}

export function teleports(plugin: Plugin, o: { accounts: () => Account[]; json: (a: Account) => string; roots: () => Promise<string[]> }) {
  // Which accounts are signed in to which claude.ai organization: the Cloud sessions panel continues a session here
  // only when one is.
  plugin.route("GET", "claude-code/organizations", () => o.accounts().map((a) => ({ account: a.id, org: orgOf(a, o.json) })).filter((x) => x.org))

  plugin.op({
    id: "claude-code.teleport", cli: "teleport", owner: "Claude Code on this machine", kind: "write", lock: false,
    summary: "Continue a Claude Code on the web session here, in a terminal tab: claude --teleport, in a worktree of its repository.",
    help: `session is its id (session_...) or its claude.ai/code address. It runs in the account named, else the one signed in
to org (its claude.ai organization's id), else the default. repo (owner/name) is checked out from a checkout of it
among the folders Claude Code ran in lately, into a worktree beside it named for branch, so none of yours changes;
cwd instead names the folder. title names the terminal.

  vau teleport session_01AbC --repo lighthouse/web --branch claude/fix-build --org 1b2c...`,
    params: {
      session: { type: "string", required: true, description: "the cloud session: its id (session_...) or claude.ai/code address" },
      account: { type: "string", description: "the Claude Code account to continue it in" },
      org: { type: "string", description: "its claude.ai organization's id: the account signed in to it" },
      repo: { type: "string", description: "its GitHub repository, owner/name" },
      branch: { type: "string", description: "its branch: the worktree it was continued in before is used again" },
      cwd: { type: "string", description: "the folder to continue it in instead (a checkout of its repository, clean)" },
      title: { type: "string", description: "the terminal's name (its title)" },
    },
    args: ["session"],
    run: async (p, ctx: OpCtx) => {
      const sid = /session_\w{4,80}/.exec(String(p.session ?? ""))?.[0] ?? ""
      if (!SESSION.test(sid)) throw new OpError(`'${p.session}' isn't a cloud session's id or address`)
      const all = o.accounts()
      let a = p.account ? all.find((x) => x.id === p.account) : undefined
      if (p.account && !a) throw new OpError(`no Claude Code account '${p.account}' here (${all.map((x) => x.id).join(", ")})`, 404)
      if (!a && p.org) {
        a = all.find((x) => orgOf(x, o.json) === p.org)
        if (!a) throw new OpError("no Claude Code account on this machine is signed in to that claude.ai account: sign in with /login in one", 404)
      }
      let cwd = p.cwd ? path.resolve(String(p.cwd)) : ""
      if (cwd && !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new OpError(`there's no folder ${cwd}`, 404)
      if (!cwd && p.repo) {
        if (!REPO.test(String(p.repo))) throw new OpError(`'${p.repo}' isn't a repository (owner/name)`)
        const root = await checkoutOf(String(p.repo), await o.roots())
        if (!root) throw new OpError(`there's no checkout of ${p.repo} on this machine: clone it, then continue the session again`, 404)
        try { cwd = await worktreeFor(root, sid, p.branch && BRANCH.test(String(p.branch)) ? String(p.branch) : undefined) } catch (e) {
          if (e instanceof OpError) throw e
          throw new OpError(`couldn't make a worktree of ${path.basename(root)}: ${(e as Error).message.slice(0, 200)}`, 409)
        }
      }
      const id = resumeTerminalId("claude", sid, a?.id)
      await ctx.api("POST", `terminals/${encodeURIComponent(id)}`, cwd ? { cwd } : undefined)
      const title = String(p.title ?? "").trim().slice(0, 80)
      if (title) await ctx.api("POST", `terminals/${encodeURIComponent(id)}/name`, { name: title }).catch(() => {})
      const to = `view:terminal/${id}`
      try {
        if (byUser(ctx.who)) await ctx.ui({ action: "open", path: to, newTab: true })
        else {
          await ctx.ui({ action: "open", path: to, background: true })
          await ctx.ui({ action: "notify", text: "A cloud session continues here", button: { label: "Show", open: to } })
        }
      } catch (e) { if (!(e instanceof OpError && e.status === 409)) throw e }
      return { id, session: sid, cwd, account: a?.id ?? all[0]?.id ?? "default" }
    },
    text: (r) => `Continuing ${r.session} in ${r.id}${r.cwd ? `, in ${r.cwd}` : ""} (${r.account}).`,
    did: ({ session }) => ({ action: "run", text: `Continued the cloud session ${String(session).slice(0, 60)} in a terminal` }),
  })
}
