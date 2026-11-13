export type ObsidianSettings = {
  newFileLocation?: "root" | "current" | "folder"
  newFileFolderPath?: string
  attachmentFolderPath?: string
  useMarkdownLinks?: boolean
  spellcheck?: boolean
  useTab?: boolean
  tabSize?: number
  autoPairBrackets?: boolean
  autoPairMarkdown?: boolean
  readableLineLength?: boolean
  propertiesInDocument?: "visible" | "hidden" | "source"
  defaultView?: "editing" | "reading"
  editingMode?: "live" | "source"
}

declare module "@vaultite" {
  interface PluginState {
    obsidian?: ObsidianSettings | null
    obsidianOffer?: number | null
    obsidianRunning?: boolean
  }
}
