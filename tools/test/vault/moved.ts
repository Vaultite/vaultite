import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { ON, VAULT, api, app, check, exists, read, tmp, vault, write } = $
  // A plugin that moved out of the app to Vaultite's plugins (core/migrations.ts MOVED): the made-up Anchorage, from a
  // made-up Vaultite/plugins on this machine (VAULTITE_GITHUB), installed once where the vault had it on.
  const { MOVED, migrateMoved } = await import("../../../core/migrations.ts")
  const { installFrom } = await import("../../../core/coreops/installs.ts")
  const { execFileSync } = await import("node:child_process")
  const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", "-c", "init.defaultBranch=main",
    "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", ...args], { cwd, stdio: "pipe" })
  const repo = path.join(tmp, "moved-repos", "Vaultite", "plugins")
  const files = { "anchorage/manifest.json": JSON.stringify({ id: "anchorage", name: "Anchorage", description: "Made up: where boats wait.", version: "1.0.0",
    author: "Vaultite", repo: "Vaultite/plugins", disclosures: {}, settings: { berths: { type: "number", default: 3, label: "Berths", description: "how many" } } }),
    "anchorage/plugin.ts": 'import { Plugin } from "@vaultite/core/plugins.ts"\nexport const plugin = new Plugin(import.meta.url)\n' +
      'plugin.route("GET", "anchorage", () => ({ berths: plugin.settings().berths, log: plugin.settings({}, "log").n }))\n' }
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), t) }
  g(repo, "init", "-q"); g(repo, "add", "-A"); g(repo, "commit", "-q", "-m", "anchorage"); g(repo, "tag", "anchorage/v1.0.0")
  const env = process.env.VAULTITE_GITHUB
  process.env.VAULTITE_GITHUB = pathToFileURL(path.join(tmp, "moved-repos")).href
  MOVED.anchorage = "Vaultite/plugins/anchorage"
  MOVED.mooring = "Vaultite/plugins/mooring" // (moved, but off in this vault: nothing to install)
  const installer = { vault: app.vault, has: (id: string) => app.app.some((p) => p.id === id), install: (s: string) => installFrom(app, s, null, { moved: true }) }
  const done = () => (vault.readConfig("migrations")?.done ?? []) as string[]
  // On here, with its settings: data.json and a file of its own (plugin.settings({}, "log")).
  write(".vaultite/plugins/anchorage/data.json", JSON.stringify({ berths: 7 }) + "\n")
  write(".vaultite/plugins/anchorage/log.json", JSON.stringify({ n: 2 }) + "\n")
  write(".vaultite/plugins/mooring/data.json", JSON.stringify({ kept: 1 }) + "\n")
  await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: [...ON, "anchorage"] })
  // Offline first: not installed, tried again at the next start.
  await migrateMoved({ ...installer, install: async () => { throw new Error("offline") } })
  check("moved: one that can't be fetched now is tried again later", !exists(".vaultite/plugins/anchorage/manifest.json") && !done().includes("moved:anchorage") && done().includes("moved:mooring"), done())
  await migrateMoved(installer)
  const lock = vault.config("plugins-lock").anchorage as Any
  check("moved: on in the vault, it's installed from where it went, said as moved", exists(".vaultite/plugins/anchorage/plugin.ts") && lock?.source === "Vaultite/plugins/anchorage" &&
    lock.moved === true && lock.tag === "anchorage/v1.0.0" && done().includes("moved:anchorage"), [lock, done()])
  check("moved: its settings and on-state stay", JSON.parse(read(".vaultite/plugins/anchorage/data.json")).berths === 7 && JSON.parse(read(".vaultite/plugins/anchorage/log.json")).n === 2 &&
    (vault.config("plugins").enabled as string[]).includes("anchorage"))
  check("moved: off in the vault, nothing installed, its settings kept", !exists(".vaultite/plugins/mooring/manifest.json") && JSON.parse(read(".vaultite/plugins/mooring/data.json")).kept === 1)
  const vp = async () => ((await api("GET", "plugins"))[1] as Any[]).find((p) => p.id === "anchorage")
  let a = await vp()
  check("moved: it waits for this machine's yes, asked as one that moved (nothing of it runs yet)", a.on && !a.loaded && a.approval?.state === "moved" && (await api("GET", "anchorage"))[0] === 404, a)
  const [ac] = await api("POST", "ops/plugin.allow", { id: "anchorage", hash: a.hash })
  const [, got] = await api("GET", "anchorage")
  a = await vp()
  check("moved: allowed, it runs with the settings it had", ac === 200 && a.loaded && !a.approval && got.berths === 7 && got.log === 2, [ac, got, a])
  await migrateMoved({ ...installer, install: async () => { throw new Error("ran again") } })
  check("moved: once (a synced vault's other machine skips it)", done().includes("moved:anchorage"))
  // A bundle naming it as one of the app's (saved before it moved) installs it from where it went.
  const B = await import("../../../core/bundles.ts")
  fs.rmSync(path.join(VAULT, ".vaultite/plugins/anchorage"), { recursive: true })
  write(".vaultite/plugins/anchorage/data.json", JSON.stringify({ berths: 7 }) + "\n")
  await app.syncPlugins()
  const plan = await B.plan({ id: "harbour", source: "vault", files: { "plugins.json": JSON.stringify({ enabled: ["anchorage"] }) } }, app.host(), null)
  check("moved: a bundle naming it as the app's installs it from where it went", plan.code.some((c) => c.id === "anchorage" && c.source === "Vaultite/plugins/anchorage") &&
    !plan.plugins.missing.includes("anchorage"), plan.code)
  // tidy up
  delete MOVED.anchorage
  delete MOVED.mooring
  for (const id of ["anchorage", "mooring"]) fs.rmSync(path.join(VAULT, ".vaultite/plugins", id), { recursive: true, force: true })
  const lk = { ...vault.config("plugins-lock") }
  delete lk.anchorage
  if (Object.keys(lk).length) vault.setConfig("plugins-lock", lk); else vault.removeConfig("plugins-lock")
  vault.patchConfig("migrations", { done: done().filter((d) => !d.startsWith("moved:anchorage") && !d.startsWith("moved:mooring")) })
  await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: ON })
  app.vaultPlugins.trust.forget("anchorage")
  process.env.VAULTITE_GITHUB = env
  if (env === undefined) delete process.env.VAULTITE_GITHUB
  await app.syncPlugins()
}
