// Me's part of the store (/api/state's `me`, from its plugin.ts): the user's file read, or null when there's none.
export type Me = { id: string; location: string; lat: number | null; lon: number | null; body: string }

declare module "@vaultite" {
  interface PluginState { me: Me | null }
}
