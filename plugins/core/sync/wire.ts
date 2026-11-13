import { z } from "zod"
import type { Entry, SyncNode, Vector } from "../../../core/plugins.ts"

const ConflictFields = z.looseObject({ id: z.string(), kind: z.enum(["text", "json", "binary", "deleted", "name"]), base: z.string().nullable(), other: z.string().nullable(),
  device: z.string(), at: z.number() })
const VersionFields = z.looseObject({ id: z.string(), file: z.string(), path: z.string(), blob: z.string().nullable(), size: z.number(), parents: z.array(z.string()),
  clock: z.number(), device: z.string(), at: z.number(), conflict: ConflictFields.optional(), settles: z.array(z.string()).optional() })
const VersionAsSent = z.custom<SyncNode>((v) => VersionFields.safeParse(v).success)
const EntrySchema = z.object({ device: z.string(), seq: z.number().int().min(1), node: VersionAsSent })

export const Entries = z.array(z.unknown()).catch([]).transform((xs): Entry[] => xs.flatMap((x) => { const e = EntrySchema.safeParse(x); return e.success ? [e.data] : [] }))
const VectorSchema: z.ZodType<Vector> = z.record(z.string(), z.number())
const Blobs = z.record(z.string(), z.string()).optional().catch(undefined)

export const ExchangeAsk = z.object({ set: z.unknown().optional(), device: z.unknown().optional(), protocol: z.unknown().optional(), vector: VectorSchema.catch({}),
  entries: Entries, blobs: Blobs }).catch({ vector: {}, entries: [] })
export const ExchangeAnswer = z.object({ vector: VectorSchema.optional().catch(undefined), entries: Entries, blobs: Blobs, more: z.boolean().optional().catch(undefined),
  error: z.string().optional().catch(undefined) }).catch({ entries: [] })
export const BlobsAsk = z.object({ set: z.unknown().optional(), hashes: z.array(z.unknown()).catch([]) }).catch({ hashes: [] })

const Copied = z.object({ hash: z.string(), node: z.string(), size: z.number(), mtime: z.number() })
export const SavedExtra = z.object({ mailbox: z.object({ read: z.record(z.string(), z.number()).optional(), written: z.number().optional() }).optional().catch(undefined),
  mirror: z.array(z.tuple([z.string(), Copied])).optional().catch(undefined) }).catch({})

export const CompareRun = z.object({ at: z.number(), same: z.number(), differ: z.array(z.string()), missing: z.array(z.string()), extra: z.array(z.string()),
  keptMore: z.array(z.string()), lostLines: z.array(z.object({ path: z.string(), lines: z.array(z.string()) })) })
export type Compare = z.infer<typeof CompareRun>

const KeepRuleSeen = z.looseObject({ path: z.string().optional() })
export const DeviceSettings = z.record(z.string(), z.looseObject({ keep: z.array(KeepRuleSeen).optional().catch(undefined) }).catch({})).catch({})
