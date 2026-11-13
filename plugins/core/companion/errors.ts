export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
export const statusOf = (e: unknown) => (e instanceof Error && "status" in e && typeof e.status === "number" ? e.status : undefined)
export const codeOf = (e: unknown) => (e instanceof Error && "code" in e && typeof e.code === "string" ? e.code : undefined)
