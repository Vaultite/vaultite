import fs from "node:fs"
import path from "node:path"
import { closest } from "./blocks.ts"
import { HTTPError, type Plugin, ROOT } from "./plugins.ts"
import { readText } from "./vault.ts"

export type Topic = { id: string; title: string; plugin: string | null; text: string }

const titleOf = (text: string, fallback: string) => /^##\s+(.+)$/m.exec(text)?.[1].trim() ?? fallback

const TITLES: Record<string, string> = { design: "Design: the primitives and Markdown pages are made of, as a dashboard" }

export function topics(plugins: Plugin[]): Topic[] {
  const dir = path.join(ROOT, "core", "docs")
  const core = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f): Topic => {
    const text = readText(path.join(dir, f)).trim()
    const id = f.slice(0, -3)
    return { id, title: TITLES[id] ?? titleOf(text, id), plugin: null, text }
  })
  core.sort((a, b) => a.id.localeCompare(b.id))
  return [...core, ...plugins.flatMap((p) => {
    const d = p.docs()
    const more = fs.existsSync(path.join(p.dir, "docs")) ? fs.readdirSync(path.join(p.dir, "docs")).filter((f) => f.endsWith(".md")).sort().map((f): Topic => {
      const text = readText(path.join(p.dir, "docs", f)).trim()
      return { id: f.slice(0, -3), title: titleOf(text, f.slice(0, -3)), plugin: p.id, text }
    }) : []
    return [...(d ? [{ id: p.id, title: titleOf(d.text, p.manifest.name ?? p.id), plugin: p.id, ...d }] : []), ...more]
  })]
}

export function topic(plugins: Plugin[], name: string): Topic {
  const all = topics(plugins), q = name.trim().toLowerCase()
  const hit = all.find((t) => t.id === q) ?? all.find((t) => t.title.toLowerCase().startsWith(q))
    ?? all.find((t) => t.title.toLowerCase().includes(q))
  if (hit) return hit
  const near = closest(q, all.map((t) => t.id))
  throw new HTTPError(404, `no docs '${name}'${near ? `: did you mean ${near}?` : ""} (vau docs lists them)`)
}
