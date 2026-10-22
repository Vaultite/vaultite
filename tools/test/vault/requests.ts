import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, vault, write } = $
  // Ops keep the request they came in: the routes they call see it, so owner-only routes and ops refuse anyone else.
  {
    const stranger = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "100.64.0.9" } } as Any
    const refused = async (id: string, params: Any) => app.runOp(id, params, { http: stranger }).then(() => "ran", (e) => (e.status === 403 ? "refused" : `error ${e.status}: ${e.message}`))
    await api("PATCH", "config/plugin/terminal", { allowRemote: null }) // (a test above let anyone in)
    // Who may reach a plugin is this machine's (core/trust.ts): never read from the vault, changed only by its owner.
    write(".vaultite/plugins/terminal/data.json", JSON.stringify({ allowRemote: true, allowUsers: ["x@example.com"] }))
    await vault.synced()
    check("local settings: one in the vault's file is ignored", !("allowRemote" in (await api("GET", "config/plugin/terminal"))[1]))
    {
      // An agent's hook reads nothing of the vault: it never waits behind a write holding it.
      let release = () => {}
      let holding = () => {}
      const started = new Promise<void>((r) => { holding = r })
      const held = app.hold(() => new Promise<void>((r) => { release = r; holding() }))
      await started
      const hook = await Promise.race([app.run("POST", ["activity", "hook"], { agent: "claude" }, { tool_name: "Bash", tool_input: { command: "true" } }).then((r) => r.status),
        new Promise((r) => setTimeout(() => r("waited"), 2000))])
      release()
      await held
      check("hooks: an agent's hook runs while a write holds the vault", hook === 200, hook)
    }
    {
      const stranger = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "127.0.0.1" } } as Any
      const r = await app.run("PATCH", ["config", "plugin", "terminal"], {}, { allowRemote: true }, stranger)
      check("local settings: someone else on the tailnet can't change them", r.status === 403 && !(await api("GET", "config/plugin/terminal"))[1].allowRemote, r)
    }
    fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/terminal/data.json"), "{}\n")
    const t = await refused("terminal.list", {})
    check("ops: an owner-only op is refused to someone else on the tailnet", t === "refused", t)
    check("ops: an op whose route only the owner may use is refused the same (the request goes with ctx.api)", await refused("inbox.clear", {}) === "refused")
    check("ops: in-process (no request) nothing is refused", (await app.runOp("ops.list", {})).result !== undefined)
    // MCP lets a login the owner allowed (allowUsers) in, and its tools run for that request: the owner's ops stay refused.
    await api("PATCH", "config/plugin/mcp", { allowUsers: ["stranger@example.com"] })
    const viaMcp = async (name: string, args: Any) => {
      const served = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "127.0.0.1" } } as Any // (through Tailscale Serve)
      const r = await app.run("POST", ["mcp"], {}, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, served)
      return r.status === 200 ? JSON.parse((r.body as Any).text).result : { status: r.status, body: r.body }
    }
    const listed = await viaMcp("docs", {})
    check("mcp: a login allowUsers names gets in (its tools run)", listed.isError === false, listed)
    const term = await viaMcp("call", { id: "terminal.list" })
    check("mcp: an owner-only op through MCP is refused to that login (the MCP request goes with the op)", term.isError === true && /owner|only/i.test(term.content[0].text), term)
    const inbox = await viaMcp("call", { id: "inbox.clear" })
    check("mcp: and an op whose route only the owner may use", inbox.isError === true, inbox)
    await api("PATCH", "config/plugin/mcp", { allowUsers: null })
  }
}
