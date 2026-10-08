// What Note kinds keeps in the store (/api/state's `notes`: the vault's Notes folder).
/** kind: idea | note; status (ideas): seed | exploring | parked | done. Times are UTC
 *  ("YYYY-MM-DD HH:MM:SS"). */
export type Note = {
  id: string; title: string; body: string; tags: string; kind: string; status: string | null
  /** A journal entry: tagged `journal` (frontmatter or inline). */
  journal: boolean
  source: string | null; ext_id: string | null; created_at: string; updated_at: string; aliases: string[]
  /** Its file has `archived: true` (the core's, on every item: isArchived from "@vaultite"). */
  archived?: boolean
}

declare module "@vaultite" {
  interface PluginState {
    notes: Note[]
  }
}
