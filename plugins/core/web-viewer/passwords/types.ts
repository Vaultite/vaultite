export type Status = null | { file: string; locked: boolean; touchId: boolean; held?: boolean; error?: string }
export type Group = { id: string; name: string; parent: string | null; share: string | null; bin: boolean; expanded: boolean }
export type Row = {
  id: string; group: string; title: string; username: string; urls: string[]; tags: string[]
  free: boolean; shared: boolean; expired: boolean; otp: boolean; modified: number; expires: number | null; from: string | null
}
export type Past = { at: number; until: number; changed: string[] }
export type Full = Row & { password: boolean; notes: string; history: Past[] }
export type Version = { at: number; title: string; username: string; password: boolean; urls: string[]; notes: string }
export type Health = { id: string; bits: number | null; same: string | null; since: number; excluded: boolean }
export type Change = { id?: string; group?: string; title: string; username: string; password: string; urls: string[]; tags: string[]; notes: string; expires: number | null }
export type Use = { t: number; entry: { id?: string; title: string; username: string }; site: string; agent: string; task?: string; status: string; approved?: string; machine?: string }
