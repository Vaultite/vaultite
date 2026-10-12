import fs from "node:fs"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, exists, read } = $
  // Agent files: the vault's AGENTS.md and CLAUDE.md are the user's; the app only adds or takes out its pointer line.
  {
    const AG = "Before writing in this vault, read `.vaultite/AGENTS.md`: how the Vaultite app reads these files."
    const setRoot = async (on: boolean) => {
      fs.mkdirSync(path.join(VAULT, ".vaultite/plugins/agent-files"), { recursive: true })
      fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/agent-files/data.json"), JSON.stringify({ rootFiles: on }))
      await api("GET", "state")
    }
    check("agent files: off by default, nothing outside .vaultite/", !exists("AGENTS.md") && read("CLAUDE.md") === "@AGENTS.md\n")
    // The write gate (core/writegate.ts): Agent files writes the root files on its own, so only once the user allowed it.
    await setRoot(true)
    await api("GET", "state")
    const grants = () => JSON.parse(fs.existsSync(path.join(VAULT, ".vaultite/grants.json")) ? read(".vaultite/grants.json") : "{}")
    check("write gate: a plugin's own write outside .vaultite/ is refused without a grant", !exists("AGENTS.md") && read("CLAUDE.md") === "@AGENTS.md\n", read("CLAUDE.md"))
    check("write gate: ...and its declared place is marked for the app to ask", grants()["agent-files"]?.["AGENTS.md"] === "ask", grants())
    const [, writes] = await api("POST", "ops/plugin.writes", { id: "agent-files" })
    check("write gate: plugin.writes lists what it declares, and the answers", writes.writes.length === 2 && writes.writes[0].answer === "ask" && writes.writes[0].why.includes("pointing"), writes)
    const [gc] = await api("POST", "ops/plugin.grant", { id: "agent-files" })
    await setRoot(true)
    check("write gate: allowed, it writes", gc === 200 && exists("AGENTS.md") && grants()["agent-files"]?.["CLAUDE.md"] === "allowed", [gc, grants()])
    check("agent files: on, a new AGENTS.md is the pointer", read("AGENTS.md") === AG + "\n", read("AGENTS.md"))
    check("agent files: on, CLAUDE.md keeps its line and gets the import", read("CLAUDE.md") === "@AGENTS.md\n\n@.vaultite/AGENTS.md\n", read("CLAUDE.md"))
    await setRoot(false)
    check("agent files: off, a file that was only the line goes", !exists("AGENTS.md"))
    check("agent files: off, the rest of a file stays", read("CLAUDE.md") === "@AGENTS.md\n", read("CLAUDE.md"))
    fs.writeFileSync(path.join(VAULT, "AGENTS.md"), "")
    await setRoot(true)
    await setRoot(false)
    check("agent files: off, the user's own file stays even when it was only the line", exists("AGENTS.md") && read("AGENTS.md") === "", read("AGENTS.md"))
    fs.rmSync(path.join(VAULT, "AGENTS.md"))
    fs.writeFileSync(path.join(VAULT, "AGENTS.md"), "# My project\n\nBuild with make.\n")
    await api("GET", "state")
    check("agent files: off, the user's own AGENTS.md is never touched", read("AGENTS.md") === "# My project\n\nBuild with make.\n")
    await setRoot(true)
    check("agent files: on, one line added at the end, nothing else changed", read("AGENTS.md") === `# My project\n\nBuild with make.\n\n${AG}\n`, read("AGENTS.md"))
    await setRoot(false)
    check("agent files: off again, back as it was", read("AGENTS.md") === "# My project\n\nBuild with make.\n", read("AGENTS.md"))
    fs.rmSync(path.join(VAULT, "AGENTS.md"))
    fs.writeFileSync(path.join(VAULT, "CLAUDE.md"), "@AGENTS.md\n")
    await api("GET", "state")
    check("the app never writes the vault's own AGENTS.md or CLAUDE.md", !exists("AGENTS.md") && read("CLAUDE.md") === "@AGENTS.md\n")
    // The user's own rules, under their heading, stay through the app's rewrites; turned off, only they stay.
    const rules = read(".vaultite/AGENTS.md")
    const [rc] = await api("PUT", "file", { path: ".vaultite/AGENTS.md", text: rules.replace("## Rules", "## Changed") + "\nProjects live in Work/.\n", base: rules })
    await api("GET", "state")
    check("the rules: the app's part is rewritten, the user's own rules stay", rc === 200 && read(".vaultite/AGENTS.md").includes("## Rules") &&
      read(".vaultite/AGENTS.md").endsWith("## Your own rules\n<!-- The app rewrites everything above this heading; what you write under it stays. -->\n\nProjects live in Work/.\n"), read(".vaultite/AGENTS.md").slice(-300))
    await setRoot(true)
    check("the rules: the pointer joins the vault's CLAUDE.md", read("CLAUDE.md") === "@AGENTS.md\n\n@.vaultite/AGENTS.md\n", read("CLAUDE.md"))
    await setRoot(false)
    fs.writeFileSync(path.join(VAULT, "CLAUDE.md"), "@AGENTS.md\n")
    // Rules that can't be read aren't taken for no file (the rewrite would drop the user's own); tried again after a wait.
    const file = path.join(VAULT, ".vaultite/AGENTS.md"), mine = read(".vaultite/AGENTS.md") + "\nKeep this.\n"
    fs.writeFileSync(file, mine)
    fs.chmodSync(file, 0o000)
    await setRoot(true)
    fs.chmodSync(file, 0o644)
    check("the rules: unreadable, left as they are", read(".vaultite/AGENTS.md") === mine)
    await new Promise((r) => setTimeout(r, 2_100))
    await api("GET", "state")
    check("the rules: tried again after the wait, the user's rules kept", read(".vaultite/AGENTS.md").includes("## Rules") && read(".vaultite/AGENTS.md").endsWith("Keep this.\n"), read(".vaultite/AGENTS.md").slice(-200))
    await setRoot(false)
    // A write that fails leaves no temporary copy behind.
    const { writeAtomic } = await import("../../../core/vault.ts")
    fs.mkdirSync(path.join(VAULT, "Taken/x"), { recursive: true })
    let threw = false
    try { writeAtomic(path.join(VAULT, "Taken"), "text") } catch { threw = true }
    check("a failed write leaves no temporary file", threw && fs.readdirSync(VAULT).every((n) => !n.includes(".tmp-")), fs.readdirSync(VAULT))
    fs.rmSync(path.join(VAULT, "Taken"), { recursive: true })
  }
}
