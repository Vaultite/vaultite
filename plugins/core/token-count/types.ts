import type { Limits, Sized } from "./limits"

export type TokenCountState = { limits: Limits; files: Sized[] }

declare module "@vaultite" {
  interface PluginState { tokenCount?: TokenCountState }
}
