import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

const same = (pairs: [got: unknown, want: unknown][]) => pairs.every(([got, want]) => JSON.stringify(got) === JSON.stringify(want))

async function commandLine(check: VaultTest["check"]) {
  const { plainArgs } = await import("../../../electron/argv.ts")
  check("desktop: Open with's files are the command line's plain arguments, never Node's -r module, --vault's path or the app's folder", same([
    [plainArgs(["electron", "-r", "/t/hook.cjs", "/app", "--vault", "/v", "a.md"], false), ["a.md"]],
    [plainArgs(["electron", "/app", "--inspect", "file:///x/b.md", "vaultite://open"], false), ["file:///x/b.md"]],
    [plainArgs(["Vaultite", "--vault=/v", "c.md", "d.md"], true), ["c.md", "d.md"]],
  ]))
}

async function compileCache(check: VaultTest["check"], tmp: string) {
  const { policyFor, trimCompileCache } = await import("../../../electron/storepolicy.ts")
  const cache = path.join(tmp, "compile-cache"), root = path.join(tmp, "root"), runs: { args: string[]; env?: NodeJS.ProcessEnv }[] = []
  fs.mkdirSync(path.join(root, "tools"), { recursive: true })
  fs.writeFileSync(path.join(root, "tools", "compilefill.mjs"), "")
  const ctx = { root, store: "", helpers: "", node: "", env: { PATH: "/bin" }, exec: async (_c: string, args: string[], o: { env?: NodeJS.ProcessEnv }) => {
    runs.push({ args, env: o.env })
    throw new Error("stop")
  } }
  for (const p of [await policyFor(""), await policyFor("5".repeat(40))]) for (const step of p.recipe.preflight) if (step.name === "main's compile cache") await step.run(ctx).catch(() => {})
  check("store: an update's checks compile its main process into the root's own cache, so its first launch finds it compiled",
    runs.length === 2 && runs.every((r) => r.args[0] === "tools/compilefill.mjs" && r.env?.NODE_COMPILE_CACHE === path.join(root, ".compile-cache") && r.env.NODE_COMPILE_CACHE_PORTABLE === "1"), runs)
  fs.mkdirSync(path.join(cache, "v1"), { recursive: true })
  for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(cache, "v1", String(i)), "")
  const kept = await trimCompileCache(cache, 4), held = fs.existsSync(cache), trimmed = await trimCompileCache(cache, 3)
  check("store: the compile cache starts again only once it holds more entries than it may",
    kept === 0 && held && trimmed === 4 && !fs.existsSync(cache) && await trimCompileCache(cache, 3) === 0)
}

async function cloudDue(check: VaultTest["check"]) {
  const { dueAt } = await import("../../../electron/clouddue.ts")
  const base = { profiles: ["a", "b"], read: true, cookiesFor: 10_000, orgs: new Map([["a", { at: 50_000 }]]), next: new Map<string, { at: number }>(), prs: Infinity }
  const cookies = new Map([["a", { at: 1000, in: true }], ["b", { at: 3000, in: false }]])
  check("cloud sessions: read again when the first thing is due: a profile's cookies, its organizations, an account's sessions", same([
    [dueAt({ ...base, cookies }), 11_000],
    [dueAt({ ...base, cookies, next: new Map([["org", { at: 5000 }]]) }), 5000],
    [dueAt({ ...base, cookies: new Map(), orgs: new Map() }), 10_000],
    [dueAt({ ...base, profiles: [], cookies, prs: 7000 }), 7000],
    [dueAt({ ...base, profiles: [], cookies }), Infinity],
  ]))
}

export default async ($: VaultTest) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-launch-"))
  try {
    await commandLine($.check)
    await compileCache($.check, tmp)
    await cloudDue($.check)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}
