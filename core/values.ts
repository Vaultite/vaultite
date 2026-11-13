export const isObj = <T = Record<string, unknown>>(v: unknown): v is T => !!v && typeof v === "object" && !Array.isArray(v)

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

export const isText = (v: unknown): v is string => typeof v === "string"
export const isNumber = (v: unknown): v is number => typeof v === "number"

/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters -- a thrown value is unknown: these read it */
export const messageOf = (e: unknown): string => (isObj(e) && typeof e.message === "string" ? e.message : String(e))
export const codeOf = (e: unknown): string | undefined => (isObj(e) && typeof e.code === "string" ? e.code : undefined)
export const errnoOf = (e: unknown): number | undefined => (isObj(e) && typeof e.errno === "number" ? e.errno : undefined)
/* oxlint-enable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters -- only the three above */
