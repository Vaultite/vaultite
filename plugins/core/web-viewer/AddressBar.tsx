// The page bar's address (the container chip and Shields inside it): completed inline to a site visited before, with a
// list under it (search, open tabs, bookmarks, history) over the native page, which WebPage swaps for its picture.
import { Fragment, useEffect, useLayoutEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react"
import { ArrowRight, Search, Star, X } from "lucide-react"
import { cn, isMac, isViewOpen, openView, useStore, webPages, type WebPageInfo } from "@vaultite"
import { addressOf, hostOf, searchUrl } from "./address"
import { matchBookmarks, type Bookmark } from "./bookmarks"
import { argOf, containerOfProfile } from "./containers"
import { removeVisits, searchHistory, useHistoryChanged, type Found } from "./history"
import { SiteIcon } from "./icons"
import { profile, settings } from "./state"

/** Open `url` in this tab (or a new one): typed, or a bookmark's. */
export type Go = (url: string, how: "typed" | "bookmark", newTab: boolean) => void

type Row =
  | { kind: "url"; url: string; title: string }
  | { kind: "search"; url: string; words: string; engine: string }
  | { kind: "tab"; url: string; title: string; arg: string }
  | { kind: "bookmark"; url: string; title: string }
  | { kind: "history"; url: string; title: string }

const MAX = 8
const bare = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "")
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The web pages of this window that a tab here has open (shown or kept in the background). */
async function openTabs(): Promise<(WebPageInfo & { arg: string })[]> {
  const list = await webPages?.list?.().catch(() => []) ?? []
  const mine = profile()
  return list.flatMap((p) => {
    const c = containerOfProfile(p.profile), arg = argOf(p.url, c)
    return /^https?:/i.test(p.url) && (c || p.profile === mine) && isViewOpen(`view:web/${arg}`) ? [{ ...p, arg }] : []
  })
}

