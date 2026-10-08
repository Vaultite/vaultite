// All properties' part of the store (plugin.ts: `properties` in /api/state): every frontmatter key in the vault.
export type PropType = "text" | "number" | "checkbox" | "date" | "datetime" | "list" | "object" | "empty"
export type PropSummary = { key: string; count: number; type: PropType; types: Partial<Record<PropType, number>> }

/** A property pinned to files' headers as a chip, as its settings keep it (read leniently: chipsOf in Chips.tsx). */
export type PropChip = { key: string; values?: unknown[]; types?: string[]; status_bar?: boolean; show_unset?: boolean }

declare module "@vaultite" {
  interface PluginState { properties?: PropSummary[]; propertyChips?: PropChip[] }
}
