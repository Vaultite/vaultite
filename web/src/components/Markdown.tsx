// Markdown drawn read-only outside the editor (a book's notes, a timeline entry, an embed), looking like a read note.
// One-line previews use `snippet` instead.
import { useEffect, useMemo, useRef, type MouseEvent } from "react"
import { createRoot } from "react-dom/client"
import { getStore, type Store } from "@/core/data"
import { Copy } from "lucide-react"
import { keyHint } from "@/core/commands"
import { drawnLink, followLink, linkClick, resolver } from "@/core/links"
import { type MarkdownOpts, renderInline, renderMarkdown } from "@/core/markdown"
import { dropMermaid, hydrate, markdownDrawn, richClick, tickTask, wireTasks } from "@/core/richmd"
import { isReadOnly, readFile } from "@/core/files"
import { put } from "@/core/http"
import { notifyError } from "@/core/notify"
import { assetPath, openEmbedMenu } from "@/components/EmbedMenu"
import { rawUrl } from "@/components/FileViewers"
import { EmbedView } from "@/components/NoteEmbed"
import { openMenu, type MenuItem } from "@/components/ContextMenu"
import { copyText, grouped } from "@/components/FileActions"
import { linkItems } from "@/components/LinkMenu"
import { cn } from "@/lib/utils"

/** What Markdown from `from` needs of the vault: its links resolved as written there, its images' addresses. */
function vaultOpts(s: Store | null, from?: string): MarkdownOpts {
  if (!s) return {}
  const resolve = resolver(s)
  return {
    resolves: (t) => resolve(t, from),
    asset: (name) => { const p = assetPath(s, name, from); return p ? new URL(rawUrl(p), document.baseURI).href : null },
  }
}

/** Ticks the nth task of `text`, a part of the file `path` as written there (read again: it may have changed since). */
async function tickIn(path: string, text: string, nth: number, on: boolean) {
  try {
    const f = await readFile(path)
    const at = f.text.indexOf(text)
    const next = at < 0 ? null : tickTask(text, nth, on)
    if (next === null) throw new Error("it changed since it was drawn")
    await put("file", { path, text: f.text.slice(0, at) + next + f.text.slice(at + text.length), base: f.text })
  } catch (e) { notifyError(e, "Couldn't tick it") }
}

/** `inline`: one line in running text; else a document at a sheet's sizes unless `full`. `from`: its file (for `[[#Heading]]`,
 *  closest names); `plain`: no note look; `seen`: notes embedding it; `tasks`: its boxes tick in `from`, where `text` is. */
export function Markdown({ text, store, inline, full, className, from, plain, seen, tasks }: { text: string; store?: Store; inline?: boolean; full?: boolean; className?: string; from?: string; plain?: boolean; seen?: string[]; tasks?: boolean }) {
  const s = store ?? getStore()
  const html = useMemo(() => {
    const opts = vaultOpts(s, from)
    return inline ? renderInline(text, opts) : renderMarkdown(text, opts)
  }, [text, s, inline, from])
  const ref = useRef<HTMLElement>(null)
  const seenKey = (seen ?? (from ? [from] : [])).join("\n")
  useEffect(() => {
    if (!ref.current) return
    hydrate(ref.current)
    wireTasks(ref.current, tasks && from && !isReadOnly(from) ? (nth, on) => void tickIn(from, text, nth, on) : null)
    markdownDrawn(ref.current)
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
  }, [html, s, from, seenKey, tasks, text])
  // Its diagrams let go when its HTML does (each holds a live drawing: observers, zoom).
  useEffect(() => {
    const drawn = [...ref.current?.querySelectorAll<HTMLElement>("[data-mermaid]") ?? []]
    return () => { for (const el of drawn) dropMermaid(el) }
  }, [html])
  const follow = (e: MouseEvent) => {
    if (e.button === 0 && ref.current && richClick(e, ref.current)) return
    const a = (e.target as Element).closest<HTMLElement>("[data-wiki], [data-tag], [data-url]")
    if (!a || !s) return
    e.preventDefault()
    e.stopPropagation()
    // ⌘-click or a middle-click: a new tab, as in the editor.
    followLink(s, a.dataset.tag ? { tag: a.dataset.tag } : a.dataset.url ? { url: a.dataset.url } : { wiki: a.dataset.wiki }, linkClick(e), from)
  }
  // An image in the text: its menu, as in a note (a `![[x]]` drawn in its place answers with its own first); a link:
  // its menu; text selected in it: Copy, under a link's items.
  const menu = (e: MouseEvent) => {
    if (!s || e.defaultPrevented) return
    const img = (e.target as Element).closest("img"), at = { x: e.clientX, y: e.clientY }
    if (img) {
      e.preventDefault(); e.stopPropagation()
      const src = img.getAttribute("src") ?? ""
      let target = src
      try { target = new URL(src, document.baseURI).searchParams.get("path") ?? src } catch { /* as written */ }
      openEmbedMenu(s, target, at, null, from)
      return
    }
    const l = drawnLink(e.target), sel = getSelection(), text = sel && !sel.isCollapsed && ref.current?.contains(sel.anchorNode) ? sel.toString() : ""
    const copy: MenuItem[] = text.trim() ? [{ label: "Copy", icon: Copy, hint: keyHint("Mod+C"), run: () => { copyText(text).catch((err) => notifyError(err)) } }] : []
    const items = grouped([l ? linkItems(l.link, { from, text: l.text }) : [], copy])
    if (!items.length) return
    e.preventDefault(); e.stopPropagation()
    openMenu(at, items)
  }
  const Tag = inline ? "span" : "div"
  return (
    <Tag ref={ref as never} className={cn(!plain && "note-prose", !plain && (inline ? "inline" : !full && "compact"), className)} onClick={follow} onAuxClick={(e) => { if (e.button === 1) follow(e) }} onContextMenu={menu} data-markdown-from={from} dangerouslySetInnerHTML={{ __html: html }} />
  )
}

/** Markdown as the app draws it, as HTML, for a plugin drawing its own elements: wikilinks resolved against the vault
 *  (`data-wiki`, `missing`), images, tags, callouts, math and mermaid waiting for `hydrateMarkdown`. */
export function markdownHtml(text: string, { inline, from }: { inline?: boolean; from?: string } = {}) {
  const opts = vaultOpts(getStore(), from)
  return inline ? renderInline(text, opts) : renderMarkdown(text, opts)
}
