// Token count's part of the store (plugin.ts: `tokenCount` in /api/state): the limits in effect, and the files near or
// over theirs and every load chain (Sized), biggest first.
import type { Limits, Sized } from "./limits"

export type TokenCountState = { limits: Limits; files: Sized[] }

declare module "@vaultite" {
  interface PluginState { tokenCount?: TokenCountState }
}
