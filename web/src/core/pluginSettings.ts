// A plugin's settings sheet: a plugin has one when it draws a panel, declares settings in its manifest, or has a
// data.json. Only while it's on.
import { getStore, type Store } from "@/core/data"
import type { Plugin } from "@/core/define"
import { openDetail } from "@/core/nav"
import { isEnabled, PLUGINS } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import type { Command } from "@/core/commands"

/** Where a plugin's settings are kept. */
export const settingsFile = (id: string) => `.vaultite/plugins/${id}/data.json`
/** A plugin's settings sheet's name: "Vim settings", but "Style settings" as it is. */
export const settingsTitle = (name: string) => (/\bsettings$/i.test(name) ? name : `${name} settings`)

/** Whether a plugin has anything to set (whether it's on or not). `files`: the ids with a settings file. */
export function hasSettings(p: Plugin, files: string[] = getStore()?.pluginSettings ?? []) {
  return !!p.settingsPanel || Object.keys(p.settingsDecls ?? {}).length > 0 || files.includes(p.id) ||
    !!getStore()?.filing?.homes.some((h) => h.plugin === p.id) || !!getStore()?.writeGrants?.some((g) => g.plugin === p.id)
}

/** The plugins whose settings can be opened now: on, with something to set. */
export const withSettings = (store: Store | null = getStore(), disabled = getPrefs().disabled) =>
  PLUGINS.filter((p) => isEnabled(p.id, disabled) && hasSettings(p, store?.pluginSettings ?? []))

let goingTo: { id: string; key: string } | null = null

/** Open a plugin's settings sheet (over the sheet that's open, if any); `key`: the setting to go to (its row's
 *  `data-setting`), scrolled to and flashed once the sheet has drawn it. */
export function openPluginSettings(id: string, key?: string) {
  goingTo = key ? { id, key } : null
  openDetail(`plugin-settings/${encodeURIComponent(id)}`)
}

/** The setting the sheet just opened for `id` should go to (once: taken). */
export function takeGoingTo(id: string) {
  const g = goingTo?.id === id ? goingTo.key : null
  goingTo = null
  return g
}

/** Scroll to the first element `selector` finds and flash it, waiting a moment for one drawn late (a form that loads). */
export function revealRow(selector: string, within: ParentNode = document) {
  let tries = 0
  const go = () => {
    const el = within.querySelector<HTMLElement>(selector)
    if (!el) { if (++tries < 20) setTimeout(go, 50); return }
    el.scrollIntoView({ block: "center", behavior: "smooth" })
    el.classList.remove("reveal-flash"); void el.offsetWidth; el.classList.add("reveal-flash")
  }
  requestAnimationFrame(go)
}

/** "Open <Name> settings" in the command palette, for each plugin that has some, while it's on. Verb first, like every
 *  command: a name starting with the plugin's (Claude Code settings) would beat its "Open …" for the same word. */
export const settingsCommands = (): Command[] =>
  PLUGINS.map((p) => ({
    id: `plugin-settings:${p.id}`, name: `Open ${settingsTitle(p.name)}`,
    when: () => isEnabled(p.id, getPrefs().disabled) && hasSettings(p),
    run: () => openPluginSettings(p.id),
    icon: p.icon,
  }))
