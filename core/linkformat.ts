import { relativePath } from "./links.ts"
import type { Item } from "./vault.ts"

export type LinkFormat = "shortest" | "relative" | "absolute"
export const LINK_FORMATS: LinkFormat[] = ["shortest", "relative", "absolute"]
export type LinkStyle = { format: LinkFormat; wikilinks: boolean }
export const LINK_STYLE: LinkStyle = { format: "shortest", wikilinks: true }

export function linkStyleOf(files: Item): LinkStyle {
  const format = LINK_FORMATS.find((f) => f === files.linkFormat) ?? LINK_STYLE.format
  return { format, wikilinks: files.wikilinks !== false }
}

export type NewLink = { path: string; anchor?: string; text?: string; embed?: boolean }

const isMd = (p: string) => /\.md$/i.test(p)
const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "")
const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")))
const href = (p: string) => p.replace(/%/g, "%25").replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")

export function shortestName(path: string, finds: (name: string) => boolean, last = nameOf(path)): string {
  const parts = path.split("/")
  for (let i = parts.length - 1; i >= 0; i--) {
    const c = [...parts.slice(i, -1), last].join("/")
    if (finds(c)) return c
  }
  return [...parts.slice(0, -1), last].join("/")
}

function pathOf(to: NewLink, from: string, format: LinkFormat): string | null {
  if (to.anchor && to.path === from) return ""
  if (format === "absolute") return to.path
  return format === "relative" ? relativePath(dirOf(from), to.path) : null
}

function wikiLink(to: NewLink, name: string) {
  const anchor = to.anchor ? `#${to.anchor}` : "", t = to.text
  const text = t && t !== name && t !== `${name}${anchor}` ? `|${t.replace(/[[\]|]/g, " ")}` : ""
  return `${to.embed ? "!" : ""}[[${name}${anchor}${text}]]`
}

function markdownLink(to: NewLink, file: string, own: boolean) {
  const shown = own ? to.anchor!.replace(/^\^/, "") : nameOf(to.path)
  const text = to.text ?? (to.embed ? "" : shown)
  return `${to.embed ? "!" : ""}[${text.replace(/[[\]]/g, "")}](${href(file)}${to.anchor ? `#${href(to.anchor)}` : ""})`
}

export function formatLink(to: NewLink, from: string, style: LinkStyle, shortest: (path: string) => string): string {
  const path = pathOf(to, from, style.format)
  if (style.wikilinks) return wikiLink(to, path === null ? shortest(to.path) : path.replace(/\.md$/i, ""))
  return markdownLink(to, path ?? `${shortest(to.path)}${isMd(to.path) ? ".md" : ""}`, path === "")
}
