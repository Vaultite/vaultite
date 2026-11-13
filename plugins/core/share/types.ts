export type SharedFolders = Record<string, { guest: string; role: "read" | "comment" | "edit"; expires: string }[]>

declare module "@vaultite" {
  interface PluginState {
    sharedFolders?: SharedFolders
    shareLinks?: string
  }
}
