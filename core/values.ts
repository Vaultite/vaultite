export const isObj = <T = Record<string, unknown>>(v: unknown): v is T => !!v && typeof v === "object" && !Array.isArray(v)

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
