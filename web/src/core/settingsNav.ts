// Which Settings section is shown (kept while the app runs, so Settings reopens where it was), and a way to open one from
// elsewhere (Bundles, from its command) without loading the Settings page's code.
import { cell } from "@/core/signal"
import { go } from "@/core/workspace"

export const settingsSection = cell("general")

/** Settings, at `section` (desktop: the page beside its menu). */
export function openSettings(section: string) {
  settingsSection.set(section)
  go("settings")
}
