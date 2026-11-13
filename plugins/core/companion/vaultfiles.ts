import fs from "node:fs"
import path from "node:path"
import type { OpCtx, Plugin } from "../../../core/plugins.ts"

export const ownCapture = (f: unknown): f is string => typeof f === "string" && /[/\\]captures[/\\][\w-]+[/\\](clip\.mp4|frame\.png|frames[/\\]\d+\.\ds\.png)$/.test(f) && fs.existsSync(f)

export function freeBase(plugin: Plugin, base: string) {
  const taken = (b: string) => fs.existsSync(plugin.vault.abs(`${b}.md`)) || fs.existsSync(plugin.vault.abs(b))
  for (let n = 2, b = base; ; b = `${base} ${n++}`) if (!taken(b)) return b
}

export async function saveFiles(ctx: OpCtx, base: string, files: { from: string; name: string }[]) {
  if (files.length) await ctx.api("POST", "folder", { path: base }).catch(() => {})
  const out: string[] = []
  for (const f of files) {
    const rel = `${base}/${f.name}`
    if (out.includes(rel)) { out.push(rel); continue }
    const bytes = fs.createReadStream(f.from)
    try { await ctx.api("POST", "upload", { path: rel, bytes }) } finally { bytes.destroy() }
    out.push(rel)
  }
  return out
}

export async function vaultFileOn(plugin: Plugin, machine: string) {
  const m = machine ? await plugin.ask<{ vault?: string } | null>("machines:machine", null, machine) : null
  const root = machine ? m?.vault : plugin.vault.path
  return (rel: string) => (root ? path.join(root, rel) : `${rel} (in their vault)`)
}
