export type Me = { id: string; location: string; lat: number | null; lon: number | null; body: string }

declare module "@vaultite" {
  interface PluginState { me: Me | null }
}
