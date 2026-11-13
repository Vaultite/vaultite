import type { Options } from "docx-preview"

export const DRAWN = {
  inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, renderAltChunks: false, renderComments: false,
  renderChanges: false, experimental: true, className: "docx",
} satisfies Partial<Options>

export type Link = { to: "web" | "mail"; href: string } | { to: "place"; id: string }

export function linkOf(href: string): Link | null {
  if (/^https?:/i.test(href)) return { to: "web", href }
  if (/^mailto:/i.test(href)) return { to: "mail", href }
  if (href.startsWith("#")) return { to: "place", id: href.slice(1) }
  return null
}

export function disarmLinks(root: ParentNode) {
  for (const a of root.querySelectorAll("a[href]")) if (!linkOf(a.getAttribute("href") ?? "")) a.removeAttribute("href")
}
