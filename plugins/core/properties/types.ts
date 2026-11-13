export type PropType = "text" | "number" | "checkbox" | "date" | "datetime" | "list" | "object" | "empty"
export type PropSummary = { key: string; count: number; type: PropType; types: Partial<Record<PropType, number>> }

export type PropChip = { key: string; values?: unknown[]; types?: string[]; status_bar?: boolean; show_unset?: boolean }

declare module "@vaultite" {
  interface PluginState { properties?: PropSummary[]; propertyChips?: PropChip[] }
}
