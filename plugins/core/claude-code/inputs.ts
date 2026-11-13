export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
export const str = (v: unknown) => (typeof v === "string" ? v : "")
export const rec = (v: unknown) => (isRecord(v) ? v : {})
export const recs = (v: unknown) => (Array.isArray(v) ? v.map(rec) : [])
