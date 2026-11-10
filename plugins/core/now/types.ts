// Now's part of the store (/api/state's `now`, from its plugin.ts): the Now note read, or null when there's none.
export type Now = { id: string; body: string }

declare module "@vaultite" {
  interface PluginState { now: Now | null }
}
