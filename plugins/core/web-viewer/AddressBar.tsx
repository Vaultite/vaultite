// The page bar's address (the container chip and Shields inside it): completed inline, a list under it (search, open
// tabs, bookmarks, history) over the native page. What's typed is the tab's draft (drafts.ts), kept on leaving the field.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react"
import { ArrowRight, Search, Star, X } from "lucide-react"
import { closeTab, cn, getTabLayout, isMac, openMenu, panesOf, selectTab, useStore, webPages, type WebPageInfo } from "@vaultite"
import { addressOf, guessedHttps, hostOf, searchUrl } from "./address"
import { matchBookmarks, type Bookmark } from "./bookmarks"
import { argOf, colorOf, containerById, containerOfProfile } from "./containers"
import type { Draft } from "./drafts"
import { removeVisits, searchHistory, useHistoryChanged, type Found } from "./history"
import { SiteIcon } from "./icons"
import { profile, settings } from "./state"

/** Where an address opens: this tab, a new tab in front (⌥Enter) or behind (⌘Enter). */
export type Place = "here" | "front" | "back"
/** Open `url` (typed, or a bookmark's); `guessed`: https only because no scheme was typed. */
export type Go = (url: string, how: "typed" | "bookmark", place: Place, guessed?: boolean) => void

type Row =
  | { kind: "url"; url: string; title: string; guessed?: boolean }
  | { kind: "search"; url: string; words: string; engine: string }
  | { kind: "tab"; url: string; title: string; arg: string; tab: string; container: string | null }
  | { kind: "bookmark"; url: string; title: string }
  | { kind: "history"; url: string; title: string }

