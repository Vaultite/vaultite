import { execFile } from "node:child_process"
import fs from "node:fs"
import { findBin } from "../../../core/agents.ts"
import { dropTurns, git, GitError, gitOk, type Thread } from "./threads.ts"

async function mainsOf(repo: string): Promise<string[]> {
  const origin = (await git(repo, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]).catch(() => "")).trim()
  const local = await Promise.all(["main", "master"].map(async (b) => ((await gitOk(repo, ["rev-parse", "--verify", "-q", `refs/heads/${b}`])) ? b : "")))
  return [origin, ...local].filter(Boolean)
}

export async function finished(t: Thread): Promise<boolean> {
  const ref = `refs/heads/${t.branch}`
  const tip = (await git(t.repo, ["rev-parse", "--verify", "-q", ref]).catch(() => "")).trim()
  if (!tip) return true
  if ((await git(t.repo, ["for-each-ref", "--format=%(upstream:track)", ref]).catch(() => "")).includes("[gone]")) return true
  if (tip === t.base) return false
  for (const m of await mainsOf(t.repo)) if (m !== t.branch && await gitOk(t.repo, ["merge-base", "--is-ancestor", tip, m])) return true
  return false
}

export const dirty = async (dir: string) => (await git(dir, ["status", "--porcelain"])).trim() !== ""

export async function tidyThread(t: Thread, id: string): Promise<"removed" | "dirty" | "open" | "gone"> {
  if (!t.worktree) return "open"
  if (!fs.existsSync(t.dir)) { await dropTurns(t.repo, id).catch(() => {}); await git(t.repo, ["worktree", "prune"]).catch(() => {}); return "gone" }
  if (!(await finished(t))) return "open"
  if (await dirty(t.dir)) return "dirty"
  await git(t.repo, ["worktree", "remove", t.dir])
  await git(t.repo, ["branch", "-D", t.branch]).catch(() => {})
  await dropTurns(t.repo, id)
  return "removed"
}

export type GitAction = "commit" | "push" | "pr"
export const GIT_ACTIONS: GitAction[] = ["commit", "push", "pr"]
export const isGitAction = (a: string): a is GitAction => GIT_ACTIONS.some((x) => x === a)

function gh(cwd: string, args: string[]): Promise<string> {
  const bin = findBin("gh") ?? "gh"
  return new Promise((ok, no) => execFile(bin, args, { cwd, timeout: 120_000, windowsHide: true },
    (e, out, err) => (e ? no(new GitError(String(err || e.message).trim().split("\n").slice(-3).join("\n") || "gh failed")) : ok(String(out).trim()))))
}

async function commit(t: Thread, message: string) {
  if (!(await dirty(t.dir))) throw new GitError("there's nothing to commit")
  await git(t.dir, ["add", "-A"])
  await git(t.dir, ["commit", "-q", "-m", message])
  return { text: `Committed ${(await git(t.dir, ["rev-parse", "--short", "HEAD"])).trim()} on ${t.branch || "its checkout"}` }
}

export async function gitAction(t: Thread, action: GitAction, o: { message?: string; title?: string; body?: string }) {
  if (action === "commit") return commit(t, o.message?.trim() || "Changes from a coding thread")
  if (!t.branch) throw new GitError("its checkout isn't on a branch")
  if (action === "push") { await git(t.dir, ["push", "-u", "origin", t.branch]); return { text: `Pushed ${t.branch} to origin` } }
  const args = ["pr", "create", "--head", t.branch, ...(o.title ? ["--title", o.title, "--body", o.body ?? ""] : ["--fill"])]
  const out = await gh(t.dir, args)
  const url = /https?:\/\/\S+/.exec(out)?.[0] ?? ""
  return { text: url ? `Opened a pull request: ${url}` : "Opened a pull request", url: url || undefined }
}
