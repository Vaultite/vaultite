import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { app, check } = $
  // Plugins find each other's settings and services through the API, never by reading files or naming ids in the core.
  const { settingsProblems } = await import("../../../core/rules.ts")
  check("rules: another plugin's settings or plugins.json read from disk are flagged",
    settingsProblems('const f = JSON.parse(fs.readFileSync(vault.abs(".vaultite/plugins/templates/data.json"), "utf8"))', "x", "query").length === 1
    && settingsProblems('fs.readFileSync(path.join(v, ".vaultite", "plugins.json"), "utf8")', "x", "query").length === 1
    && settingsProblems('plugin.vault.config("plugins/logs/data").areas', "x", "today").length === 1
    && settingsProblems('plugin.vault.config("plugins/today/data")', "x", "today").length === 0
    && settingsProblems('help: "in .vaultite/plugins/workspaces/data.json"', "x", "today").length === 0
    && settingsProblems('const off = plugin.vault.config("plugins").disabled', "x", "today").length === 1)
  check("services: the core finds People's geocoder by name", typeof (await import("../../../core/plugins.ts")).service(app.plugins, "geocode") === "function")
  {
    const { geocoder } = await import("../../../plugins/core/people/geocode.ts")
    let cache: Any = {}, asked: string[] = [], down = true
    const g = geocoder(() => cache, (c) => { cache = c }, async (q) => {
      asked.push(q)
      if (down) throw new Error("offline")
      return q === "Lisbon" ? [38.7223, -9.1393] : null
    }, 0)
    check("geocoder: offline is no pin, and not remembered", (await g.locate("Lisbon")) === null && !("lisbon" in cache), cache)
    down = false
    const [a, b] = await Promise.all([g.locate("Lisbon"), g.locate(" lisbon ")])
    check("geocoder: one lookup for the same place, then the cache", a?.[0] === 38.7223 && b === a && asked.length === 2 && (await g.locate("LISBON")) === a && asked.length === 2, asked)
    check("geocoder: not found is remembered as no pin", (await g.locate("Atlantis")) === null && cache.atlantis === null && g.known("Atlantis") === null && g.known("Paris") === undefined, cache)
  }
}
