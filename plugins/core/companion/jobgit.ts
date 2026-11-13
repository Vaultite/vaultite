import { execFile, spawn } from "node:child_process"
import { gitEnv } from "../../../core/plugins.ts"
import { commitsIn, type Marks } from "./jobs.ts"

const git = (cwd: string, args: string[]) => new Promise<string>((ok) => execFile("git", args, { cwd, timeout: 5000, maxBuffer: 4 << 20, env: gitEnv() }, (e, out) => ok(e ? "" : String(out))))
const statLine = (stat: string) => {
  const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(stat)
  return m ? `${m[1]} file${m[1] === "1" ? "" : "s"} changed, +${m[2] ?? 0} -${m[3] ?? 0}` : ""
}
export async function diffSince(cwd: string, base: string, landed = "", gone = false) {
  if (landed && await gitOk(cwd, ["cat-file", "-e", `${landed}^{commit}`])) return statLine(await git(cwd, ["show", "--shortstat", "--format=", landed]))
  if (!base || gone || !(await gitOk(cwd, ["merge-base", "--is-ancestor", base, "HEAD"]))) return ""
  const from = await fromOf(cwd, base)
  const [stat, fresh, commits] = await Promise.all([git(cwd, ["diff", "--shortstat", from]), git(cwd, ["ls-files", "--others", "--exclude-standard"]), git(cwd, ["rev-list", "--count", `${from}..HEAD`])])
  const n = fresh.split("\n").filter(Boolean).length, c = Number(commits.trim()) || 0
  return [statLine(stat), n ? `${n} new file${n > 1 ? "s" : ""}` : "", c ? `${c} commit${c > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ")
}
async function fromOf(cwd: string, base: string) {
  const main = await mainOf(cwd), on = main ? (await git(cwd, ["merge-base", main, "HEAD"])).trim() : ""
  return on && on !== base && await gitOk(cwd, ["merge-base", "--is-ancestor", base, on]) ? on : base
}
export async function onMainSince(cwd: string, base: string, text: string, branch = "", marks?: Marks | null) {
  const main = await mainOf(cwd)
  if (!main || !base) return false
  const from = branch && await gitOk(cwd, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]) ? (await git(cwd, ["merge-base", main, `refs/heads/${branch}`])).trim() : ""
  for (const h of commitsIn(text)) {
    if (from && await gitOk(cwd, ["merge-base", "--is-ancestor", h, from])) continue
    if (await gitOk(cwd, ["merge-base", "--is-ancestor", h, main]) && !(await gitOk(cwd, ["merge-base", "--is-ancestor", h, base]))) return true
  }
  if (branch && await gitOk(cwd, ["merge-base", "--is-ancestor", branch, main]) && !(await gitOk(cwd, ["merge-base", "--is-ancestor", branch, base]))) return true
  if (!marks?.whole && !marks?.each.length) return false
  const on = await mainPatches(cwd, base, main)
  return (!!marks.whole && on.has(marks.whole)) || (!!marks.each.length && marks.each.every((x) => on.has(x)))
}
const gitOk = (cwd: string, args: string[]) => new Promise<boolean>((r) => execFile("git", args, { cwd, timeout: 5000, env: gitEnv() }, (e) => r(!e)))
const mainOf = async (cwd: string) => (await gitOk(cwd, ["rev-parse", "--verify", "-q", "origin/main"])) ? "origin/main" : (await gitOk(cwd, ["rev-parse", "--verify", "-q", "origin/master"])) ? "origin/master" : ""
function patchIds(cwd: string, args: string[]) {
  return new Promise<Map<string, string>>((ok) => {
    const out = new Map<string, string>()
    const a = spawn("git", args, { cwd, env: gitEnv(), stdio: ["ignore", "pipe", "ignore"] }), b = spawn("git", ["patch-id", "--stable"], { cwd, env: gitEnv(), stdio: ["pipe", "pipe", "ignore"] })
    const kill = setTimeout(() => { a.kill(); b.kill() }, 20_000)
    a.stdout.pipe(b.stdin)
    b.stdin.on("error", () => {})
    let text = ""
    b.stdout.on("data", (d) => (text += d))
    b.on("close", () => {
      clearTimeout(kill)
      // (git patch-id names a diff not from git log by an all-zero commit)
      for (const l of text.split("\n")) { const [p, c] = l.trim().split(/\s+/); if (p && c) out.set(/^0+$/.test(c) ? "-" : c, p) }
      ok(out)
    })
    b.on("error", () => { clearTimeout(kill); ok(out) })
  })
}
export async function marksOf(cwd: string, branch: string): Promise<Marks | null> {
  const main = await mainOf(cwd)
  if (!main || !branch || !(await gitOk(cwd, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]))) return null
  const own = (await git(cwd, ["rev-list", "--no-merges", "-n", "40", `${main}..refs/heads/${branch}`])).split("\n").filter(Boolean)
  if (!own.length) return null
  const from = (await git(cwd, ["merge-base", main, `refs/heads/${branch}`])).trim()
  const [each, whole] = await Promise.all([patchIds(cwd, ["log", "-p", "--no-merges", "--no-color", "--no-ext-diff", "--no-walk=unsorted", ...own]),
    from ? patchIds(cwd, ["diff", "--no-color", "--no-ext-diff", from, `refs/heads/${branch}`]) : new Map<string, string>()])
  const m: Marks = { whole: whole.get("-") ?? "", each: own.map((c) => each.get(c) ?? "").filter(Boolean) }
  return m.whole || m.each.length ? m : null
}
const patchOf = new Map<string, string>()
async function mainPatches(cwd: string, base: string, main: string) {
  const since = (await git(cwd, ["rev-list", "--no-merges", "-n", "3000", `${base}..${main}`])).split("\n").filter(Boolean)
  const fresh = since.filter((c) => !patchOf.has(c))
  for (let i = 0; i < fresh.length; i += 200) {
    const got = await patchIds(cwd, ["log", "-p", "--no-merges", "--no-color", "--no-ext-diff", "--no-walk=unsorted", ...fresh.slice(i, i + 200)])
    if (patchOf.size > 50_000) patchOf.clear()
    // (git gives a commit with no diff no patch-id)
    for (const c of fresh.slice(i, i + 200)) patchOf.set(c, got.get(c) ?? "")
  }
  return new Set(since.map((c) => patchOf.get(c)).filter(Boolean))
}
export const marksIn = (v: unknown): Marks | null => {
  if (!v || typeof v !== "object") return null
  const hex = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{40,64}$/.test(x)
  return { whole: "whole" in v && hex(v.whole) ? v.whole : "", each: "each" in v && Array.isArray(v.each) ? v.each.filter(hex).slice(0, 40) : [] }
}
