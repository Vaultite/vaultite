// Dispatch's part of the store (plugin.ts: `dispatch` in /api/state): its actions, as its settings have them (else the
// default), and the default.
/** An action: an agent started with `prompt`, or a shell `command` typed into a new shell (`report`, `open`: plugin.ts). */
export type Action = { id: string; label: string; icon?: string; agent?: string; prompt?: string; command?: string; report?: boolean; open?: boolean }

declare module "@vaultite" {
  interface PluginState { dispatch?: { actions: Action[]; defaults: Action[] } }
}
