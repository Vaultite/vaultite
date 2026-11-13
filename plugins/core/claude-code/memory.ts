import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/** The memory files Claude Code reads in each folder. */
const NAMES = ["CLAUDE.md", path.join(".claude", "CLAUDE.md"), "CLAUDE.local.md"]
/** How many imports deep Claude Code follows. */
const DEPTH = 5

const read = (file: string) => { try { return fs.readFileSync(file, "utf8") } catch { return null } }
const inside = (dir: string, file: string) => { const r = path.relative(dir, file); return !!r && !r.startsWith("..") && !path.isAbsolute(r) }

/** A session's memory files' lines; imports outside `cwd` and `account` left out, as Claude Code asks first. */
export function memoryLines(cwd: string, account: string): Set<string> {
  const out = new Set<string>(), seen = new Set<string>()
  const take = (file: string, depth: number) => {
    if (seen.has(file)) return
    seen.add(file)
    const text = read(file)
    if (text === null) return
    for (const l of text.split("\n")) if (l.trim()) out.add(l.trim())
    if (depth >= DEPTH) return
    const prose = text.replace(/^(```|~~~)[^]*?^\1/gm, "").replace(/`[^`\n]*`/g, "")
    for (const [, p] of prose.matchAll(/(?:^|\s)@(\S+)/g)) {
      const to = p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : path.resolve(path.dirname(file), p)
      if (inside(cwd, to) || inside(account, to)) take(to, depth + 1)
    }
  }
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    for (const n of NAMES) take(path.join(dir, n), 0)
    if (path.dirname(dir) === dir) break
  }
  take(path.join(account, "CLAUDE.md"), 0)
  return out
}

export const unsaid = (text: string, said: Set<string>) =>
  text.split("\n").filter((l) => l.trim().length < 20 || !said.has(l.trim())).join("\n").trim()
