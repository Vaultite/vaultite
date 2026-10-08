// What Obsidian keeps in the store (/api/state's `obsidian`: plugin.ts): the settings of the vault's .obsidian/app.json
// that apply here, only the keys the file sets; null when the vault has no .obsidian folder.
export type ObsidianSettings = {
  newFileLocation?: "root" | "current" | "folder"
  newFileFolderPath?: string
  attachmentFolderPath?: string
  useMarkdownLinks?: boolean
}

declare module "@vaultite" {
  interface PluginState {
    obsidian?: ObsidianSettings | null
    /** The vault's Obsidian plugins to offer to run here (how many), until that's taken or dismissed. */
    obsidianOffer?: number | null
    /** A plugin that runs Obsidian's plugins is on (the offer is moot). */
    obsidianRunning?: boolean
  }
}
