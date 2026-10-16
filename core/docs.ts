// The docs for AIs, topics read on demand (`vau docs <topic>`: core/docs/, or a plugin's AGENTS.md with its manifest's
// settings and blocks). The vault's short rules (core/AGENTS.md) are written by the Agent files plugin.
import fs from "node:fs"
import path from "node:path"
import { closest } from "./blocks.ts"
import { HTTPError, type Plugin, ROOT } from "./plugins.ts"
import { readText } from "./vault.ts"

export type Topic = { id: string; title: string; plugin: string | null; text: string }

/** A doc's title: its first `## ` heading, else the fallback. */
const titleOf = (text: string, fallback: string) => /^##\s+(.+)$/m.exec(text)?.[1].trim() ?? fallback

/** The design system (core/pages/Design.md): every block and piece of Markdown, as a dashboard to copy from. */
const DESIGN = path.join(ROOT, "core", "pages", "Design.md")

/** Every topic: the core's (core/docs/*.md, and the design system), then each plugin's that has docs, an AGENTS.md or
 *  blocks or settings. */
export function topics(plugins: Plugin[]): Topic[] {
  const dir = path.join(ROOT, "core", "docs")
  const core = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f): Topic => {
    const text = readText(path.join(dir, f)).trim()
    return { id: f.slice(0, -3), title: titleOf(text, f.slice(0, -3)), plugin: null, text }
  })
  core.push({ id: "design", title: "Design: every block and piece of Markdown, as a dashboard", plugin: null, text: readText(DESIGN).trim() })
  core.sort((a, b) => a.id.localeCompare(b.id))
  return [...core, ...plugins.flatMap((p) => {
    const d = p.docs()
    return d ? [{ id: p.id, title: titleOf(d.text, String(p.manifest.name ?? p.id)), plugin: p.id, ...d }] : []
  })]
}

/** One topic, by id or by its title's words ("database views"), or a 404 naming the nearest. */
export function topic(plugins: Plugin[], name: string): Topic {
  const all = topics(plugins), q = name.trim().toLowerCase()
  const hit = all.find((t) => t.id === q) ?? all.find((t) => t.title.toLowerCase().startsWith(q))
    ?? all.find((t) => t.title.toLowerCase().includes(q))
  if (hit) return hit
  const near = closest(q, all.map((t) => t.id))
  throw new HTTPError(404, `no docs '${name}'${near ? `: did you mean ${near}?` : ""} (vau docs lists them)`)
}
