// Markdown drawn read-only outside the editor (a book's notes, a timeline entry, an embed), looking like a read note.
// One-line previews use `snippet` instead.
import { useEffect, useMemo, useRef, type MouseEvent } from "react"
import { createRoot } from "react-dom/client"
import { getStore, type Store } from "@/core/data"
import { followLink, resolver } from "@/core/links"
import { type MarkdownOpts, renderInline, renderMarkdown } from "@/core/markdown"
import { hydrate, markdownDrawn, richClick } from "@/core/richmd"
import { assetPath } from "@/components/EmbedMenu"
import { rawUrl } from "@/components/FileViewers"
import { EmbedView } from "@/components/NoteEmbed"
import { cn } from "@/lib/utils"

/** What Markdown from `from` needs of the vault: its links resolved as written there, its images' addresses. */
export function vaultOpts(s: Store | null, from?: string): MarkdownOpts {
  if (!s) return {}
  const resolve = resolver(s)
  return {
    resolves: (t) => resolve(t, from),
    asset: (name) => { const p = assetPath(s, name, from); return p ? new URL(rawUrl(p), document.baseURI).href : null },
  }
}

/** `inline`: one line in running text; else a document in a sheet's sizes unless `full`. `from`: the file it's from
 *  (for `[[#Heading]]` and the closest file of a name). `plain`: without a note's look (`className` gives its own).
 *  `seen`: the notes embedding this text, so an embed in it never shows one of them again. */
export function Markdown({ text, store, inline, full, className, from, plain, seen }: { text: string; store?: Store; inline?: boolean; full?: boolean; className?: string; from?: string; plain?: boolean; seen?: string[] }) {
  const s = store ?? getStore()
  const html = useMemo(() => {
    const opts = vaultOpts(s, from)
    return inline ? renderInline(text, opts) : renderMarkdown(text, opts)
  }, [text, s, inline, from])
  const ref = useRef<HTMLElement>(null)
  const seenKey = (seen ?? (from ? [from] : [])).join("\n")
  useEffect(() => {
    if (!ref.current) return
    hydrate(ref.current); markdownDrawn(ref.current)
    // Its links have no address (a click follows them): Tab reaches them, and Enter presses them (core/keylist.ts).
    for (const a of ref.current.querySelectorAll<HTMLElement>("a[data-wiki], a[data-tag], a[data-url]")) { a.tabIndex = 0; a.setAttribute("role", "link") }
    // `![[x]]` anywhere in the text: what it names, drawn in its place as on a line of its own (its own root).
    if (!s) return
    const roots = [...ref.current.querySelectorAll<HTMLElement>("[data-md-embed]")].map((el) => {
      const root = createRoot(el)
      root.render(<EmbedView store={s} target={el.dataset.mdEmbed!} from={from ?? ""} seen={seenKey ? seenKey.split("\n") : []} />)
      return root
    })
    return () => { if (roots.length) setTimeout(() => { for (const r of roots) r.unmount() }, 0) }
  }, [html, s, from, seenKey])
  const follow = (e: MouseEvent) => {
    if (e.button === 0 && ref.current && richClick(e, ref.current)) return
    const a = (e.target as Element).closest<HTMLElement>("[data-wiki], [data-tag], [data-url]")
    if (!a || !s) return
    e.preventDefault()
    e.stopPropagation()
    // ⌘-click or a middle-click: a new tab, as in the editor.
    followLink(s, a.dataset.tag ? { tag: a.dataset.tag } : a.dataset.url ? { url: a.dataset.url } : { wiki: a.dataset.wiki }, e.metaKey || e.ctrlKey || e.button === 1, from)
  }
  const Tag = inline ? "span" : "div"
  return (
    <Tag ref={ref as never} className={cn(!plain && "note-prose", !plain && (inline ? "inline" : !full && "compact"), className)} onClick={follow} onAuxClick={(e) => { if (e.button === 1) follow(e) }} data-markdown-from={from} dangerouslySetInnerHTML={{ __html: html }} />
  )
}

/** Markdown as the app draws it, as HTML, for a plugin drawing its own elements: wikilinks resolved against the vault
 *  (`data-wiki`, `missing`), images, tags, callouts, math and mermaid waiting for `hydrateMarkdown`. */
export function markdownHtml(text: string, { inline, from }: { inline?: boolean; from?: string } = {}) {
  const opts = vaultOpts(getStore(), from)
  return inline ? renderInline(text, opts) : renderMarkdown(text, opts)
}
