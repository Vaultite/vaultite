import { BookOpen, Copy, ExternalLink, NotebookPen, Quote } from "lucide-react"
import { copyText, notify, type MenuItem } from "@vaultite"
import { insertCitation, openLiterature } from "./client.ts"
import { plainOf } from "./safe.ts"
import type { Links } from "./wire.ts"

export function follow(href: string) {
  const a = document.createElement("a")
  a.href = href
  a.rel = "noopener noreferrer"
  a.target = "_blank"
  document.body.append(a)
  a.click()
  a.remove()
}

export function entryMenu(e: { key: string; note: string | null; links: Links; html?: string }): MenuItem[] {
  const out: MenuItem[] = [
    { label: e.note ? "Open literature note" : "New literature note", icon: NotebookPen, run: () => void openLiterature(e.key) },
    { label: "Cite in note", icon: Quote, run: () => { if (!insertCitation([e.key])) notify("Open a note to cite in it") } },
    { label: "Copy citation", icon: Copy, run: () => void copyText(`[@${e.key}]`), sep: true },
  ]
  if (e.html) out.push({ label: "Copy reference", icon: Copy, run: () => void copyText(plainOf(e.html ?? "")) })
  if (e.links.doi || e.links.url) out.push({ label: e.links.doi ? "Open DOI" : "Open web page", icon: ExternalLink, sep: true, run: () => follow(e.links.doi || e.links.url) })
  if (e.links.zotero) out.push({ label: "Show in Zotero", icon: BookOpen, run: () => follow(e.links.zotero) })
  return out
}

