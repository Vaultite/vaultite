import fs from "node:fs"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { ON, VAULT, app, check, read, run, vault } = $
  const { Live } = $.vars
  // The vau CLI (core/cli.ts), in-process: its API calls go to the app, /api/ui to a Live with made-up windows.
  const { execute, servers } = await import("../../../core/cli.ts")
  const { normalizeKeys } = await import("../../../core/coreops/settings.ts")
  const uiLive = new Live(vault)
  app.ui = uiLive.drive
  const cliApi = async (method: string, route: string, body?: unknown) => {
    const u = new URL(route, "http://x/")
    const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent)
    if (parts.join("/") === "ui") {
      const [b, status] = uiLive.handle(method, body ?? {})
      return { status, body: b }
    }
    const [status, b] = await run(method, parts, Object.fromEntries(u.searchParams), body)
    return { status, body: b }
  }
  $.vars.stdinText = ""
  const vau = (...argv: string[]) => execute(argv, { api: cliApi, env: {}, stdin: async () => $.vars.stdinText })
  const conf = (name: string) => JSON.parse(read(`.vaultite/${name}.json`))
  let cr = await vau("--help")
  check("vau: --help lists every command", cr.code === 0 && ["context", "render", "panels", "appearance", "hotkey", "open", "plugin"].every((n) => cr.out.includes(`  ${n} `)), cr.out)
  check("vau: plugins' ops and commands are listed, after the core's (where am I first)", ["workspace", "log", "note", "pin", "dashboard", "query", "mcp", "inbox", "clip", "properties", "activity", "perf", "remember", "terminal"].every((n) => cr.out.includes(`  ${n} `))
    && cr.out.indexOf("  context ") < cr.out.indexOf("  render ") && cr.out.indexOf("  render ") < cr.out.indexOf("  pin "), cr.out)
  cr = await vau("panels", "--help")
  check("vau: a command's --help has examples", cr.code === 0 && cr.out.includes("vau panels move terminals top"), cr.out)
  cr = await vau("errors", "3f9a")
  check("vau: a word too many names the command under it that takes one", cr.code === 1 && cr.err.includes("Did you mean vau errors show 3f9a") && cr.err.includes("vau errors clear 3f9a"), cr.err)
  cr = await vau("nope")
  check("vau: an unknown command says so", cr.code === 2 && cr.err.includes("no command 'nope'"), cr)
  fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ disabled: ["random-note"], enabled: ON, order: ["people"], custom: 1 }, null, 2) + "\n")
  fs.rmSync(path.join(VAULT, ".vaultite/sidebars.json"), { force: true })
  Object.assign($.vars, { execute, servers, normalizeKeys, uiLive, cliApi, vau, conf })
}
