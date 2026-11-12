import { app } from "electron"
import path from "node:path"
import type { DictationSink } from "./dictation.ts"
import { dictationKeep, type Keeping, type Where } from "./dictationkeep.ts"

const kept = dictationKeep(() => path.join(app.getPath("userData"), "dictations"))
const keptOf = new WeakMap<DictationSink, Keeping>()
const KINDS = new Set(["note", "terminal", "field", "app"])
const clip = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined)
function whereOf(w: unknown): Where | null {
  if (!w || typeof w !== "object") return null
  const o = w as Record<string, unknown>
  if (!KINDS.has(String(o.kind))) return null
  const path = clip(o.path), name = clip(o.name), bundle = clip(o.bundle)
  return { kind: o.kind as Where["kind"], ...(path ? { path } : {}), ...(name ? { name } : {}), ...(bundle ? { bundle } : {}) }
}
export function keepFor(sink: DictationSink, where: unknown) {
  const w = whereOf(where)
  if (!w) return null
  const k = kept.start(w)
  keptOf.set(sink, k)
  return k
}
export const keptLanded = (sink: DictationSink, o: { to: string; name?: string; text?: string; inbox?: boolean }) => keptOf.get(sink)?.landed(o)
export function dictationsCall(name: string, args: unknown[]) {
  const o = (args[0] && typeof args[0] === "object" ? args[0] : {}) as { q?: unknown; limit?: unknown; id?: unknown }
  if (name === "dictations:list") return { ...kept.list({ q: typeof o.q === "string" ? o.q.slice(0, 200) : "", limit: typeof o.limit === "number" ? o.limit : undefined }), here: true }
  if (name === "dictations:forget") { if (typeof o.id === "string") kept.forget(o.id); return { ok: true } }
  if (name === "dictations:clear") { kept.clear(); return { ok: true } }
  throw new Error(`no dictations call ${name}`)
}
