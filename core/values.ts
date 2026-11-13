export const isObj = <T = Record<string, unknown>>(v: unknown): v is T => !!v && typeof v === "object" && !Array.isArray(v)

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

export const isText = (v: unknown): v is string => typeof v === "string"
export const isNumber = (v: unknown): v is number => typeof v === "number"
