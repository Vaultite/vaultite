// Provenance's part of the store (plugin.ts: `provenance` in /api/state): its values, as its settings have them (else
// the defaults), the defaults, and whether the user's own notes are labelled (label_user).
declare module "@vaultite" {
  interface PluginState { provenance?: { values: unknown[]; defaults: unknown[]; labelUser?: boolean } }
}
export {}
