/**
 * Lighthouse: a made-up vault plugin, the example the tests and QA write into a throwaway vault's
 * .vaultite/plugins/lighthouse/ (tools/test_vault.ts, web/qa/vaultplugins.mjs). Keepers/<Name>.md are keepers
 * (`shift`: day | night); GET /api/lighthouse says whether the beam is on; ```block-lighthouse shows both.
 */
import { bullets, Plugin, section } from "@vaultite/core/plugins.ts"
import { Kind, str } from "@vaultite/core/vault.ts"
import { beam } from "./beam.ts"

export const plugin = new Plugin(import.meta.url)

plugin.kind(new Kind({
  type: "keeper", collection: "keepers", folder: "Keepers", titleKey: "name",
  parse: (fm, body, stem) => [{ name: stem, shift: str(fm.shift || "day"), notes: body }, []],
  render: (k) => [{ shift: k.shift }, k.notes || ""],
}))

const now = () => beam(Number(plugin.settings({}).dusk ?? 19), new Date().getHours())

plugin.route("GET", "lighthouse", () => ({ beam: now(), keepers: plugin.vault.items("keepers").length }))

plugin.block("lighthouse", () => {
  const keepers = plugin.vault.items("keepers")
  return section("Lighthouse", bullets([`Beam: ${now()}`, ...keepers.map((k) => `[[${k.name}]]: ${k.shift} shift`)]))
})

// `beam` in inline code reads as whether it's on (the service `inline-code`; other inline code stays as it is).
plugin.provide("inline-code", (ctx: { code: string }) => (ctx.code.trim() === "=beam" ? `the beam is ${now()}` : null))
