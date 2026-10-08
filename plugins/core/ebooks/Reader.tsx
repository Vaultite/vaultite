// A book (untrusted) drawn with foliate-js, which renders pages in same-origin frames with scripts on (a WebKit bug),
// so every page is cleaned first (`safe`: no scripts, frames, handlers or javascript: links; a blocking CSP).
import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, List } from "lucide-react"
import { cn, Loading, menuBelow, openWebLink } from "@vaultite"

type TocItem = { label: string; href: string; subitems?: TocItem[] }
type Book = { metadata?: { title?: unknown; author?: unknown }; toc?: TocItem[]; dir?: string
  sections: { load: () => unknown; unload?: () => void; createDocument?: () => Promise<Document> }[]
  getCover?: () => Promise<Blob | null> }
type View = HTMLElement & { book: Book; open: (b: Book) => Promise<void>; close: () => void
  init: (o: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>
  goTo: (href: string) => Promise<void>; prev: () => Promise<void>; next: () => Promise<void>
  goLeft: () => Promise<void>; goRight: () => Promise<void>
  renderer: HTMLElement & { setStyles?: (css: string) => void } }
type Relocate = { fraction?: number; cfi?: string; tocItem?: { label?: string } }

const PLACE = (path: string) => `vau:ebooks:place:${path}`

/** The name foliate-js's metadata gives (a string, a language map, a list of contributors). */
function named(x: unknown): string {
  if (!x) return ""
  if (typeof x === "string") return x
  if (Array.isArray(x)) return x.map(named).filter(Boolean).join(", ")
  if (typeof x === "object") {
    const o = x as { name?: unknown }
    if (o.name) return named(o.name)
    return Object.values(o).map(named).find(Boolean) ?? ""
  }
  return String(x)
}

/** The book's file, named so foliate-js knows a comic book or a FictionBook by it. */
async function bookFile(url: string, path: string) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(r.statusText)
  return new File([await r.blob()], path.split("/").pop()!)
}

const CSP = "default-src 'none'; img-src blob: data:; media-src blob: data:; style-src blob: data: 'unsafe-inline'; font-src blob: data:"

/** A page of the book, cleaned: no scripts, frames, objects, event attributes or javascript: links, and a CSP first. */
async function safe(src: string): Promise<string> {
  const r = await fetch(src)
  const type = (r.headers.get("content-type") || "application/xhtml+xml").split(";")[0]
  const text = await r.text()
  if (!/html|xml|svg/.test(type)) return src
  const xml = type !== "text/html"
  let doc = new DOMParser().parseFromString(text, type as DOMParserSupportedType)
  if (xml && doc.querySelector("parsererror")) doc = new DOMParser().parseFromString(text, "text/html")
  for (const el of doc.querySelectorAll("script, iframe, frame, frameset, object, embed, applet, base, meta[http-equiv]")) el.remove()
  for (const el of doc.querySelectorAll("*")) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/(^|:)(href|src|action|formaction|xlink:href)$/i.test(a.name) && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value))) el.removeAttributeNode(a)
    }
  }
  const root = doc.documentElement
  const ns = root.namespaceURI ?? "http://www.w3.org/1999/xhtml"
  let head: Element | null = doc.querySelector("head")
  if (!head && root.localName === "html") { head = doc.createElementNS(ns, "head"); root.prepend(head) }
  if (head) {
    const meta = doc.createElementNS(ns, "meta")
    meta.setAttribute("http-equiv", "Content-Security-Policy")
    meta.setAttribute("content", CSP)
    head.prepend(meta)
  }
  const out = xml && !doc.querySelector("parsererror") ? new XMLSerializer().serializeToString(doc) : `<!DOCTYPE html>${root.outerHTML}`
  URL.revokeObjectURL(src)
  return URL.createObjectURL(new Blob([out], { type: xml ? type : "text/html" }))
}

/** Every section's page cleaned before it's drawn (and its URL let go of with it). */
function guard(book: Book) {
  for (const s of book.sections) {
    const load = s.load.bind(s), unload = s.unload?.bind(s)
    let made: string | null = null
    s.load = async () => {
      const src = await load()
      if (typeof src !== "string") return src
      made = await safe(src)
      return made
    }
    s.unload = () => {
      if (made) URL.revokeObjectURL(made)
      made = null
      unload?.()
    }
  }
}

/** The app's colours and text size, for the book's pages. */
function pageStyle() {
  const css = getComputedStyle(document.documentElement)
  const fg = css.getPropertyValue("--foreground").trim()
  const link = css.getPropertyValue("--primary").trim()
  return `
    html { color-scheme: light dark; }
    html, body { color: ${fg} !important; background: transparent !important; }
    body * { color: inherit; background-color: transparent; }
    a, a * { color: ${link} !important; }
    img, svg { max-width: 100%; }
    p, li, blockquote, dd { line-height: 1.5; hyphens: auto; }`
}

export default function Reader({ url, path, embed }: { url: string; path: string; embed?: boolean }) {
  return embed ? <Card url={url} path={path} /> : <Pages url={url} path={path} />
}

