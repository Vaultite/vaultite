// What Books keeps in the store (/api/state's `books`: the vault's Books folder).
export type Book = {
  id: string; title: string; author: string; status: "want" | "reading" | "done" | "dropped"
  total_pages: number | null; current_page: number | null; started: string | null; finished: string | null
  rating: number | null; notes: string; created: string | null
  /** Its file has `archived: true` (the core's, on every item: isArchived from "@vaultite"). */
  archived?: boolean
}

declare module "@vaultite" {
  interface PluginState {
    books: Book[]
  }
}
