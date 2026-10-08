// Plugin categories (a manifest's `category`) in the order the Plugins page lists them, for server and app. A plugin
// with none or an unknown one is "Other", listed last.
export const CATEGORIES = [
  { id: "navigation", label: "Navigation" },
  { id: "writing", label: "Writing" },
  { id: "life", label: "Life" },
  { id: "health", label: "Health and fitness" },
  { id: "agents", label: "AI agents" },
  { id: "developer", label: "Developer" },
  { id: "formats", label: "Formats" },
  { id: "system", label: "System" },
] as const

export const OTHER = { id: "other", label: "Other" } as const

/** A manifest's category as one of the list, or Other. */
export function categoryOf(category: unknown): { id: string; label: string } {
  return CATEGORIES.find((c) => c.id === category) ?? OTHER
}
