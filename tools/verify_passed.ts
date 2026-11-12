// The stages verify saw pass, by the files they ran on (the working tree as it is, committed or not) and what else a
// result rests on (node, the OS, the installed packages): a stage that passed on the same ones isn't run again.
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { gitEnv } from "../core/gitenv.ts"

const KEEP_MS = 7 * 86_400_000
const sha = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex")

function git(root: string, args: string[], extra: Record<string, string> = {}): string | null {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", env: gitEnv(extra), maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout.trim() : null
}

/** The git tree of the working files as they are (staged or not, untracked, never what's ignored), the checkout's own
 *  index untouched; null outside a git checkout. */
export function workTree(root: string): string | null {
  const dir = git(root, ["rev-parse", "--absolute-git-dir"])
  if (!dir) return null
  const index = path.join(dir, `verify-index-${process.pid}`)
  try {
    // (a copy of the index keeps its file stats, so only what changed is read again; and its own time, or git would
    // trust the stats of a file edited in the second the index was written: racy git)
    const own = path.join(dir, "index")
    if (fs.existsSync(own)) { fs.copyFileSync(own, index); const st = fs.statSync(own); fs.utimesSync(index, st.atime, st.mtime) }
    const env = { GIT_INDEX_FILE: index }
    return git(root, ["add", "-A"], env) === null ? null : git(root, ["write-tree"], env)
  } finally {
    fs.rmSync(index, { force: true })
  }
}

/** What a stage's result rests on, besides its command: null when it can't be told (then nothing is remembered). */
export function filesState(root: string): string | null {
  const tree = workTree(root)
  if (!tree) return null
  const lock = path.join(root, "node_modules/.package-lock.json")
  return [tree, process.version, process.platform, process.arch, fs.existsSync(lock) ? sha(fs.readFileSync(lock)) : "-"].join(" ")
}

/** The passes kept for this repository's checkouts (shared by its worktrees: the same files pass the same in each). */
export function passes(root: string, o: { now?: () => number } = {}) {
  const now = o.now ?? Date.now
  const common = git(root, ["rev-parse", "--git-common-dir"])
  const dir = common && path.join(path.resolve(root, common), "vaultite", "passed")
  const file = (state: string, cmd: string[]) => path.join(dir!, `${sha(`${state}\0${cmd.join("\0")}`)}.json`)
  const at = (f: string) => { try { return (JSON.parse(fs.readFileSync(f, "utf8")) as { at: number }).at } catch { return null } }
  const old = (f: string) => { const t = at(f); return t === null || now() - t > KEEP_MS }
  if (dir) for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (f.endsWith(".json") && old(path.join(dir, f))) fs.rmSync(path.join(dir, f), { force: true })
  return {
    /** When `cmd` passed on `state`, if it did (within the week). */
    passedAt(state: string, cmd: string[]): number | null {
      return dir && !old(file(state, cmd)) ? at(file(state, cmd)) : null
    },
    pass(state: string, cmd: string[], seconds: number) {
      if (!dir) return
      const f = file(state, cmd)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(`${f}.${process.pid}`, JSON.stringify({ cmd, seconds, at: now() }))
      fs.renameSync(`${f}.${process.pid}`, f)
    },
  }
}
