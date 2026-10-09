// What People keeps in the store (/api/state's `people` and `interactions`, from its plugin.ts).
export type Person = {
  id: string; name: string; relation: string; every_days: number | null; usual: string; notes: string
  /** Optional order (lower first); people without one come after, by name. */
  sort: number | null
  /** Its file has `archived: true` (the core's, on every item: isArchived from "@vaultite"). */
  archived?: boolean
  location: string; context: string; tags: string; want_to: string; contact: string; aliases: string[]
  /** Map position: the file's `coordinates`, else the cached lookup of `location` (never written to the file). */
  lat: number | null; lon: number | null
  /** An upcoming move ("Baltimore, MD"); cleared once `location` is updated. */
  moving_to: string
  /** Sections of their file after the timeline (## Gift ideas...), as Markdown. */
  after?: string
}
/** A line in a person's timeline. kind: call | hang out | meet | study | text | message | email | note (a fact). */
export type Interaction = {
  id: string; person_id: string; date: string; kind: string; duration_min: number | null; notes: string; source: string
  subject: string; url: string
}

declare module "@vaultite" {
  interface PluginState {
    people: Person[]
    interactions: Interaction[]
  }
}
