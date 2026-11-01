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
  check("vau: a word too many names the command under it that takes one", cr.code === 2 && cr.err.includes("Did you mean vau errors show 3f9a") && cr.err.includes("vau errors clear 3f9a"), cr.err)
  {
    // A parameter becomes its flag only where the server names it: a problem's leading name, or one in backticks.
    const { cliError } = await import("../../../core/cli.ts")
    const e = { id: "lantern.find", params: { type: "object", properties: { entry: { type: "string" }, newTab: { type: "boolean" }, id: { type: "string" } } }, args: ["id"] } as unknown as Parameters<typeof cliError>[0]
    const said = cliError(e, "no entry for Alice Park; give `entry` or `newTab`, not `nope`; newTab: should be true or false, not a list. Usage: vau lantern.find", ["newTab: should be true or false, not a list", "id is missing (which one)", "entri: lantern.find has no such parameter (did you mean entry?)"])
    check("vau: a word that's a parameter's name stays a word; one the server names is its flag", said.msg === "no entry for Alice Park; give --entry or --new-tab, not `nope`; --new-tab: should be true or false, not a list. Usage: vau lantern.find"
      && said.problems.join("|") === "<id> is missing (which one)|--entri: lantern.find has no such parameter (did you mean --entry?)", said)
    cr = await vau("open", "x.md", "--split", "left")
    check("vau: a bad value's problem names its flag, a mistake in the command line (exit 2)", cr.code === 2 && cr.err.includes("--split: should be"), cr)
  }
  cr = await vau("nope")
  check("vau: an unknown command says so", cr.code === 2 && cr.err.includes("no command 'nope'"), cr)
  cr = await vau("serch", "Lighthouse")
  check("vau: a typo names the command it's near", cr.code === 2 && cr.err.includes("Did you mean search") && !cr.err.includes("service"), cr)
  cr = await vau("bundle", "shwo", "x")
  check("vau: a typo in a group's command names the one it's near", cr.code === 2 && cr.err.includes("Did you mean vau bundle show?"), cr)
  fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ disabled: ["random-note"], enabled: ON, custom: 1 }, null, 2) + "\n")
  fs.rmSync(path.join(VAULT, ".vaultite/sidebars.json"), { force: true })
  Object.assign($.vars, { execute, servers, normalizeKeys, uiLive, cliApi, vau, conf })
}
