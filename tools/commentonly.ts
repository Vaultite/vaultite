import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { parseSync } from "rolldown/utils"
import { gitEnv } from "../core/gitenv.ts"

const base = process.argv[2] ?? "origin/main"
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", env: gitEnv(), maxBuffer: 1 << 28 })
const POSITIONS = new Set(["start", "end", "range", "loc"])
const tree = (file: string, text: string) => JSON.stringify(parseSync(file, text).program, (k, v) => (POSITIONS.has(k) ? undefined : v))

const changed = git("diff", "--name-only", "--diff-filter=M", base, "--").split("\n").filter((f) => /\.(m?ts|tsx|mjs)$/.test(f))
const other = git("diff", "--name-only", "--diff-filter=ADR", base, "--").split("\n").filter(Boolean)
const differ = changed.filter((f) => tree(f, git("show", `${base}:${f}`)) !== tree(f, fs.readFileSync(f, "utf8")))
for (const f of differ) process.stdout.write(`code changed: ${f}\n`)
for (const f of other) process.stdout.write(`added, deleted or renamed: ${f}\n`)
process.stdout.write(`${changed.length - differ.length} of ${changed.length} changed files differ only in comments\n`)
process.exit(differ.length || other.length ? 1 : 0)
