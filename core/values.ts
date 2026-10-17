// Values read from JSON or YAML someone wrote (settings, manifests, bodies): shape checks that trust nothing. No Node:
// the app imports it too.

/** A plain object: not null, not an array. */
export const isObj = <T = Record<string, unknown>>(v: unknown): v is T => !!v && typeof v === "object" && !Array.isArray(v)

/** A list's text items (anything else left out, never the whole list refused). */
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
