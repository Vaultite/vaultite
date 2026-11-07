// What the companion saves into the vault (captures, QA walks, tours, lessons): a free name, the files beside a note,
// and a vault path as a worker on another machine reads it. Their names: names.ts.
import fs from "node:fs"
import path from "node:path"
import type { OpCtx, Plugin } from "../../../core/plugins.ts"

/** One of the helper's own capture files (a clip, its frames, a still) and there: the only files of this Mac that a
 *  capture or a QA walk copies into the vault. */
export const ownCapture = (f: unknown): f is string => typeof f === "string" && /[/\\]captures[/\\][\w-]+[/\\](clip\.mp4|frame\.png|frames[/\\]\d+\.\ds\.png)$/.test(f) && fs.existsSync(f)

/** `base`, else `base 2`, `base 3`...: the first whose note (`.md`) and folder are both free in the vault. */
export function freeBase(plugin: Plugin, base: string) {
  const taken = (b: string) => fs.existsSync(plugin.vault.abs(`${b}.md`)) || fs.existsSync(plugin.vault.abs(b))
  for (let n = 2, b = base; ; b = `${base} ${n++}`) if (!taken(b)) return b
}

/** Files of this machine copied into vault folder `base` by name: their vault paths, in order. */
export async function saveFiles(ctx: OpCtx, base: string, files: { from: string; name: string }[]) {
  if (files.length) await ctx.api("POST", "folder", { path: base }).catch(() => {})
  const out: string[] = []
  for (const f of files) {
    const rel = `${base}/${f.name}`, bytes = fs.createReadStream(f.from)
    // (refused, it's never read: closed all the same)
    try { await ctx.api("POST", "upload", { path: rel, bytes }) } finally { bytes.destroy() }
    out.push(rel)
  }
  return out
}

/** How a worker on `machine` ("" this one) names a vault path: its vault's own path there (iCloud brings the files). */
export async function vaultFileOn(plugin: Plugin, machine: string) {
  const m = machine ? await plugin.ask<{ vault?: string } | null>("machines:machine", null, machine) : null
  const root = machine ? m?.vault : plugin.vault.path
  return (rel: string) => (root ? path.join(root, rel) : `${rel} (in their vault)`)
}
