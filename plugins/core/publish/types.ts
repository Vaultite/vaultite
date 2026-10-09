// Publish's part of the store (plugin.ts state): the notes and folders chosen, and the notes they stand for.

export type PublishState = { items: string[]; notes: string[] }

declare module "@vaultite" {
  interface PluginState {
    publish: PublishState
  }
}
