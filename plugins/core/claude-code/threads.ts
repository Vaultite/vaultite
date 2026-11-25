import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { gitEnv } from "../../../core/plugins.ts"

export type Thread = { repo: string; dir: string; cwd: string; branch: string; base: string; worktree: boolean }

export class GitError extends Error {}

const IDENT = { GIT_AUTHOR_NAME: "Vaultite", GIT_AUTHOR_EMAIL: "vaultite@localhost", GIT_COMMITTER_NAME: "Vaultite", GIT_COMMITTER_EMAIL: "vaultite@localhost" }

export function git(cwd: string, args: string[], extra: Record<string, string> = {}): Promise<string> {
  return new Promise((ok, no) => execFile("git", args, { cwd, env: gitEnv(extra), timeout: 60_000, maxBuffer: 64 << 20, windowsHide: true },
    (e, out, err) => (e ? no(new GitError(String(err || e.message).trim().split("\n").slice(-3).join("\n"))) : ok(String(out)))))
}
export const gitOk = (cwd: string, args: string[]) => git(cwd, args).then(() => true, () => false)
const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }

export const worktreesRoot = () => path.join(process.env.VAULTITE_TEST === "1" ? os.tmpdir() : os.homedir(), ".vaultite", "worktrees")

export async function repoOf(cwd: string): Promise<string | null> {
  try { return real((await git(cwd, ["rev-parse", "--show-toplevel"])).trim()) } catch { return null }
}

export function slugOf(text: string): string {
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).slice(0, 6).join("-").slice(0, 40).replace(/-+$/, "")
  return `${words || "thread"}-${crypto.randomBytes(2).toString("hex")}`
}

const headOf = async (dir: string) => (await git(dir, ["rev-parse", "--verify", "-q", "HEAD"]).catch(() => "")).trim()
const branchOf = async (dir: string) => (await git(dir, ["symbolic-ref", "-q", "--short", "HEAD"]).catch(() => "")).trim()

export async function threadFor(cwd: string, said: string, worktree: boolean, root = worktreesRoot()): Promise<Thread | null> {
  const repo = await repoOf(cwd)
  const base = repo ? await headOf(repo) : ""
  if (!repo || !base) return null
  if (!worktree) return { repo, dir: repo, cwd, branch: await branchOf(repo), base, worktree: false }
  const slug = slugOf(said), branch = `agents/${slug}`, dir = path.join(root, path.basename(repo), slug)
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  await git(repo, ["worktree", "add", "-b", branch, dir, base])
  const rel = path.relative(repo, real(cwd))
  return { repo, dir, cwd: rel && !rel.startsWith("..") && fs.existsSync(path.join(dir, rel)) ? path.join(dir, rel) : dir, branch, base, worktree: true }
}

async function copyIndexRacySafe(dir: string, to: string) {
  const own = path.resolve(dir, (await git(dir, ["rev-parse", "--git-path", "index"])).trim()), st = fs.statSync(own, { throwIfNoEntry: false })
  if (!st) return false
  fs.copyFileSync(own, to)
  fs.utimesSync(to, st.atime, st.mtime)
  return true
}

export async function snapshot(dir: string): Promise<string> {
  const index = path.join(os.tmpdir(), `vaultite-index-${crypto.randomUUID()}`), env = { GIT_INDEX_FILE: index }
  try {
    const head = await headOf(dir)
    if (!(await copyIndexRacySafe(dir, index)) && head) await git(dir, ["read-tree", head], env)
    await git(dir, ["add", "-A"], env)
    const tree = (await git(dir, ["write-tree"], env)).trim()
    return (await git(dir, ["commit-tree", tree, ...(head ? ["-p", head] : []), "-m", "Vaultite checkpoint"], { ...env, ...IDENT })).trim()
  } finally { fs.rmSync(index, { force: true }) }
}

const refs = (id: string) => `refs/vaultite-agents/${id}`
export const turnRef = (id: string, n: number) => `${refs(id)}/turn-${n}`

export async function checkpoint(dir: string, id: string, n: number, sha?: string): Promise<string> {
  const at = sha ?? await snapshot(dir)
  await git(dir, ["update-ref", turnRef(id, n), at])
  return at
}

export async function turnsOf(dir: string, id: string): Promise<number[]> {
  const out = await git(dir, ["for-each-ref", "--format=%(refname)", `${refs(id)}/`]).catch(() => "")
  return out.split("\n").flatMap((l) => { const m = /\/turn-(\d+)$/.exec(l.trim()); return m ? [Number(m[1])] : [] }).sort((a, b) => a - b)
}

export async function dropTurns(dir: string, id: string) {
  for (const n of await turnsOf(dir, id)) await git(dir, ["update-ref", "-d", turnRef(id, n)]).catch(() => {})
}

export type Source = "all" | "latest" | "uncommitted" | `turn:${number}`
export const isSource = (s: string): s is Source => /^(all|latest|uncommitted|turn:\d+)$/.test(s)

export async function rangeOf(t: Thread, id: string, source: Source): Promise<[string, string | null]> {
  const turns = await turnsOf(t.dir, id)
  if (source === "uncommitted") return ["HEAD", null]
  if (source === "all") return [turns.length ? turnRef(id, turns[0]) : t.base, null]
  const n = source === "latest" ? turns.filter((x) => x > 0).at(-1) : Number(source.slice(5))
  if (n === undefined) return [t.base, t.base]
  if (!turns.includes(n)) throw new GitError(`it has no turn ${n} (its turns: ${turns.filter((x) => x > 0).join(", ") || "none yet"})`)
  const before = turns.filter((x) => x < n).at(-1)
  return [before === undefined ? t.base : turnRef(id, before), turnRef(id, n)]
}

const DIFF = ["-c", "core.quotepath=false", "diff", "--no-color", "--no-ext-diff", "--find-renames"]
async function workingPatch(dir: string, from: string) {
  const index = path.join(os.tmpdir(), `vaultite-index-${crypto.randomUUID()}`), env = { GIT_INDEX_FILE: index }
  try {
    await copyIndexRacySafe(dir, index)
    await git(dir, ["add", "-A", "--intent-to-add"], env)
    return await git(dir, [...DIFF, from], env)
  } finally { fs.rmSync(index, { force: true }) }
}

const LIMIT = 4 << 20
export async function patchOf(t: Thread, id: string, source: Source) {
  const [a, b] = await rangeOf(t, id, source)
  const patch = b === null ? await workingPatch(t.dir, a) : await git(t.dir, [...DIFF, a, b])
  return { patch: patch.length > LIMIT ? patch.slice(0, patch.lastIndexOf("\ndiff --git ", LIMIT) + 1) : patch, truncated: patch.length > LIMIT }
}
