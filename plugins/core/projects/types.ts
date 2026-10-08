// What Projects keeps in the store (/api/state's `projects`: the vault's Projects folder).
export type Project = {
  id: string; name: string; slug: string; status: string; tagline: string; repo: string | null; path: string | null
  links: { label: string; url: string }[]; sort: number | null; notes: string
  /** Its file has `archived: true` (the core's, on every item: isArchived from "@vaultite"). */
  archived?: boolean
}

declare module "@vaultite" {
  interface PluginState {
    projects: Project[]
  }
}
