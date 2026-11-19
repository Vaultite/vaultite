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
  const { trimCompileCache } = await import("../../../electron/storepolicy.ts")
  const cache = path.join(tmp, "compile-cache")
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
