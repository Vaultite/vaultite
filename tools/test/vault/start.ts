import fs from "node:fs"
import path from "node:path"
import type { VaultTest } from "./harness.ts"
import { NOW_OPT_IN } from "../../../core/migrations.ts"

// The app's own plugins that are off until turned on: Standard (the app's defaults) turns none of them on.
const optIn = fs.readdirSync(path.join(import.meta.dirname, "../../../plugins/core")).filter((id) => {
  try { return !!JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../../plugins/core", id, "manifest.json"), "utf8")).offByDefault } catch { return false }
})

export default async ($: VaultTest) => {
  const { check, open, tmp } = $
  // A vault opened for the first time starts from Standard (core/start.ts), writing nothing outside .vaultite/; a new one
  // gets Start here only when the user chose it (vault.starter). Last: opening another vault binds the plugins to it.
  {
    const conf = (dir: string, name: string) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `.vaultite/${name}.json`), "utf8")) } catch { return null } }
    const fresh = path.join(tmp, "Fresh vault")
    fs.mkdirSync(fresh)
    const freshApp = await open(fresh)
    const pj = conf(fresh, "plugins"), look = conf(fresh, "appearance")
    check("new vault: Standard's plugins (a terminal and Claude Code, none that's off until turned on)", !(pj?.enabled ?? []).some((id: string) => optIn.includes(id))
      && !pj?.disabled?.includes("terminal") && !pj?.disabled?.includes("claude-code") && !pj?.disabled?.includes("provenance"), pj)
    check("new vault: Standard's look (Gruvbox, the default: unset)", !look?.scheme && look?.fileIcons === false, look)
    check("new vault: nothing outside .vaultite/ until asked", JSON.stringify(fs.readdirSync(fresh)) === '[".vaultite"]', fs.readdirSync(fresh))
    await freshApp.callOp("vault.starter", {})
    const fp = conf(fresh, "pages")
    check("new vault, starter content chosen: Start here, the only pin", JSON.stringify(fp?.pinned) === '["Start here.md"]'
      && fs.readFileSync(path.join(fresh, "Start here.md"), "utf8").includes("claude"), [fp, fs.readdirSync(fresh)])
    check("new vault, starter content chosen: its plugins' pages (Errors, Claude), not pinned", fs.existsSync(path.join(fresh, "Dashboards/Errors.md")) &&
      fs.existsSync(path.join(fresh, "Dashboards/Claude.md")) && !fs.existsSync(path.join(fresh, "Dashboards/People.md")), fs.readdirSync(path.join(fresh, "Dashboards")))
    await freshApp.vault.sync()
    check("new vault, starter content chosen: agents started in it find its rules", fs.existsSync(path.join(fresh, "CLAUDE.md")) && /\.vaultite\/AGENTS\.md/.test(fs.readFileSync(path.join(fresh, "CLAUDE.md"), "utf8")), fs.readdirSync(fresh))
    check("new vault: nothing to restore, nothing offered", !fs.existsSync(path.join(fresh, ".vaultite/bundles/previous.json")) && !fs.existsSync(path.join(fresh, ".vaultite/bundles/onboarding.json")))
    const own = path.join(tmp, "Own notes")
    fs.mkdirSync(path.join(own, "Ideas"), { recursive: true })
    fs.writeFileSync(path.join(own, "Ideas/One.md"), "An idea.\n")
    await open(own)
    const files = fs.readdirSync(own, { recursive: true }).map(String).filter((f) => !f.startsWith(".vaultite")).sort()
    check("a folder of notes: Standard, and nothing added among its files", !(conf(own, "plugins")?.enabled ?? []).length && JSON.stringify(files) === '["Ideas","Ideas/One.md"]'
      && fs.readFileSync(path.join(own, "Ideas/One.md"), "utf8") === "An idea.\n", files)
    check("new vault: its settings start up to date (core/migrations.ts)", conf(fresh, "migrations")?.done?.includes("plugins-opt-in-2026-10") && !(pj?.enabled ?? []).includes("codex"), conf(fresh, "migrations"))
    // Opened before, from when the agents' plugins were on from the start: what was on stays on, once.
    const opened = path.join(tmp, "Opened before")
    fs.mkdirSync(path.join(opened, ".vaultite"), { recursive: true })
    await open(opened)
    check("a vault the app opened before keeps its setup", JSON.stringify(conf(opened, "plugins")?.enabled) === JSON.stringify(NOW_OPT_IN) && !fs.existsSync(path.join(opened, "Start here.md")), conf(opened, "plugins"))
    const older = path.join(tmp, "Older setup")
    fs.mkdirSync(path.join(older, ".vaultite"), { recursive: true })
    fs.writeFileSync(path.join(older, ".vaultite/plugins.json"), JSON.stringify({ disabled: ["codex", "clipper"], enabled: ["people"], order: ["people"] }))
    await open(older)
    const op = conf(older, "plugins")
    check("migrated: the ones that became opt-in and were on are in enabled, the others' lists as they were", op.disabled.join() === "clipper" && op.order.join() === "people" &&
      op.enabled.join() === ["people", ...NOW_OPT_IN.filter((id) => id !== "codex")].join(), op)
    fs.writeFileSync(path.join(older, ".vaultite/plugins.json"), JSON.stringify({ ...op, enabled: ["people"] }))
    await open(older)
    check("migrated once: turned off since, they stay off", conf(older, "plugins").enabled.join() === "people", conf(older, "plugins"))
    // A new vault still being offered the bundles writes no page; given one that pins nothing, its plugins write theirs,
    // none pinned.
    const offered = path.join(tmp, "Offered")
    fs.mkdirSync(path.join(offered, ".vaultite/bundles"), { recursive: true })
    fs.writeFileSync(path.join(offered, ".vaultite/bundles/onboarding.json"), "{}\n")
    const o = await open(offered)
    await o.state()
    const none = !fs.existsSync(path.join(offered, "Dashboards"))
    await o.host().call("POST", "bundles/standard/apply", {})
    await o.state()
    check("a setup picked: its plugins write their pages (not Design)", none && fs.existsSync(path.join(offered, "Dashboards/Errors.md")) && !fs.existsSync(path.join(offered, "Dashboards/Design.md")))
    check("a bundle pinning nothing pins nothing (not Errors)", JSON.stringify(conf(offered, "pages")?.pinned) === "[]", conf(offered, "pages"))
    // Skipping the offer starts from Standard, with nothing to restore.
    const skipped = path.join(tmp, "Skipped")
    fs.mkdirSync(path.join(skipped, ".vaultite/bundles"), { recursive: true })
    fs.writeFileSync(path.join(skipped, ".vaultite/bundles/onboarding.json"), "{}\n")
    const sk = await open(skipped)
    const after = await sk.host().call("POST", "bundles/onboarding", {}) as { onboarding: boolean; previous: unknown }
    check("skipping the offer: Standard, nothing offered or to restore", !(conf(skipped, "plugins")?.enabled ?? []).length && !after.onboarding && !after.previous
      && !fs.existsSync(path.join(skipped, ".vaultite/bundles/previous.json")), [after, conf(skipped, "plugins")])
  }
}
