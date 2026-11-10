// The UI QA scripts (web/qa/*.mjs): which run in a full run, their head comments (their usage line, the files they
// exercise), and which ones a change reaches (tools/verify.ts).
import fs from "node:fs"
import path from "node:path"

export const QA = path.resolve(import.meta.dirname, "../web/qa")
/** Not tests (benchmarks, a library, the smoke test), needing more than one machine (machines, inboxmachines), or another
 *  build (the demo's: CI's demo job runs it, and named here it's built first). */
export const SKIP = new Set(["boot", "perf", "stability", "termperf", "shots", "subjects", "machines", "inboxmachines", "termhost", "demo"])

/** Every script's name, the skipped ones too. */
export const allScripts = () => fs.readdirSync(QA).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4)).sort()

/** Its comment lines (from the top level: the head comment and the section notes), one text. */
export const head = (name: string) => fs.readFileSync(path.join(QA, `${name}.mjs`), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n")

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** Whether `text` names path `p` on its own, not inside a longer one (core/x.ts isn't in plugins/core/x.ts nor in
 *  core/x.tsx); `folder`: only as the folder itself, not one of its files. */
const names = (text: string, p: string, folder = false) => new RegExp(`(?<![\\w./-])${esc(p)}(?![\\w-]|\\.\\w${folder ? "|/\\w" : ""})`).test(text)
/** A changed file as heads write it: whole, the web app's without web/src/, a .tsx also as .ts. */
const forms = (f: string) => [f, ...(f.startsWith("web/src/") ? [f.slice("web/src/".length)] : [])].flatMap((p) => p.endsWith(".tsx") ? [p, p.slice(0, -1)] : [p])

/** The scripts a change to `files` reaches, and why: one that changed, one whose head names a changed file, and for a
 *  built-in plugin's file no head names, those whose head names the plugin's folder itself (not one of its files). */
export function qaFor(files: string[]): Map<string, string> {
  const heads = new Map(allScripts().filter((n) => !SKIP.has(n)).map((n) => [n, head(n)]))
  const out = new Map<string, string>()
  for (const n of heads.keys()) if (files.includes(`web/qa/${n}.mjs`)) out.set(n, "changed")
  for (const f of files) {
    const hit = [...heads].filter(([, h]) => forms(f).some((p) => names(h, p))).map(([n]) => n)
    for (const n of hit) if (!out.has(n)) out.set(n, f)
    const plugin = /^plugins\/core\/[\w-]+/.exec(f)?.[0]
    if (!hit.length && plugin) for (const [n, h] of heads) if (!out.has(n) && names(h, plugin, true)) out.set(n, plugin)
  }
  return out
}
