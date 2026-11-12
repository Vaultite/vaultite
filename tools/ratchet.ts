// node tools/ratchet.ts [--base <ref> | --commit <ref>]: fails when a change adds more of what a lint rule counts,
// against the merge base with origin/main (or ref), or a commit against its parent: no shared baseline file.
import { git, readAt, sourceFiles } from "./quality/files.ts"
import { isCode } from "./quality/measure.ts"
import { compare, type Growth } from "./ratchet/compare.ts"
import { lint } from "./ratchet/lint.ts"

const args = process.argv.slice(2)
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const commit = option("--commit") ? git(["rev-parse", `${option("--commit")}^{commit}`]).trim() : null
const explicit = option("--base") ?? process.env.VAULTITE_RATCHET_BASE
const base = commit ? git(["rev-parse", `${commit}^`]).trim()
  : git(["merge-base", "HEAD", explicit ?? "origin/main"]).trim()

/** Every path the change touches, on each side: a rename's old path counts on the base side only. */
function changed() {
  const before = new Set<string>()
  const after = new Set<string>()
  for (const line of git(["diff", "--name-status", "-M", base, ...(commit ? [commit] : [])]).split("\n").filter(Boolean)) {
    const [status, a, b] = line.split("\t")
    if (status.startsWith("R") || status.startsWith("C")) { before.add(a); after.add(b) }
    else if (status === "D") before.add(a)
    else if (status === "A") after.add(a)
    else { before.add(a); after.add(a) }
  }
  if (!commit) for (const f of git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean)) after.add(f)
  const ours = new Set(sourceFiles(commit).concat(sourceFiles(base)))
  const keep = (s: Set<string>) => [...s].filter((f) => isCode(f) && ours.has(f))
  return { before: keep(before), after: keep(after) }
}

function report(growth: Growth[]) {
  const lines = [`ratchet: this change adds more of what these rules count (against ${base.slice(0, 9)}):`]
  for (const g of growth) {
    lines.push(`\n${g.rule}: ${g.before} before, ${g.after} now. ${g.message}`)
    for (const f of g.added) lines.push(`  ${f.file}:${f.line}  ${f.text.slice(0, 100)}`)
  }
  lines.push("\nChange the code so the rule holds. A rule that's wrong for one line: `// oxlint-disable-next-line <rule> -- <why>`.")
  process.stderr.write(lines.join("\n") + "\n")
}

const { before, after } = changed()
const was = lint(readAt(base, before), false)
const now = lint(readAt(commit, after), !commit)
const growth = compare(was, now)
if (growth.length) report(growth)
const ok = !growth.length
process.stdout.write(`ratchet: ${after.length} changed files${commit ? ` in ${commit.slice(0, 9)}` : ""} against ${base.slice(0, 9)}: ${ok ? "nothing a rule counts grew" : "FAILED"}\n`)
process.exitCode = ok ? 0 : 1
