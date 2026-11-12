// Companion: one always-on agent session that watches the user write and answers in the app (its cursor, bubbles,
// margin comments, suggestions, edits typed in). Comments and suggestions are kept in a sidecar per note; the rest is live.

// Its parts run in one order, the last imported here: each imports the part before it first (self.ts, settings.ts,
// state.ts ... people.ts), so its ops, hooks and services register in that order.
import "./people.ts"
export { plugin } from "./self.ts"
