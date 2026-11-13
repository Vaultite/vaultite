
export type Source = "app" | "server"

export type ErrorEvent = {
  id: string
  t: number
  source: Source
  kind: string
  message: string
  stack?: string
  component?: string
  fatal?: boolean
  where?: string
  url?: string
  build?: string
  device?: string
  trail?: string[]
  n?: number
}

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
