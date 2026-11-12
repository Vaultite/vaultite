import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { gitEnv } from "../../core/gitenv.ts"

export const ROOT = path.resolve(import.meta.dirname, "../..")

/** Third-party code kept as released: a folder with its PROVENANCE.md, and kdbxweb's own tests. */
const VENDORED_TESTS = ["tools/test/kdbx/upstream/"]

export const git = (args: string[], input?: string) =>
  execFileSync("git", args, { cwd: ROOT, env: gitEnv(), encoding: "utf8", input, maxBuffer: 1 << 30 })

function vendoredDirs(all: string[]) {
  const dirs = all.filter((f) => f.endsWith("/PROVENANCE.md")).map((f) => f.slice(0, -"PROVENANCE.md".length))
  return [...dirs, ...VENDORED_TESTS]
}

/** The repository's own files at `at` (a commit), or in the worktree (tracked and untracked) when null. */
export function sourceFiles(at: string | null): string[] {
  const all = (at ? git(["ls-tree", "-r", "--name-only", at]) : git(["ls-files", "--cached", "--others", "--exclude-standard"]))
    .split("\n").filter(Boolean)
  const vendored = vendoredDirs(all)
  return all.filter((f) => !vendored.some((d) => f.startsWith(d)))
}

export const isVendored = (file: string, all: string[]) => vendoredDirs(all).some((d) => file.startsWith(d))

/** Each file's text at `at`, or in the worktree when null; a file missing there is left out. */
export function readAt(at: string | null, files: string[]): Map<string, string> {
  const out = new Map<string, string>()
  if (!at) {
    for (const f of files) {
      const p = path.join(ROOT, f)
      if (fs.existsSync(p) && fs.statSync(p).isFile()) out.set(f, fs.readFileSync(p, "utf8"))
    }
    return out
  }
  const raw = execFileSync("git", ["cat-file", "--batch"], { cwd: ROOT, env: gitEnv(), input: files.map((f) => `${at}:${f}`).join("\n") + "\n", maxBuffer: 1 << 30 })
  let i = 0
  for (const f of files) {
    const nl = raw.indexOf(10, i)
    const header = raw.subarray(i, nl).toString()
    i = nl + 1
    if (header.endsWith(" missing")) continue
    const size = Number(header.split(" ")[2])
    out.set(f, raw.subarray(i, i + size).toString("utf8"))
    i += size + 1
  }
  return out
}
