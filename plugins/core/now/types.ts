export type Now = { id: string; body: string }

declare module "@vaultite" {
  interface PluginState { now: Now | null }
}
