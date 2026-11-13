import path from "node:path"
import { z } from "zod"
import { listOf, readJson, recordOf } from "../core/jsonfile.ts"

const PAST = z.object({ profile: z.string(), index: z.number(), entries: z.array(z.object({ url: z.string(), title: z.string(), pageState: z.string().optional() })), at: z.number() })
export type Past = z.infer<typeof PAST>
export const pastsFrom = (text: string) => new Map(Object.entries(recordOf(PAST).parse(JSON.parse(text))))

/** A tab's picture (`<tab>.jpg`): the page it shows, in which logins, its size in the window's CSS px. */
const FRAME = z.object({ url: z.string(), profile: z.string(), width: z.number(), height: z.number(), at: z.number() })
export type Frame = z.infer<typeof FRAME>
export const framesFrom = (text: string) => new Map(Object.entries(recordOf(FRAME).parse(JSON.parse(text))))

const POPUP_KEPT = z.object({ bare: z.boolean().optional(), onTop: z.boolean().optional() })
export type PopupKept = z.infer<typeof POPUP_KEPT>
export const popupsFrom = (text: string) => recordOf(POPUP_KEPT).parse(JSON.parse(text))

const PLAYER_PLACE = z.object({ x: z.number(), y: z.number(), width: z.number().min(160), height: z.number().min(90) })
export const playerPlaceFrom = (text: string) => PLAYER_PLACE.safeParse(JSON.parse(text)).data ?? null

const DOWNLOAD = z.object({
  id: z.number(), name: z.string(), path: z.string(), url: z.string(), profile: z.string(),
  state: z.enum(["progressing", "paused", "completed", "cancelled", "interrupted"]), received: z.number(), total: z.number(), at: z.number(), done: z.number().optional(),
  /** It may go on where it stopped (interrupted, Chromium kept its part). */
  resumable: z.boolean().optional(),
  /** Started by an agent's page: listed, never toasted. */
  agent: z.boolean().optional(),
  /** Finished, and its file is gone since (moved, deleted). */
  gone: z.boolean().optional(),
})
export type Download = z.infer<typeof DOWNLOAD>
export const downloadsFrom = (text: string) => listOf(DOWNLOAD).parse(JSON.parse(text))

const jsonAt = <T extends z.ZodType>(file: string, schema: T) => { const r = readJson(file, schema); return r.ok ? r.value : null }
export const storeCurrent = (dir: string) => jsonAt(path.join(dir, "current.json"), z.object({ commit: z.string().optional() }))?.commit
export const storeFingerprint = (dir: string, sha: string) => jsonAt(path.join(dir, "meta", `${sha}.json`), z.object({ fingerprint: z.string().optional() }))?.fingerprint
export const shellBad = (userData: string) => jsonAt(path.join(userData, "shell", "bad.json"), recordOf(z.object({ why: z.string() }))) ?? {}
export const shellBuiltAt = (file: string) => jsonAt(file, z.number()) ?? 0
