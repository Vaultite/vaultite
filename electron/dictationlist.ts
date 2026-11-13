import { app } from "electron"
import path from "node:path"
import type { DictationSink } from "./dictation.ts"
import { dictationKeep, type Keeping, type Where } from "./dictationkeep.ts"
import { objectOr, opt } from "./ipcwire.ts"
import { z } from "zod"

const kept = dictationKeep(() => path.join(app.getPath("userData"), "dictations"))
const keptOf = new WeakMap<DictationSink, Keeping>()
const CLIP = opt(z.string()).transform((v) => v?.trim().slice(0, 200) || undefined)
const WHERE = z.object({ kind: z.enum(["note", "terminal", "field", "app"]), path: CLIP, name: CLIP, bundle: CLIP })
  .transform(({ kind, path, name, bundle }): Where => ({ kind, ...(path ? { path } : {}), ...(name ? { name } : {}), ...(bundle ? { bundle } : {}) }))
const CALL = objectOr(z.object({ q: z.string().catch("").transform((q) => q.slice(0, 200)), limit: opt(z.number()), id: opt(z.string()) }))
export function keepFor(sink: DictationSink, where: unknown) {
  const w = WHERE.safeParse(where).data
  if (!w) return null
  const k = kept.start(w)
  keptOf.set(sink, k)
  return k
}
export const keptLanded = (sink: DictationSink, o: { to: string; name?: string; text?: string; inbox?: boolean }) => keptOf.get(sink)?.landed(o)
export function dictationsCall(name: string, args: unknown[]) {
  const o = CALL.parse(args[0])
  if (name === "dictations:list") return { ...kept.list({ q: o.q, limit: o.limit }), here: true }
  if (name === "dictations:forget") { if (o.id !== undefined) kept.forget(o.id); return { ok: true } }
  if (name === "dictations:clear") { kept.clear(); return { ok: true } }
  throw new Error(`no dictations call ${name}`)
}
