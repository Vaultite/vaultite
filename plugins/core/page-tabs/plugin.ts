// Page tabs' server side: every page's tabs for the app (state `pageTabs`), and which tab a page is for /api/render.
import { Plugin } from "../../../core/plugins.ts"
import { stemOf } from "../../../core/vault.ts"
import { type PageTab, stripOf, tabFile, tabGroups } from "./tabs.ts"

export const plugin = new Plugin(import.meta.url)

let known: { version: number; groups: PageTab[][] } | null = null
/** Every group of tabs in the vault, worked out again only when its files changed. */
function groups(): PageTab[][] {
  const v = plugin.vault
  if (known?.version !== v.version) {
    const files = [...v.entries].map(([path, e]) => tabFile(path, e.fm))
    known = { version: v.version, groups: files.some((f) => f.tabs) ? tabGroups(files) : [] }
  }
  return known.groups
}

plugin.state(() => ({ pageTabs: groups() }))

/** Under a page's title in /api/render: which tab this is, and links to the others (those of plugins that are on). */
plugin.provide("page-head", ({ path }: { path: string }) => {
  const off = plugin.vault.switchedOff()
  const tabs = stripOf(groups(), path, (t) => !!t.plugin && off.has(t.plugin))
  return tabs.length ? "Tabs: " + tabs.map((t) => (t.path === path ? `**${t.label}**` : `[[${stemOf(t.path)}|${t.label}]]`)).join(" · ") : null
})
