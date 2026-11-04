// Plugin categories (a manifest's `category`) in the order the Plugins page lists them, for server and app. A plugin
// with none or an unknown one is "Other", listed last.
export const CATEGORIES = [
  { id: "navigation", label: "Navigation" },
  { id: "writing", label: "Writing" },
  { id: "life", label: "Life" },
  { id: "health", label: "Health and fitness" },
  { id: "ai-apps", label: "AI apps" },
  { id: "agents", label: "AI tools" },
  { id: "developer", label: "Developer" },
  { id: "formats", label: "Formats" },
  { id: "system", label: "System" },
] as const

export const OTHER = { id: "other", label: "Other" } as const

/** A manifest's category as one of the list, or Other. */
export function categoryOf(category: unknown): { id: string; label: string } {
  return CATEGORIES.find((c) => c.id === category) ?? OTHER
}

/** Plugin groups (a manifest's `group`): the Plugins page lists each as one row saying which of them are on, and opens
 *  a sheet with each one's own switch. */
export const GROUPS = [
  { id: "coding-agents", label: "Coding agents" },
] as const

export const groupOf = (group: unknown) => GROUPS.find((g) => g.id === group) ?? null

/** The Settings sections a plugin's switch can be in instead of the Plugins page (a manifest's `switchIn`). */
export const SWITCH_SECTIONS = ["editor"] as const
