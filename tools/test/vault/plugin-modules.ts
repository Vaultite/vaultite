import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { ON, VAULT, api, app, check, vault, write } = $
  // A plugin's modules for plugins that require it (manifest `exports`, @plugins/<id>/<module>): made-up vault plugins,
  // Beacon offering `lamp`, Anchor (loaded first by name) and Buoy requiring it, and one asking for what isn't offered.
  const man = (id: string, o: Any = {}) => JSON.stringify({ id, name: id[0].toUpperCase() + id.slice(1), description: "Made up.", ...o })
  const route = (id: string, src: string) => `import { Plugin } from "@vaultite/core/plugins.ts"\n${src}\nexport const plugin = new Plugin(import.meta.url)\n` +
    `plugin.route("GET", "${id}", () => ({ beam: beam() }))\n`
  write(".vaultite/plugins/beacon/manifest.json", man("beacon", { exports: ["lamp", "keeper"] }))
  write(".vaultite/plugins/beacon/lamp.ts", "let lit = 0\nexport const beam = () => `on ${++lit}`\n")
  // (a backend's module: Node's, never in the browser)
  write(".vaultite/plugins/beacon/keeper.ts", 'import os from "node:os"\nexport const host = () => typeof os.hostname()\n')
  write(".vaultite/plugins/beacon/plugin.ts", route("beacon", 'import { beam } from "./lamp.ts"'))
  write(".vaultite/plugins/anchor/manifest.json", man("anchor", { requires: ["beacon"] }))
  write(".vaultite/plugins/anchor/plugin.ts", route("anchor", 'import { beam } from "@plugins/beacon/lamp"\nimport { host } from "@plugins/beacon/keeper"\nhost()'))
  write(".vaultite/plugins/anchor/index.tsx", 'import { definePlugin } from "@vaultite"\nimport { beam } from "@plugins/beacon/lamp"\n' +
    'export default definePlugin({ commands: [{ id: "anchor:beam", name: "Beam", run: () => { beam() } }] })\n')
  write(".vaultite/plugins/buoy/manifest.json", man("buoy"))
  write(".vaultite/plugins/buoy/plugin.ts", route("buoy", 'import { beam } from "@plugins/beacon/lamp"'))
  write(".vaultite/plugins/raft/manifest.json", man("raft", { requires: ["beacon"] }))
  write(".vaultite/plugins/raft/plugin.ts", route("raft", 'import { beam } from "@plugins/beacon/plugin"'))
  const all = ["beacon", "anchor", "buoy", "raft"]
  await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: [...ON, ...all] })
  for (const id of all) app.vaultPlugins.allow(id)
  const vp = async (id: string) => ((await api("GET", "plugins"))[1] as Any[]).find((p) => p.id === id)
  const [ac, ao] = await api("GET", "anchor"), [bc, bo] = await api("GET", "beacon")
  check("modules: a plugin imports what one it requires exports, the same module as its own (loaded after it)", ac === 200 && bc === 200 &&
    ao.beam === "on 1" && bo.beam === "on 2", [ao, bo, await vp("anchor")])
  check("modules: not without requiring it", (await vp("buoy")).problems.some((p: string) => p.includes("only from plugins it `requires`")), (await vp("buoy")).problems)
  check("modules: only what it exports", (await vp("raft")).problems.some((p: string) => p.includes("doesn't export 'plugin'")), (await vp("raft")).problems)
  const anchor = await vp("anchor"), beacon = await vp("beacon")
  const [, code] = await api("GET", `plugins/anchor/${anchor.bundle}/bundle.js`), [, offer] = await api("GET", `plugins/beacon/${beacon.bundle}/bundle.js`)
  check("modules: in the app, its bundle loads them first; the exporter's bundle offers them (no index.tsx needed)",
    code.includes('preload(["@plugins/beacon/lamp"])') && typeof offer === "string" && offer.includes("__exports"), [code.slice(0, 300), String(offer).slice(0, 300)])
  check("modules: a backend's module is offered to backends only, not in its bundle", !beacon.problems.length && String(offer).includes("{lamp:") && !String(offer).includes("keeper"), [beacon.problems, String(offer).slice(-200)])
  write(".vaultite/plugins/beacon/lamp.ts", "let lit = 10\nexport const beam = () => `on ${++lit}`\n")
  app.vaultPlugins.allow("beacon")
  const [, again] = await api("GET", "anchor")
  check("modules: a new version of what it imports loads it again", again.beam === "on 11" && (await vp("anchor")).hash === anchor.hash && (await vp("anchor")).bundle !== anchor.bundle, again)
  const rules = await import("../../../core/rules.ts")
  check("modules: exports are paths in its folder, never its entry points", rules.metaProblems({ exports: ["types", "lib/format"] }).length === 0 &&
    rules.metaProblems({ exports: ["plugin"] }).length === 1 && rules.metaProblems({ exports: ["../x"] }).length === 1)
  write(".vaultite/plugins/beacon/manifest.json", man("beacon", { exports: ["lamp", "keeper", "gone"] }))
  check("modules: one it exports must be there", (await vp("beacon")).problems.some((p: string) => p.includes("exports 'gone'")), (await vp("beacon")).problems)
  // An app plugin's module, for a vault plugin requiring it (Logs' helpers, which Health builds on).
  write(".vaultite/plugins/skiff/manifest.json", man("skiff", { requires: ["logs"] }))
  write(".vaultite/plugins/skiff/index.tsx", 'import { definePlugin } from "@vaultite"\nimport { minutes } from "@plugins/logs/types"\n' +
    'export default definePlugin({ commands: [{ id: "skiff:time", name: "Time", run: () => { minutes([]) } }] })\n')
  await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: [...ON, "logs", "skiff"] })
  app.vaultPlugins.allow("skiff")
  const skiff = await vp("skiff"), [, sb] = await api("GET", `plugins/skiff/${skiff.bundle}/bundle.js`)
  check("modules: a vault plugin imports an app plugin's", !skiff.problems.length && String(sb).includes('preload(["@plugins/logs/types"])'), [skiff.problems, String(sb).slice(0, 300)])
  await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: ON })
  for (const id of [...all, "skiff"]) { fs.rmSync(path.join(VAULT, ".vaultite/plugins", id), { recursive: true }); app.vaultPlugins.trust.forget(id) }
  await app.syncPlugins()
}