const MAX = 8
const bare = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "")
/** The address as a browser shows it while it isn't being edited: no https://, no lone slash after the host. */
const trimmed = (u: string) => u.replace(/^https:\/\//i, "").replace(/^([^/?#]+)\/$/, "$1")
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const placeOf = (e: { altKey: boolean; metaKey: boolean; ctrlKey: boolean }): Place => (e.altKey ? "front" : (isMac ? e.metaKey : e.ctrlKey) ? "back" : "here")

type OpenTab = WebPageInfo & { arg: string; tab: string; container: string | null }
/** The web pages of this window that a tab of this workspace has open (shown or kept in the background). */
async function openTabs(): Promise<OpenTab[]> {
  const list = await webPages?.list?.().catch(() => []) ?? []
  const mine = profile(), here = new Set(panesOf(getTabLayout().root).flatMap((g) => g.tabs.map((t) => t.id)))
  return list.flatMap((p) => {
    const c = containerOfProfile(p.profile)
    return /^https?:/i.test(p.url) && p.tab && here.has(p.tab) && (c || p.profile === mine) ? [{ ...p, arg: argOf(p.url, c), tab: p.tab, container: c }] : []
  })
}

export function AddressBar({ url, tab, blank, draft, setDraft, lead, trail, inputRef, onGo, onTurn, onTarget, onLeave }: {
  /** The page's address (what shows while not edited). */
  url: string
  /** This tab's id: it isn't offered as a tab to switch to. */
  tab: string
  /** It has no page yet (a new tab): switching to another tab from it closes it. */
  blank: boolean
  draft: Draft | null
  setDraft: (d: Draft | null) => void
  /** Inside the field, before and after what's typed (the container chip, Shields). */
  lead?: ReactNode
  trail?: ReactNode
  inputRef: RefObject<HTMLInputElement | null>
  onGo: Go
  /** ⌥↑/⌥↓: the container what's typed opens in, the one before or after. */
  onTurn: (by: 1 | -1) => void
  /** The address Enter would open now (null: none typed), for the chip to say where it opens. */
  onTarget: (url: string | null) => void
  /** Esc with nothing to close or revert: the keyboard goes back to the page. */
  onLeave: () => void
}) {
  const [focused, setFocused] = useState(false)
  /** Inline completion is offered (not after deleting, nor after Esc or leaving). */
  const [auto, setAuto] = useState(true)
  const [composing, setComposing] = useState(false)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const [moved, setMoved] = useState(false)
  const [answer, setFound] = useState<{ for: string; data: Found } | null>(null)
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [version, setVersion] = useState(0)
  /** The selection to put back as the keyboard returns from the chip's menu (instead of selecting it all). */
  const back = useRef<[number, number] | null>(null)
  /** Select it all once the address is drawn back (Esc's revert: typing then replaces it). */
  const reselect = useRef(false)
  useLayoutEffect(() => { if (reselect.current) { reselect.current = false; inputRef.current?.select() } })
  const bookmarks = useStore().store?.bookmarks ?? NONE
  const { search } = settings.use()
  useHistoryChanged(useMemo(() => () => setVersion((v) => v + 1), []))

  /** What's typed (null: not edited), without the inline completion. */
  const typed = draft?.text ?? null
  const text = typed ?? ""
  const edit = (t: string | null) => setDraft(t === null && draft?.chosen === undefined ? null : { text: t, chosen: draft?.chosen, on: url })
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
  const suffix = focused && auto && !composing && typed && c && !/\s/.test(typed) && c.text.length > typed.length && c.text.toLowerCase().startsWith(typed.toLowerCase())
    && typed.toLowerCase().startsWith(found!.for.trim().toLowerCase().slice(0, typed.length)) ? c.text.slice(typed.length) : ""

  const rows = useMemo((): Row[] => {
    const t = text.trim()
    if (typed === null || !t) return []
    const titled = (u: string) => found?.data.rows.find((r) => r.url === u)?.title ?? ""
    const all = typed + suffix
    const done = c && (suffix || c.text.toLowerCase() === all.toLowerCase()) ? c : null
    const to = addressOf(t, search)
    const words = !!to && to === searchUrl(t, search)
    const head: Row[] = []
    if (done) head.push({ kind: "url", url: done.url, title: titled(done.url) })
    else if (to && !words) head.push({ kind: "url", url: to, title: titled(to), guessed: guessedHttps(t) })
    if (!/^https?:\/\//i.test(t)) head.push({ kind: "search", url: searchUrl(t, search), words: t, engine: hostOf(searchUrl("", search)) })
    // The rest by how well each matches, whatever its kind: the history's score, more for an open tab or a bookmark.
    const scores = new Map(found?.data.rows.map((r) => [r.url, r.score]) ?? [])
    const least = Math.min(1, ...scores.values())
    const ws = t.toLowerCase().split(/\s+/)
    const rest: [Row, number][] = [
      ...tabs.filter((p) => p.tab !== tab && ws.every((w) => `${p.title} ${p.url}`.toLowerCase().includes(w))).slice(0, 3)
        .map((p): [Row, number] => [{ kind: "tab", url: p.url, title: p.title, arg: p.arg, tab: p.tab, container: p.container }, (scores.get(p.url) ?? least) * 1.5]),
      ...matchBookmarks(bookmarks, t, 3).map((b): [Row, number] => [{ kind: "bookmark", url: b.url, title: b.title }, (scores.get(b.url) ?? least) * 1.2]),
      ...(found?.data.rows ?? []).map((r): [Row, number] => [{ kind: "history", url: r.url, title: r.title }, r.score]),
    ]
    const out: Row[] = [], seen = new Set<string>()
    // (an open tab is offered beside the same address typed: switching to it is another thing to do)
    for (const r of [...head, ...rest.sort((a, b) => b[1] - a[1]).map(([r]) => r)]) {
      const k = r.kind === "tab" ? `tab ${r.arg}` : r.url
      if (out.length < MAX && !seen.has(k)) { seen.add(k); out.push(r) }
    }
    return out
  }, [typed, text, suffix, c, found, search, tabs, bookmarks, tab])
  const list = focused && open && rows.length > 0
  const at = Math.min(sel, Math.max(0, rows.length - 1))
  // ↑/↓ show the chosen row's address in the field, as Chrome does; typing goes on from it.
  const filled = list && moved && at > 0 ? (rows[at].kind === "search" ? (rows[at] as { words: string }).words : rows[at].url) : null
  const shown = filled ?? (typed !== null ? typed + suffix : focused ? url : trimmed(url))
  const target = typed === null ? null : (list ? rows[at] : rows[0])?.url ?? null
  useEffect(() => onTarget(target), [target, onTarget])
  useLayoutEffect(() => {
    const el = inputRef.current
    if (suffix && !filled && el && document.activeElement === el) el.setSelectionRange(typed!.length, typed!.length + suffix.length, "forward")
  }, [typed, suffix, filled, inputRef])

  const closeList = () => { setOpen(false); setSel(0); setMoved(false) }
  const go = (to: string, how: "typed" | "bookmark", place: Place, guessed?: boolean) => {
    setDraft(null)
    closeList()
    setAuto(true)
    inputRef.current?.blur()
    onGo(to, how, place, guessed)
  }
  const pick = (r: Row | undefined, place: Place) => {
    if (!r) return
    if (r.kind !== "tab") return go(r.url, r.kind === "bookmark" ? "bookmark" : "typed", place, r.kind === "url" && r.guessed)
    setDraft(null)
    closeList()
    selectTab(r.tab)
    // (a new tab that was only for finding it isn't left behind)
    if (blank) closeTab(tab)
  }
  const forget = async (r: Row) => {
    if (r.kind !== "history") return
    await removeVisits({ urls: [r.url] }).catch(() => {})
    setVersion((v) => v + 1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (composing || e.nativeEvent.isComposing) return
    if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault()
      onTurn(e.key === "ArrowDown" ? 1 : -1)
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || (e.key === "Tab" && list)) {
      if (!rows.length) return
      e.preventDefault()
      const by = e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey) ? 1 : -1
      if (!list) { setOpen(true); return }
      setMoved(true)
      setSel(Math.max(0, Math.min(rows.length - 1, at + by)))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (typed === null) { if (url) go(url, "typed", placeOf(e)) }
      else if (rows.length) pick(list ? rows[at] : rows[0], placeOf(e))
    } else if (e.key === "Escape") {
      e.preventDefault()
      // First the list (and the completion), then what's typed (back to the page's address), then the page.
      if (list || suffix) { closeList(); setAuto(false); return }
      if (draft) { setDraft(null); setAuto(true); reselect.current = true; return }
      e.currentTarget.blur()
      onLeave()
    } else if ((e.key === "Delete" || e.key === "Backspace") && list && rows[at]?.kind === "history" && (e.shiftKey || (e.key === "Delete" && moved))) {
      e.preventDefault()
      void forget(rows[at])
    } else if ((e.key === "ArrowRight" || e.key === "End") && suffix) {
      // (taking the completion: it's typed now)
      edit(typed + suffix)
    }
  }

  // Right-click: the field's own menu, with Paste and go (Paste and search for words), as browsers have.
  const menu = (e: MouseEvent<HTMLInputElement>) => {
    e.preventDefault()
    const el = e.currentTarget, at = { x: e.clientX, y: e.clientY }
    const a = el.selectionStart ?? 0, b = el.selectionEnd ?? 0, chosen = el.value.slice(a, b)
    const put = (s: string) => { el.focus(); edit(el.value.slice(0, a) + s + el.value.slice(b)); setOpen(true) }
    void navigator.clipboard.readText().catch(() => "").then((clip) => {
      const t = clip.trim().replace(/\s+/g, " "), to = t ? addressOf(t, search) : null, words = !!to && to === searchUrl(t, search)
      openMenu(at, [
        { label: "Cut", disabled: !chosen, run: () => { void navigator.clipboard.writeText(chosen); put("") } },
        { label: "Copy", disabled: !chosen, run: () => void navigator.clipboard.writeText(chosen) },
        { label: "Paste", disabled: !clip, run: () => put(clip) },
        { label: words ? "Paste and search" : "Paste and go", disabled: !to, run: () => { if (to) go(to, "typed", "here", guessedHttps(t)) } },
        { label: "Select all", sep: true, run: () => { el.focus(); el.select() } },
      ])
    })
  }

  return (
    <div className="relative mx-1 min-w-12 flex-1" data-web-address-bar>
      <div onMouseDown={(e) => {
        if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus(); return }
        // The chip, while typing: the field keeps the keyboard (and what's typed), and gets it back from its menu as it was.
        const el = inputRef.current
        if (el && document.activeElement === el && e.target !== el) { e.preventDefault(); back.current = [el.selectionStart ?? 0, el.selectionEnd ?? 0] }
      }}
        className="flex h-7 items-center gap-0.5 rounded-[6px] bg-foreground/[0.05] pr-0.5 has-[input:focus]:bg-background has-[input:focus]:ring-1 has-[input:focus]:ring-primary/50">
        {lead}
        <input ref={inputRef} aria-label="Address" spellCheck={false} autoComplete="off" data-web-address placeholder="Search or type an address"
          role="combobox" aria-expanded={list} aria-controls="web-suggestions" aria-autocomplete="both"
          value={shown}
          onChange={(e) => {
            const deleting = (e.nativeEvent as InputEvent).inputType?.startsWith("delete")
            edit(e.target.value)
            setAuto(!deleting)
            setOpen(true)
            setSel(0)
            setMoved(false)
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onFocus={(e) => {
            setFocused(true)
            setAuto(true)
            void openTabs().then(setTabs)
            const was = back.current
            back.current = null
            if (was) { const el = e.currentTarget; requestAnimationFrame(() => el.setSelectionRange(was[0], was[1])); return }
            // (a draft comes back as it was left, its list too; else the whole address, ready to replace)
            if (typed !== null) setOpen(true)
            e.currentTarget.select()
          }}
          onBlur={() => {
            setFocused(false)
            setComposing(false)
            closeList()
            // (a container picked with nothing typed was for this edit only)
            if (draft && typed === null && url && !back.current) setDraft(null)
          }}
          onKeyDown={onKeyDown}
          onContextMenu={menu}
          className={cn("h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-tertiary", lead ? "pl-1.5" : "pl-2.5",
            trail ? "pr-1" : "pr-2", typed === null && !focused && "text-muted-foreground")} />
        {trail}
      </div>
      {list && (
        <div id="web-suggestions" role="listbox" aria-label="Suggestions" data-web-suggestions onMouseDown={(e) => e.preventDefault()}
          className="glass-strong absolute top-[calc(100%+4px)] right-0 left-0 z-50 min-w-[320px] overflow-hidden rounded-[10px] p-1 shadow-xl">
          {rows.map((r, i) => (
            <Suggestion key={r.kind === "tab" ? `tab ${r.arg}` : `${r.kind} ${r.url}`} row={r} selected={i === at} words={text} onHover={() => setSel(i)}
              onPick={(e) => pick(r, placeOf(e))} onForget={() => void forget(r)} />
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
  const box = r.kind === "tab" ? containerById(r.container) : null
  return (
    <div role="option" aria-selected={selected} data-suggestion={r.kind} data-url={r.url} data-container={r.kind === "tab" ? r.container ?? "" : undefined}
      onMouseMove={onHover} onClick={onPick}
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
      {r.kind === "tab" && (
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
          {box && <span className="size-2 rounded-full" style={{ background: colorOf(box) }} />}
          {box ? box.name : null}{box && <span className="text-tertiary">·</span>}Switch to tab<ArrowRight className="size-3.5" strokeWidth={2} />
        </span>
      )}
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
