import fs from "node:fs"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { check, open, tmp } = $
  // A vault opened for the first time starts from Minimal (core/start.ts), writing nothing outside .vaultite/; a new one
  // gets Start here only when the user chose it (vault.starter). Last: opening another vault binds the plugins to it.
  {
    const conf = (dir: string, name: string) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `.vaultite/${name}.json`), "utf8")) } catch { return null } }
    const fresh = path.join(tmp, "Fresh vault")
    fs.mkdirSync(fresh)
    const freshApp = await open(fresh)
    const pj = conf(fresh, "plugins"), look = conf(fresh, "appearance")
    check("new vault: Minimal's plugins (a terminal and Claude Code, none of Life OS)", !(pj?.enabled ?? []).includes("people") && !(pj?.enabled ?? []).includes("today") && !pj?.disabled?.includes("terminal")
      && !pj.disabled.includes("claude-code") && !pj.disabled.includes("provenance"), pj)
    check("new vault: Minimal's look (Gruvbox, the default: unset)", !look?.scheme && look?.fileIcons === false, look)
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
    check("a folder of notes: Minimal, and nothing added among its files", conf(own, "plugins")?.disabled?.includes("activity") && JSON.stringify(files) === '["Ideas","Ideas/One.md"]'
      && fs.readFileSync(path.join(own, "Ideas/One.md"), "utf8") === "An idea.\n", files)
    const opened = path.join(tmp, "Opened before")
    fs.mkdirSync(path.join(opened, ".vaultite"), { recursive: true })
    await open(opened)
    check("a vault the app opened before keeps its setup", !conf(opened, "plugins") && !fs.existsSync(path.join(opened, "Start here.md")))
    // A new vault still being offered the bundles writes no page; given one that pins nothing, its plugins write theirs,
    // none pinned.
    const offered = path.join(tmp, "Offered")
    fs.mkdirSync(path.join(offered, ".vaultite/bundles"), { recursive: true })
    fs.writeFileSync(path.join(offered, ".vaultite/bundles/onboarding.json"), "{}\n")
    const o = await open(offered)
    await o.state()
    const none = !fs.existsSync(path.join(offered, "Dashboards"))
    await o.host().call("POST", "bundles/minimal/apply", {})
    await o.state()
    check("a setup picked: its plugins write their pages (not Design)", none && fs.existsSync(path.join(offered, "Dashboards/Errors.md")) && !fs.existsSync(path.join(offered, "Dashboards/Design.md")))
    check("a bundle pinning nothing pins nothing (not Errors)", JSON.stringify(conf(offered, "pages")?.pinned) === "[]", conf(offered, "pages"))
    // Skipping the offer starts from Minimal, with nothing to restore.
    const skipped = path.join(tmp, "Skipped")
    fs.mkdirSync(path.join(skipped, ".vaultite/bundles"), { recursive: true })
    fs.writeFileSync(path.join(skipped, ".vaultite/bundles/onboarding.json"), "{}\n")
    const sk = await open(skipped)
    const after = await sk.host().call("POST", "bundles/onboarding", {}) as { onboarding: boolean; previous: unknown }
    check("skipping the offer: Minimal, nothing offered or to restore", conf(skipped, "plugins")?.disabled?.includes("activity") && !after.onboarding && !after.previous
      && !fs.existsSync(path.join(skipped, ".vaultite/bundles/previous.json")), [after, conf(skipped, "plugins")])
  }
}
