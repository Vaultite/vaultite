import type { z } from "zod"
import type { ErrorRow } from "./rows.ts"

export type ErrorEvent = z.infer<typeof ErrorRow>
export type Source = ErrorEvent["source"]

export type ErrorGroup = {
  id: string
  source: Source
  kind: string
  message: string
  first: number
  last: number
  count: number
  fatal: number
  devices: string[]
  latest: ErrorEvent
}

export type ErrorList = { groups: ErrorGroup[]; total: number; events: number; since: number | null }
export type ErrorDetail = { group: ErrorGroup; events: ErrorEvent[] }
