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

export function categoryOf(category: unknown): { id: string; label: string } {
  return CATEGORIES.find((c) => c.id === category) ?? OTHER
}

export const GROUPS = [
  { id: "coding-agents", label: "Coding agents" },
] as const

export const groupOf = (group: unknown) => GROUPS.find((g) => g.id === group) ?? null

export const SWITCH_SECTIONS = ["editor"] as const