export function AddressBar({ url, current, lead, trail, inputRef, onGo, onLeave }: {
  /** The page's address (what shows while not typing). */
  url: string
  /** This tab's arg: it isn't offered as a tab to switch to. */
  current: string
  /** Inside the field, before and after what's typed (the container chip, Shields). */
  lead?: ReactNode
  trail?: ReactNode
  inputRef: RefObject<HTMLInputElement | null>
  onGo: Go
  /** Esc with nothing to close: the keyboard goes back to the page. */
  onLeave: () => void
}) {
  /** What's typed (null: not typing), without the inline completion. */
  const [typed, setTyped] = useState<string | null>(null)
  /** Inline completion is offered (not after deleting, nor after Esc). */
  const [auto, setAuto] = useState(true)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const [moved, setMoved] = useState(false)
  const [answer, setFound] = useState<{ for: string; data: Found } | null>(null)
  const [tabs, setTabs] = useState<(WebPageInfo & { arg: string })[]>([])
  const [version, setVersion] = useState(0)
  const bookmarks = useStore().store?.bookmarks ?? NONE
  const { search } = settings.use()
  useHistoryChanged(useMemo(() => () => setVersion((v) => v + 1), []))

  const text = typed ?? ""
  useEffect(() => {
    const t = text.trim()
    if (typed === null || !t) return
    let gone = false
    searchHistory(t, MAX).then((data) => { if (!gone) setFound({ for: text, data }) }, () => {})
    return () => { gone = true }
  }, [typed, text, version])

  const found = typed !== null && text.trim() ? answer : null
  // The site completed inline: what the history completes what's typed to, while it still starts so.
  const c = found?.data.complete ?? null
  const suffix = auto && typed && c && !/\s/.test(typed) && c.text.length > typed.length && c.text.toLowerCase().startsWith(typed.toLowerCase())
    && typed.toLowerCase().startsWith(found!.for.trim().toLowerCase().slice(0, typed.length)) ? c.text.slice(typed.length) : ""
  const shown = typed === null ? url : typed + suffix
  useLayoutEffect(() => {
    const el = inputRef.current
    if (suffix && el && document.activeElement === el) el.setSelectionRange(typed!.length, typed!.length + suffix.length, "forward")
  }, [typed, suffix, inputRef])

  const rows = useMemo((): Row[] => {
    const t = text.trim()
    if (typed === null || !t) return []
    const out: Row[] = [], seen = new Set<string>()
    // (an open tab is offered beside the same address typed: switching to it is another thing to do)
    const add = (r: Row) => { const k = r.kind === "tab" ? `tab ${r.url}` : r.url; if (out.length < MAX && !seen.has(k)) { seen.add(k); out.push(r) } }
    const titled = (u: string) => found?.data.rows.find((r) => r.url === u)?.title ?? ""
    const all = typed + suffix
    const done = c && (suffix || c.text.toLowerCase() === all.toLowerCase()) ? c : null
    const to = addressOf(t, search)
    const words = !!to && to === searchUrl(t, search)
    const searchRow: Row | null = /^https?:\/\//i.test(t) ? null : { kind: "search", url: searchUrl(t, search), words: t, engine: hostOf(searchUrl("", search)) }
    if (done) add({ kind: "url", url: done.url, title: titled(done.url) })
    else if (to && !words) add({ kind: "url", url: to, title: titled(to) })
    if (searchRow) add(searchRow)
    const ws = t.toLowerCase().split(/\s+/)
    for (const p of tabs.filter((p) => p.arg !== current && ws.every((w) => `${p.title} ${p.url}`.toLowerCase().includes(w))).slice(0, 2)) add({ kind: "tab", url: p.url, title: p.title, arg: p.arg })
    for (const b of matchBookmarks(bookmarks, t, 3)) add({ kind: "bookmark", url: b.url, title: b.title })
    for (const r of found?.data.rows ?? []) add({ kind: "history", url: r.url, title: r.title })
    return out
  }, [typed, text, suffix, c, found, search, tabs, bookmarks, current])
  const list = open && rows.length > 0
  const at = Math.min(sel, Math.max(0, rows.length - 1))

  const reset = () => { setTyped(null); setOpen(false); setSel(0); setMoved(false); setAuto(true) }
  const pick = (r: Row | undefined, newTab: boolean) => {
    if (!r) return
    reset()
    inputRef.current?.blur()
    if (r.kind === "tab") openView(`web/${r.arg}`, { newTab: true })
    else onGo(r.url, r.kind === "bookmark" ? "bookmark" : "typed", newTab)
  }
  const forget = async (r: Row) => {
    if (r.kind !== "history") return
    await removeVisits({ urls: [r.url] }).catch(() => {})
    setVersion((v) => v + 1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!rows.length) return
      e.preventDefault()
      setOpen(true)
      setMoved(true)
      setSel(Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (rows.length) pick(rows[at], mod)
    } else if (e.key === "Escape") {
      e.preventDefault()
      // First the list (and the completion), then the page.
      if (list || suffix) { setOpen(false); setAuto(false); setSel(0); setMoved(false); return }
      reset()
      e.currentTarget.blur()
      onLeave()
    } else if ((e.key === "Delete" || e.key === "Backspace") && list && rows[at]?.kind === "history" && (e.shiftKey || (e.key === "Delete" && moved))) {
      e.preventDefault()
      void forget(rows[at])
    } else if ((e.key === "ArrowRight" || e.key === "End") && suffix) {
      // (taking the completion: it's typed now)
      setTyped(typed + suffix)
    }
  }

  return (
    <div className="relative mx-1 min-w-12 flex-1" data-web-address-bar>
      <div onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus() } }}
        className="flex h-7 items-center gap-0.5 rounded-[6px] bg-foreground/[0.05] pr-0.5 has-[input:focus]:bg-background has-[input:focus]:ring-1 has-[input:focus]:ring-primary/50">
        {lead}
        <input ref={inputRef} aria-label="Address" spellCheck={false} autoComplete="off" data-web-address placeholder="Search or type an address"
          role="combobox" aria-expanded={list} aria-controls="web-suggestions" aria-autocomplete="both"
          value={shown}
          onChange={(e) => {
            const deleting = (e.nativeEvent as InputEvent).inputType?.startsWith("delete")
            setTyped(e.target.value)
            setAuto(!deleting)
            setOpen(true)
            setSel(0)
            setMoved(false)
          }}
          onFocus={(e) => {
            setTyped(url)
            setOpen(false)
            setAuto(true)
            e.currentTarget.select()
            void openTabs().then(setTabs)
          }}
          onBlur={reset}
          onKeyDown={onKeyDown}
          className={cn("h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-tertiary", lead ? "pl-1.5" : "pl-2.5",
            trail ? "pr-1" : "pr-2", typed === null && "text-muted-foreground")} />
        {trail}
      </div>
      {list && (
        <div id="web-suggestions" role="listbox" aria-label="Suggestions" data-web-suggestions onMouseDown={(e) => e.preventDefault()}
          className="glass-strong absolute top-[calc(100%+4px)] right-0 left-0 z-50 min-w-[320px] overflow-hidden rounded-[10px] p-1 shadow-xl">
          {rows.map((r, i) => (
            <Suggestion key={`${r.kind} ${r.url}`} row={r} selected={i === at} words={text} onHover={() => setSel(i)}
              onPick={(e) => pick(r, isMac ? e.metaKey : e.ctrlKey)} onForget={() => void forget(r)} />
          ))}
        </div>
      )}
    </div>
  )
}
const NONE: Bookmark[] = []

