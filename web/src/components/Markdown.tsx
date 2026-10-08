// Markdown drawn read-only outside the editor (a book's notes, a timeline entry), looking like a read note. One-line
// previews use `snippet` instead.
import { useEffect, useMemo, useRef, type MouseEvent } from "react"
import { getStore, type Store } from "@/core/data"
import { followLink, resolver } from "@/core/links"
import { renderInline, renderMarkdown } from "@/core/markdown"
import { hydrate, markdownDrawn, richClick } from "@/core/richmd"
import { cn } from "@/lib/utils"

/** `inline`: one line in running text; else a document in a sheet's sizes unless `full`. `from`: the file it's from
 *  (for `[[#Heading]]`). `plain`: without a note's look (`className` gives its own). */
export function Markdown({ text, store, inline, full, className, from, plain }: { text: string; store?: Store; inline?: boolean; full?: boolean; className?: string; from?: string; plain?: boolean }) {
  const s = store ?? getStore()
  const html = useMemo(() => {
    const resolve = s ? resolver(s) : null
    const resolves = resolve ? (t: string) => resolve(t) : undefined
    return inline ? renderInline(text, resolves) : renderMarkdown(text, resolves)
  }, [text, s, inline])
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!ref.current) return
    hydrate(ref.current); markdownDrawn(ref.current)
    // Its links have no address (a click follows them): Tab reaches them, and Enter presses them (core/keylist.ts).
    for (const a of ref.current.querySelectorAll<HTMLElement>("a[data-wiki], a[data-tag], a[data-url]")) { a.tabIndex = 0; a.setAttribute("role", "link") }
  }, [html])
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
 *  (`data-wiki`, `missing`), tags, callouts, math and mermaid waiting for `hydrateMarkdown`. */
export function markdownHtml(text: string, { inline }: { inline?: boolean } = {}) {
  const s = getStore(), resolve = s ? resolver(s) : null
  const resolves = resolve ? (t: string) => resolve(t) : undefined
  return inline ? renderInline(text, resolves) : renderMarkdown(text, resolves)
}
