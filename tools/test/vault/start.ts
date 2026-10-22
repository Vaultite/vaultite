import fs from "node:fs"
import path from "node:path"
import type { VaultTest } from "./harness.ts"
import { MOVED, NOW_OPT_IN } from "../../../core/migrations.ts"

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
    check("new vault, starter content chosen: the agent's page (Claude), not pinned, not the others' (Errors)", !fs.existsSync(path.join(fresh, "Dashboards/Errors.md")) &&
      fs.existsSync(path.join(fresh, "Dashboards/Claude.md")) && !fs.existsSync(path.join(fresh, "Dashboards/People.md")), fs.readdirSync(path.join(fresh, "Dashboards")))
    const how = fs.readFileSync(path.join(fresh, "How this vault works.md"), "utf8")
    check("new vault, starter content chosen: How this vault works, linked from Start here", how.includes("\\text{notes a year}") && how.includes("```mermaid") &&
      fs.readFileSync(path.join(fresh, "Start here.md"), "utf8").includes("[[How this vault works]]"), how.slice(0, 400))
    await freshApp.vault.sync()
    check("new vault, starter content chosen: agents started in it find its rules", fs.existsSync(path.join(fresh, "CLAUDE.md")) && /\.vaultite\/AGENTS\.md/.test(fs.readFileSync(path.join(fresh, "CLAUDE.md"), "utf8")), fs.readdirSync(fresh))
    check("new vault: nothing to restore, nothing offered", !fs.existsSync(path.join(fresh, ".vaultite/bundles/previous.json")) && !fs.existsSync(path.join(fresh, ".vaultite/bundles/onboarding.json")))
    await freshApp.host().call("POST", "bundles/standard/apply", {})
    await freshApp.state()
    check("new vault, Standard applied: what it had, no plugin's page added (Errors, People)", JSON.stringify(fs.readdirSync(path.join(fresh, "Dashboards"))) === '["Claude.md"]',
      fs.readdirSync(path.join(fresh, "Dashboards")))
    const inUse = async () => ((await freshApp.host().call("GET", "bundles")) as { bundles: { id: string; inUse?: boolean }[] }).bundles.filter((b) => b.inUse).map((b) => b.id)
    const was = await inUse()
    await freshApp.host().call("PATCH", "config/appearance", { scheme: "nord" })
    const changed = await inUse()
    await freshApp.host().call("PATCH", "config/appearance", { scheme: null })
    check("new vault: Standard is in use, until the setup changes", JSON.stringify(was) === '["standard"]' && !changed.length && JSON.stringify(await inUse()) === '["standard"]', [was, changed])
    // Each of the app's bundles says every part any of them says (Standard the defaults): Zen, then Standard, is a new
    // vault's Standard again, every settings file as it was (key order aside).
    const sorted = (x: unknown): unknown => Array.isArray(x) ? x.map(sorted) : x && typeof x === "object"
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, sorted(v)])) : x
    const configs = () => {
      const dir = path.join(fresh, ".vaultite/plugins")
      const names = ["appearance", "plugins", "sidebars", "pages", "newtab", "hotkeys", ...(fs.existsSync(dir) ? fs.readdirSync(dir).map((id) => `plugins/${id}/data`) : [])]
      return JSON.stringify(Object.fromEntries(names.flatMap((n) => { const o = conf(fresh, n); return o && Object.keys(o).length ? [[n, sorted(o)]] : [] })))
    }
    const standard = configs()
    await freshApp.host().call("POST", "bundles/zen/apply", {})
    const zen = configs()
    await freshApp.host().call("POST", "bundles/standard/apply", {})
    check("new vault: Zen, then Standard, is Standard again (every settings file as it was)", zen !== standard && configs() === standard, [standard, zen, configs()])
    const own = path.join(tmp, "Own notes")
    fs.mkdirSync(path.join(own, "Ideas"), { recursive: true })
    fs.writeFileSync(path.join(own, "Ideas/One.md"), "An idea.\n")
    await open(own)
    const files = fs.readdirSync(own, { recursive: true }).map(String).filter((f) => !f.startsWith(".vaultite")).sort()
    check("a folder of notes: Standard, and nothing added among its files", !(conf(own, "plugins")?.enabled ?? []).length && JSON.stringify(files) === '["Ideas","Ideas/One.md"]'
      && fs.readFileSync(path.join(own, "Ideas/One.md"), "utf8") === "An idea.\n", files)
    check("new vault: its settings start up to date (core/migrations.ts)", conf(fresh, "migrations")?.done?.includes("plugins-opt-in-2026-10") && conf(fresh, "migrations")?.done?.includes("daily-notes-2026-10") && !(pj?.enabled ?? []).includes("codex"), conf(fresh, "migrations"))
    // Opened before, from when the agents' plugins were on from the start: what was on stays on, once (but those that
    // moved out of the app since: they'd be installed).
    const STILL = NOW_OPT_IN.filter((id) => !Object.hasOwn(MOVED, id))
    const opened = path.join(tmp, "Opened before")
    fs.mkdirSync(path.join(opened, ".vaultite"), { recursive: true })
    await open(opened)
    check("a vault the app opened before keeps its setup", JSON.stringify(conf(opened, "plugins")?.enabled) === JSON.stringify(STILL) && !fs.existsSync(path.join(opened, "Start here.md")), conf(opened, "plugins"))
    const older = path.join(tmp, "Older setup")
    fs.mkdirSync(path.join(older, ".vaultite"), { recursive: true })
    fs.writeFileSync(path.join(older, ".vaultite/plugins.json"), JSON.stringify({ disabled: ["codex", "clipper"], enabled: ["people"], order: ["people"] }))
    await open(older)
    const op = conf(older, "plugins")
    check("migrated: the ones that became opt-in and were on are in enabled, the others' lists as they were", op.disabled.join() === "clipper" && op.order.join() === "people" &&
      op.enabled.join() === ["people", ...STILL.filter((id) => id !== "codex")].join(), op)
    fs.writeFileSync(path.join(older, ".vaultite/plugins.json"), JSON.stringify({ ...op, enabled: ["people"] }))
    await open(older)
    check("migrated once: turned off since, they stay off", conf(older, "plugins").enabled.join() === "people", conf(older, "plugins"))
    // Daily notes out of Today: its settings (not over Daily notes' own), hotkey and button follow, in saved bundles and
    // the setup a restore puts back too.
    const daily = path.join(tmp, "Daily before")
    const put = (rel: string, o: unknown) => { fs.mkdirSync(path.dirname(path.join(daily, rel)), { recursive: true }); fs.writeFileSync(path.join(daily, rel), JSON.stringify(o)) }
    put(".vaultite/plugins/today/data.json", { format: "YYYY/MM/YYYY-MM-DD", template: "Templates/Day" })
    put(".vaultite/plugins/daily-notes/data.json", { template: "Templates/Mine" })
    put(".vaultite/hotkeys.json", { "file:new": ["Mod+N"], "today:daily-note": ["Mod+D"] })
    put(".vaultite/newtab.json", { actions: ["file:new", "today:daily-note"], icons: { "today:daily-note": "sun" } })
    put(".vaultite/bundles/mine/plugins/today/data.json", { format: "DD-MM-YYYY", other: 1 })
    put(".vaultite/bundles/previous.json", { bundle: "mine", name: "Mine", at: "2026-10-01", config: { hotkeys: { "today:daily-note": null }, "plugins/today/data": { format: null } },
      absent: ["plugins/today/data"], pins: null, pinned: [], workspace: null, added: [] })
    await open(daily)
    check("migrated: Today's daily note settings are Daily notes' (its own kept), Today's file gone", JSON.stringify(conf(daily, "plugins/daily-notes/data")) === '{"template":"Templates/Mine","format":"YYYY/MM/YYYY-MM-DD"}'
      && !fs.existsSync(path.join(daily, ".vaultite/plugins/today/data.json")), conf(daily, "plugins/daily-notes/data"))
    check("migrated: the command's hotkey and button follow it, in their place", JSON.stringify(conf(daily, "hotkeys")) === '{"file:new":["Mod+N"],"daily-notes:today":["Mod+D"]}'
      && JSON.stringify(conf(daily, "newtab")) === '{"actions":["file:new","daily-notes:today"],"icons":{"daily-notes:today":"sun"}}', [conf(daily, "hotkeys"), conf(daily, "newtab")])
    check("migrated: a saved bundle's daily note settings too, its other keys kept", JSON.stringify(conf(daily, "bundles/mine/plugins/daily-notes/data")) === '{"format":"DD-MM-YYYY"}'
      && JSON.stringify(conf(daily, "bundles/mine/plugins/today/data")) === '{"other":1}', conf(daily, "bundles/mine/plugins/today/data"))
    const prev = conf(daily, "bundles/previous")
    check("migrated: a restore puts back Daily notes' keys", JSON.stringify(prev?.config) === '{"hotkeys":{"daily-notes:today":null},"plugins/today/data":{},"plugins/daily-notes/data":{"format":null}}'
      && prev.absent.includes("plugins/daily-notes/data") && conf(daily, "migrations")?.done?.includes("daily-notes-2026-10"), prev)
    // The status bar's file items joined its list: a saved one gets them after its own (unset and bundles' too).
    const bar = path.join(tmp, "Status bar before")
    const putBar = (rel: string, o: unknown) => { fs.mkdirSync(path.dirname(path.join(bar, rel)), { recursive: true }); fs.writeFileSync(path.join(bar, rel), JSON.stringify(o)) }
    putBar(".vaultite/appearance.json", { theme: "dark", statusBar: ["inbox:new"] })
    putBar(".vaultite/bundles/mine/appearance.json", { statusBar: [] })
    putBar(".vaultite/bundles/other/appearance.json", { statusBar: null })
    await open(bar)
    const FILE = "vim:mode,properties:chips,provenance:origin,core:view,core:words,core:characters,token-count:tokens"
    check("migrated: a saved status bar list has the file's items after its own", conf(bar, "appearance")?.statusBar?.join() === `inbox:new,${FILE}` && conf(bar, "appearance")?.theme === "dark", conf(bar, "appearance"))
    check("migrated: a saved bundle's too, an unset one left unset", conf(bar, "bundles/mine/appearance")?.statusBar?.join() === FILE && conf(bar, "bundles/other/appearance")?.statusBar === null,
      [conf(bar, "bundles/mine/appearance"), conf(bar, "bundles/other/appearance")])
    // Kinds' stamps were UTC: now the vault's local time, a user's own time keys left as they were.
    const stamped = path.join(tmp, "Stamped before")
    fs.mkdirSync(path.join(stamped, ".vaultite"), { recursive: true })
    fs.mkdirSync(path.join(stamped, "Notes/.archive"), { recursive: true })
    const note = "---\ntype: note\ncreated: '2026-10-18 05:11:09'\nupdated: 2026-10-18 05:12:00\nmet: '2026-10-18 05:11:09'\n---\nBody.\n"
    fs.writeFileSync(path.join(stamped, "Notes/.archive/Old.md"), note)
    fs.writeFileSync(path.join(stamped, "Home.md"), "```base\nviews: []\nwide: true\n```\n")
    await open(stamped)
    check("migrated: a base's wide is in its info line, where a fence a plugin draws keeps it", fs.readFileSync(path.join(stamped, "Home.md"), "utf8") === "```base wide\nviews: []\n```\n",
      fs.readFileSync(path.join(stamped, "Home.md"), "utf8"))
    const local = (s: string) => { const d = new Date(`${s}Z`), p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` }
    const got = fs.readFileSync(path.join(stamped, "Notes/.archive/Old.md"), "utf8")
    check("migrated: a note's created and updated in local time, other keys and the body as they were", got.includes(`created: '${local("2026-10-18T05:11:09")}'`)
      && got.includes(local("2026-10-18T05:12:00")) && got.includes("met: '2026-10-18 05:11:09'") && got.endsWith("---\nBody.\n"), got)
    // A new vault still being offered the bundles writes no page; given Standard (the plugins already on), still none:
    // as a new vault, no dashboards.
    const offered = path.join(tmp, "Offered")
    fs.mkdirSync(path.join(offered, ".vaultite/bundles"), { recursive: true })
    fs.writeFileSync(path.join(offered, ".vaultite/bundles/onboarding.json"), "{}\n")
    const o = await open(offered)
    await o.state()
    const none = !fs.existsSync(path.join(offered, "Dashboards"))
    await o.host().call("POST", "bundles/standard/apply", {})
    await o.state()
    check("Standard picked: as a new vault, no plugin's page", none && !fs.existsSync(path.join(offered, "Dashboards")), fs.existsSync(path.join(offered, "Dashboards")) && fs.readdirSync(path.join(offered, "Dashboards")))
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