function Suggestion({ row: r, selected, words, onHover, onPick, onForget }: { row: Row; selected: boolean; words: string; onHover: () => void
  onPick: (e: MouseEvent) => void; onForget: () => void }) {
  const title = r.kind === "search" ? r.words : r.title
  const where = r.kind === "search" ? `Search with ${r.engine}` : bare(r.url)
  return (
    <div role="option" aria-selected={selected} data-suggestion={r.kind} data-url={r.url} onMouseMove={onHover} onClick={onPick}
      className={cn("group flex h-8 cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 text-[13px]", selected && "bg-foreground/[0.07]")}>
      {r.kind === "search"
        ? <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        : <SiteIcon url={r.url} className="size-4 shrink-0 text-muted-foreground" />}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
        {title && <span className="min-w-0 shrink truncate text-foreground/90"><Marked text={title} words={words} /></span>}
        {title && r.kind !== "search" && <span className="shrink-0 text-tertiary">–</span>}
        <span className={cn("min-w-0 truncate", title ? "shrink-[2] text-muted-foreground" : "text-foreground/90")}>
          {r.kind === "search" ? where : <Marked text={where} words={words} />}
        </span>
      </span>
      {r.kind === "tab" && <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">Switch to tab<ArrowRight className="size-3.5" strokeWidth={2} /></span>}
      {r.kind === "bookmark" && <Star className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-label="Bookmark" />}
      {r.kind === "history" && (
        <button type="button" aria-label="Remove from history" data-tip="Remove from history"
          onClick={(e) => { e.stopPropagation(); onForget() }}
          className={cn("-mr-1 grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground",
            selected ? "visible" : "invisible group-hover:visible")}>
          <X className="size-3.5" strokeWidth={2.25} />
        </button>
      )}
    </div>
  )
}

/** The typed words, where they start a word of `text`, drawn bold. */
function Marked({ text, words }: { text: string; words: string }): ReactNode {
  const ws = words.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!ws.length) return text
  const parts = text.split(new RegExp(`(${ws.map(escapeRe).join("|")})`, "ig"))
  return parts.map((p, i) => (i % 2 ? <b key={i} className="font-semibold text-foreground">{p}</b> : <Fragment key={i}>{p}</Fragment>))
}
