export type Note = {
  id: string; title: string; body: string; tags: string; kind: string; status: string | null
  journal: boolean
  source: string | null; ext_id: string | null; created_at: string; updated_at: string; aliases: string[]
  archived?: boolean
}

declare module "@vaultite" {
  interface PluginState {
    notes: Note[]
  }
}
