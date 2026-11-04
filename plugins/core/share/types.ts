// What Sharing keeps in the store (/api/state's `sharedFolders`: this machine's shares, by folder; the tree marks them).
export type SharedFolders = Record<string, { guest: string; role: "read" | "comment" | "edit"; expires: string }[]>

declare module "@vaultite" {
  interface PluginState {
    sharedFolders?: SharedFolders
    shareLinks?: boolean
  }
}
