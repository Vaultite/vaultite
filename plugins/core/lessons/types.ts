// What Lessons keeps in the store (/api/state's `lessons` and `decks`: the vault's lesson and cards files).
import type { Reviews } from "./schedule.ts"

export type Lesson = {
  id: string; title: string; step: number; steps: number; source: string | null; created: string | null; notes: string
  archived?: boolean
}
export type Deck = { id: string; title: string; cards: number; source: string | null; created: string | null; notes: string; archived?: boolean }
/** GET /api/lessons/state: what the user remembers of each card, and the settings that schedule them. */
export type State = { reviews: Reviews; retention: number; newPerDay: number }

declare module "@vaultite" {
  interface PluginState {
    lessons: Lesson[]
    decks: Deck[]
  }
}