function Pages({ url, path }: { url: string; path: string }) {
  const box = useRef<HTMLDivElement>(null)
  const view = useRef<View | null>(null)
  const [state, setState] = useState<"loading" | "ok" | string>("loading")
  const [where, setWhere] = useState<{ fraction: number; label: string }>({ fraction: 0, label: "" })
  const [toc, setToc] = useState<TocItem[]>([])
  // ← and → turn pages, in the reader and inside its pages (their frames get the keys once clicked).
  const keys = (e: KeyboardEvent | React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === "ArrowLeft") { e.preventDefault(); void view.current?.goLeft() }
    else if (e.key === "ArrowRight") { e.preventDefault(); void view.current?.goRight() }
  }
  useEffect(() => {
    const el = box.current
    if (!el) return
    let on = true
    setState("loading")
    ;(async () => {
      const [{ makeBook }, file] = await Promise.all([import("foliate-js/view.js"), bookFile(url, path)])
      const book = await makeBook(file) as Book
      if (!on) return
      guard(book)
      const v = document.createElement("foliate-view") as View
      v.style.display = "block"
      v.style.height = "100%"
      el.replaceChildren(v)
      view.current = v
      v.addEventListener("relocate", (e) => {
        const d = (e as CustomEvent<Relocate>).detail
        setWhere({ fraction: d.fraction ?? 0, label: d.tocItem?.label?.trim() ?? "" })
        if (d.cfi) try { localStorage.setItem(PLACE(path), d.cfi) } catch { /* storage full: not kept */ }
      })
      // Links outside the book: to the web like any link in the app, nothing else (inside it, foliate-js turns to the page).
      v.addEventListener("external-link", (e) => {
        e.preventDefault()
        const href = String((e as CustomEvent<{ href: string }>).detail.href ?? "")
        if (/^https?:/i.test(href)) openWebLink(href)
      })
      v.addEventListener("load", (e) => {
        const doc = (e as CustomEvent<{ doc: Document }>).detail.doc
        doc.addEventListener("keydown", keys)
      })
      await v.open(book)
      v.renderer.setAttribute("flow", "paginated")
      v.renderer.setAttribute("gap", "6%")
      v.renderer.setAttribute("max-inline-size", "680px")
      v.renderer.setStyles?.(pageStyle())
      if (!on) return
      setToc(book.toc ?? [])
      let last: string | null = null
      try { last = localStorage.getItem(PLACE(path)) } catch { /* no storage */ }
      await v.init({ lastLocation: last ?? undefined, showTextStart: !last })
      if (on) setState("ok")
    })().catch((e) => { if (on) setState(String(e?.message ?? e)) })
    return () => { on = false; view.current?.close(); view.current = null; el.replaceChildren() }
  }, [url, path])
  const contents = (e: React.MouseEvent<HTMLButtonElement>) => {
    const flat = (items: TocItem[], depth: number): { label: string; run: () => void }[] =>
      items.flatMap((t) => [{ label: `${"    ".repeat(depth)}${t.label.trim()}`, run: () => void view.current?.goTo(t.href) }, ...flat(t.subitems ?? [], depth + 1)])
    menuBelow(e, flat(toc, 0))
  }
  const side = "absolute top-1/2 z-[1] grid size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
  return (
    <div className="flex h-full flex-col" tabIndex={0} onKeyDown={keys} data-keeps-keys data-ebook>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b-[0.5px] border-border px-2 text-[13px]">
        {toc.length > 0 && (
          <button type="button" onClick={contents} className="flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
            <List className="size-4" strokeWidth={2} />Contents
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{where.label}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{Math.round(where.fraction * 100)}%</span>
      </div>
      <div className="relative min-h-0 flex-1">
        {state === "loading" && <div className="absolute inset-0"><Loading /></div>}
        {state !== "loading" && state !== "ok" && <p className="p-4 text-[15px] text-muted-foreground">This book couldn't be opened: {state}.</p>}
        <div ref={box} className={cn("absolute inset-y-0 right-11 left-11", state !== "ok" && "invisible")} />
        <button type="button" aria-label="Previous page" onClick={() => void view.current?.goLeft()} className={cn(side, "left-1")}><ChevronLeft className="size-5" /></button>
        <button type="button" aria-label="Next page" onClick={() => void view.current?.goRight()} className={cn(side, "right-1")}><ChevronRight className="size-5" /></button>
      </div>
      <div className="h-[3px] shrink-0 bg-foreground/[0.06]"><div className="h-full bg-primary" style={{ width: `${where.fraction * 100}%` }} /></div>
    </div>
  )
}

/** A book embedded in a note: its cover, title and authors. */
function Card({ url, path }: { url: string; path: string }) {
  const [info, setInfo] = useState<{ title: string; author: string; cover: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let on = true, cover: string | null = null
    ;(async () => {
      const [{ makeBook }, file] = await Promise.all([import("foliate-js/view.js"), bookFile(url, path)])
      const book = await makeBook(file) as Book
      const blob = await book.getCover?.().catch(() => null)
      cover = blob ? URL.createObjectURL(blob) : null
      if (on) setInfo({ title: named(book.metadata?.title) || path.split("/").pop()!.replace(/\.[^.]+$/, ""), author: named(book.metadata?.author), cover })
    })().catch((e) => { if (on) setError(String(e?.message ?? e)) })
    return () => { on = false; if (cover) URL.revokeObjectURL(cover) }
  }, [url, path])
  if (error) return <p className="p-3 text-[15px] text-muted-foreground">This book couldn't be opened: {error}.</p>
  if (!info) return <div className="h-24"><Loading /></div>
  return (
    <div className="flex items-center gap-4 p-3">
      {info.cover
        ? <img src={info.cover} alt="" className="h-28 w-auto shrink-0 rounded-[4px] shadow-sm" draggable={false} />
        : <div className="grid h-28 w-20 shrink-0 place-items-center rounded-[4px] bg-foreground/[0.06] text-muted-foreground" />}
      <div className="min-w-0">
        <p className="text-[17px] leading-6 font-semibold">{info.title}</p>
        {info.author && <p className="mt-0.5 text-[15px] text-muted-foreground">{info.author}</p>}
      </div>
    </div>
  )
}
