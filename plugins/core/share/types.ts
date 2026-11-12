// What Sharing keeps in the store (/api/state's `sharedFolders`: this machine's shares, by folder; the tree marks them).
export type SharedFolders = Record<string, { guest: string; role: "read" | "comment" | "edit"; expires: string }[]>

declare module "@vaultite" {
  interface PluginState {
    sharedFolders?: SharedFolders
    /** The guests' address links are made at (this machine's, or another of the user's): "" when there's none. */
    shareLinks?: string
  }
}
