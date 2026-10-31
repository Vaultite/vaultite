// A web page in a tab: a slim bar over the desktop app's native page. While anything of the app covers the box, the
// window goes over its pages and shows the live page through a hole (layers.ts).
import { useEffect, useRef, useState, type ReactNode } from "react"
import { AppWindow, ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, Check, ChevronDown, Ellipsis, FileCode2, FileWarning, Globe, History, Lock, MonitorPlay, MousePointer2, MousePointerSquareDashed, PanelTopClose, PanelTopOpen, Pause, PictureInPicture2, Play, Printer, RotateCw, Scissors,
  Search, ShieldAlert, Undo2, Volume2, VolumeX, WifiOff, X, type LucideIcon } from "lucide-react"
import {
  Button, canNavigate, cn, commandKeys, getTabLayout, menuBelow, menuFor, navigate, notify, notifyError, openInSplit, openMenu, openView, panesOf, post, typingIn, useEnabled, usePane, usePaneTopBar, webPageActions, webPages,
  type MenuItem, type WebPageAction, type WebPageState, type WebPages,
} from "@vaultite"
import { hostOf } from "./address"
import { floatCover, hitCover, matters, moved, overlap, painted, passPointer, popupOpen, sameRect, setCover, setHole, SLIDES, type Change, type Cover } from "./layers"
import { ExtensionButtons, extensionItems, useExtensionBar } from "./Extensions"
import { AddressBar, type Go } from "./AddressBar"
import { ContainerButton } from "./ContainerButton"
import { manageContainers } from "./Sites"
import { argOf, containerById, containers, destination, keepOutside, keptOutside, openBehind, profileIn, splitArg, viewSource } from "./containers"
import { fallbackFor, fallsBack, guessedFor, openWebTab, useDraft } from "./drafts"
import { markTyped } from "./history"
import { pickElement, ShieldsButton } from "./shields"
import { Start } from "./Start"
import { Passkey } from "./Passkey"
import { bookmark, forgetUnheard, hasKeyboard, passkeyAsks, setFocusedPage, setOnScreen, setPlayer, settingsRead, setTitle, shown, takeUnheard, type FindAsk } from "./state"
import { FindBar, findOpen, setFindOpen, type Found } from "./FindBar"
import { siteIcon } from "./icons"
import { setBarHidden, usePageBar } from "./pagebar"
import { agentPages, doneAsk, pauseAgents, toBackground, working, WORKING_MS } from "./agentpages"

type Props = { arg: string; focused: boolean; setArg: (arg: string) => void }

export default function WebPage(props: Props) {
  return webPages ? <Page web={webPages} {...props} /> : <Elsewhere url={splitArg(props.arg).url} />
}

/** On the web and phones: pages open outside (most sites refuse to be shown inside another page). */
function Elsewhere({ url }: { url: string }) {
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center px-8 pt-20 text-center" data-web-elsewhere>
      <Globe className="size-8 text-tertiary" strokeWidth={1.5} />
      <p className="mt-4 text-[15px] leading-[21px] text-muted-foreground">Web pages open in a tab in Vaultite's desktop app. Here they open in your browser.</p>
      <a href={url} target="_blank" rel="noreferrer" className="mt-3 max-w-full truncate text-[15px] text-primary hover:underline">Open {hostOf(url)}</a>
    </div>
  )
}

/** Where in the box the page goes: above the status bar's corners where they're drawn over the pane's foot (laid over
 *  one, the page would hide it, and one over the page would raise the window over it the whole time). */
function pageArea(r: DOMRect) {
  const over = [...document.querySelectorAll("[data-status-bar]")].map((el) => el.getBoundingClientRect())
    .filter((bar) => bar.height && bar.left < r.right && bar.right > r.left && bar.top < r.bottom && bar.bottom > r.top)
  if (!over.length) return r
  return new DOMRect(r.left, r.top, r.width, Math.max(0, Math.min(...over.map((bar) => bar.top)) - r.top))
}

const http = (u: string) => /^https?:\/\//i.test(u)
/** What a tab may follow and name: the web, an extension's own pages (its options) and a page's source. */
const ownPage = (u: string) => http(u) || /^(chrome-extension:\/\/|view-source:https?:\/\/)/i.test(u)

/** Whether tab `id` still shows a web page (else it went elsewhere: its page ends; gone, it closed or is in another
 *  workspace's tabs). */
const stillWeb = (id: string) => {
  const t = panesOf(getTabLayout().root).flatMap((g) => g.tabs).find((x) => x.id === id)
  return !t || t.to === "view:web" || t.to.startsWith("view:web/")
}

function Page({ web, arg: tabArg, focused, setArg: setTabArg }: Props & { web: WebPages }) {
  const { group, tab = "" } = usePane()
  // (a tab's container never changes under its page: index.tsx draws a page afresh for another)
  const { container, url: arg } = splitArg(tabArg)
  const setArg = (url: string) => setTabArg(argOf(url, container))
  const box = useRef<HTMLDivElement>(null)
  const address = useRef<HTMLInputElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const [id, setId] = useState(0)
  const [state, setState] = useState<WebPageState>({ url: arg, title: "", back: false, forward: false, loading: http(arg) })
  const [saving, setSaving] = useState(false)
  useEnabled() // (other plugins' buttons, as they're switched)
  // What the effects below read without starting again.
  /** A passkey it asked for: drawn in its place till the phone answers. */
  const passkey = passkeyAsks.use((m) => (id ? m.get(id) : undefined))
  const live = useRef({ arg, state, setArg, setTabArg, error: false, passkey: false })
  useEffect(() => { live.current = { arg, state, setArg, setTabArg, error: !!state.error || !!state.crashed, passkey: !!passkey } })
  // In its player (a window of its own): the tab says so, and nothing here places the page.
  const away = !!state.player
  // Its find bar (FindBar.tsx), open per tab as in Chrome: `ask` bumped by ⌘F, ⌘G and ⇧⌘G (0: shown again, not asked).
  const [ask, setAsk] = useState<{ n: number; how: FindAsk } | null>(() => (findOpen(tab) ? { n: 0, how: "open" } : null))
  const [found, setFound] = useState<Found | null>(null)
  const askFind = (how: FindAsk) => { setFindOpen(tab, true); setAsk((a) => ({ n: (a?.n ?? 0) + 1, how })) }

  // A container that needs Touch ID: whether it's locked now (null: not known yet), asked again as containers lock.
  const [locked, setLocked] = useState<boolean | null>(container ? null : false)
  useEffect(() => {
    if (!container) return
    let gone = false
    const ask = () => void Promise.resolve(web.engine?.("lock:open", profileIn(container)))
      .then((open) => { if (!gone) setLocked(open === false) }, () => { if (!gone) setLocked(false) })
    void settingsRead().then(ask)
    const off = web.on((m) => { if (m.type === "engine:lock:locked") ask() })
    return () => { gone = true; off() }
  }, [container, web])

  // The page: the tab's own (shown again) or a new one; let go of as the tab hides (or its container locks), ended when
  // the tab shows something else (closing it ends it too: onTabClose). A new web tab has none till an address is typed.
  const blank = !ownPage(arg)
  // (hidden, it slides over the page: never the pane's title row; a new tab keeps it out, its address is what's used)
  const { hidden: barHid, out: barOut } = usePageBar(web, id, bar, blank)
  usePaneTopBar(bar, !barHid)
  /** The address the tab had when it got its page: one that went on in the background (an agent's) isn't sent back. */
  const taken = useRef("")
  /** Shown again by `open`, it had the keyboard when it was hidden. */
  const shownFocused = useRef(false)
  useEffect(() => {
    if (locked !== false || blank) return
    let gone = false, mine = 0
    // (once the window paints behind it again: hidden before, it leaves a see-through hole for a frame)
    const leave = (id: number) => void painted().then(() => { void web.release(id); if (tab && !stillWeb(tab)) void web.close(tab) })
    settingsRead().then(() => {
      // Opened in none: a site that always opens in a container, or a workspace with one of its own, takes its tab
      // there (drawn afresh, index.tsx), unless the user put it in none.
      const into = container || keptOutside(arg) ? null : destination(arg, { from: null, fresh: true }).container
      if (into) { live.current.setTabArg(argOf(arg, into)); return Promise.reject(null) }
      // (where its box is now: shown at once, not after this tab draws again; not under something of the app's)
      const el = box.current, r = el && !popupOpen() ? pageArea(el.getBoundingClientRect()) : null
      return web.open(arg, r && r.width >= 2 && r.height >= 2 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null, profileIn(container), tab)
    }).then((r) => {
      if (gone) { leave(r.id); return }
      mine = r.id
      shownFocused.current = !!r.focused
      forgetUnheard(r.id) // (what it said before is in `r.state`; what it says from now till its tab listens is kept)
      taken.current = live.current.arg
      setId(r.id)
      setState(r.state)
    }, (e) => { if (e !== null) notifyError(e, "Couldn't open the page") })
    return () => { gone = true; if (mine) leave(mine); setId(0) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, blank])

  // (made blank, Back to safety with nowhere to go back to: what its page said goes with it)
  useEffect(() => { if (blank) setState({ url: "", title: "", back: false, forward: false, loading: false }) }, [blank])

  // The tab's address follows the page; one given to the tab (not from the page) is loaded.
  useEffect(() => {
    if (!id) return
    const back = arg === taken.current
    taken.current = ""
    if (back || arg === live.current.state.url || !ownPage(arg)) return
    void web.go(id, "load", arg)
  }, [id, arg, web])
  useEffect(() => {
    if (ownPage(state.url) && state.url !== live.current.arg) live.current.setArg(state.url)
    if (ownPage(state.url)) setTitle(state.url, state.title)
  }, [state.url, state.title])
  // (another page: what was found was found there)
  useEffect(() => setFound(null), [state.url])

  const clip = async () => {
    if (!id || saving) return
    setSaving(true)
    try {
      const page = await web.html(id)
      const r = await post<{ path: string; title: string; existing?: boolean }>("clip", { url: page.url, html: page.html })
      if (!r.existing) notify(`Saved "${r.title}"`, { action: { label: "Open", run: () => openInSplit(`file:${r.path}`) } })
      else {
        // Saved before: its note, and the page as it is now only if asked.
        openInSplit(`file:${r.path}`)
        notify(`Already saved: ${r.title}`, { action: { label: "Update", run: async () => {
          await post("clip", { url: page.url, html: page.html, update: true })
          notify(`Updated "${r.title}"`)
        } } })
      }
    } catch (e) {
      notifyError(e, "Couldn't save the page")
    } finally {
      setSaving(false)
    }
  }
  const clipRef = useRef(clip)
  useEffect(() => { clipRef.current = clip })

  // What the desktop app says about this page (index.tsx's Background hands the events over).
  useEffect(() => {
    if (!id) return
    shown.set(id, {
      group, tab, container, url: () => live.current.state.url, state: () => live.current.state, onState: setState, clip: () => void clipRef.current(),
      find: askFind, found: (active, matches) => { if (findOpen(tab)) setFound({ active, matches }) },
      focusAddress: () => { address.current?.focus(); address.current?.select() }, inPlayer: () => !!live.current.state.player,
    })
    const missed = takeUnheard(id)
    if (missed) setState(missed)
    return () => { shown.delete(id) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, group, container, web])
  // (a new web tab's keyboard is its address's)
  useEffect(() => { if (blank && focused && !typingIn(document.activeElement)) address.current?.focus() }, [blank, focused])
  useEffect(() => {
    if (!id) return
    setFocusedPage(id, focused)
    // The pane was focused (its tab clicked, a pane switch): the keyboard goes to the page, unless it's typing elsewhere
    // or the page has it (the pane followed it: handing it back after it moved on, two pages would trade it forever).
    if (focused && !hasKeyboard(id) && !typingIn(document.activeElement)) void web.go(id, "focus")
    return () => setFocusedPage(id, false)
  }, [id, focused, web])

  // Keep the page over the box; the window goes over it while anything of the app covers it. What covers it is looked at
  // again only when something that may change it did (`matters`, `moved`): the hit tests are costly, the floats aren't.
  const kick = useRef<() => void>(undefined)
  useEffect(() => {
    const el = box.current
    if (!id || !el || away) return
    let raf = 0, covered = false, gone = false, busy = false, again = false, hits: Cover = null
    /** Where the page is now (null: hidden). */
    let at: DOMRect | null = null
    /** What to look at again (null: only where it is). */
    let dirty: Change = "hits"
    // The window is see-through only where the page is, in every frame (App windows make it transparent): the hole
    // shrinks and is painted before the page moves or hides, and grows only once the page is there.
    const move = async (to: DOMRect | null) => {
      const both = at && to ? overlap(at, to) : null
      if (!sameRect(both, at)) { setHole(id, el, both); await painted() }
      if (gone) return undefined
      const placed = await web.place(id, to && { x: to.left, y: to.top, width: to.width, height: to.height }).catch(() => undefined)
      at = placed?.shown === false ? null : to
      setOnScreen(id, !!at)
      if (!gone) setHole(id, el, at)
      return placed
    }
    const step = async () => {
      const r = pageArea(el.getBoundingClientRect())
      const show = !live.current.error && !live.current.passkey && r.width >= 2 && r.height >= 2
      // (where it was, and nothing changed since: nor did what covers it)
      if (!dirty && show && at && sameRect(at, r)) return
      if (dirty === "hits" || !sameRect(at, r)) hits = show ? hitCover(el, r) : null
      dirty = null
      const cover = show ? hits ?? floatCover(r) : null
      setCover(id, cover)
      // In the focused pane with the keyboard nowhere in particular: the page has it (back from under a menu, or shown again
      // with it, or it had it when it was hidden and nothing else took it meanwhile).
      const free = !document.activeElement || document.activeElement === document.body
      const mine = el.closest("[data-pane]")?.id === "main-scroll"
      if (covered && cover !== "app" && free && mine) void web.go(id, "focus")
      covered = cover === "app"
      if (!show) { if (at) await move(null); return }
      if (sameRect(at, r)) return
      const wasHidden = !at
      const placed = await move(r)
      if (wasHidden && free && (placed?.focused || shownFocused.current || mine)) void web.go(id, "focus")
      shownFocused.current = false
    }
    // One step at a time: a move waits for the paint before it.
    const sync = async () => {
      raf = 0
      if (gone) return
      if (busy) { again = true; return }
      busy = true
      try { await step() } finally { busy = false; if (again) { again = false; schedule() } }
    }
    // (A window that's hidden or covered gets no animation frames: a timer then, so the page is in place when it shows.)
    const schedule = () => {
      if (raf || gone) return
      raf = document.hidden ? window.setTimeout(() => void sync(), 50) : requestAnimationFrame(() => void sync())
    }
    const touch = (c: Change = "hits") => {
      if (!c || dirty === "hits") return
      dirty = c
      schedule()
    }
    kick.current = touch
    const ro = new ResizeObserver(() => touch())
    ro.observe(el)
    const mo = new MutationObserver((rs) => { for (const m of rs) { if (dirty === "hits") return; touch(matters(m, el)) } })
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "class", "style", "hidden", "data-dragging", "data-state", "data-visible", "data-removed"] })
    // (something sliding over it is looked at as it starts, where it goes, and where it stops)
    const slid = (e: Event) => { if (dirty !== "hits") touch(moved(e, el)) }
    const all = () => touch()
    for (const ev of SLIDES) document.addEventListener(ev, slid, true)
    addEventListener("resize", all)
    document.addEventListener("visibilitychange", all)
    // (and now and then where it is, for a move nothing above announces)
    const tick = setInterval(schedule, 500)
    const unpass = passPointer(el, () => id, () => pageArea(el.getBoundingClientRect()))
    schedule()
    return () => {
      gone = true
      kick.current = undefined
      cancelAnimationFrame(raf)
      clearTimeout(raf)
      ro.disconnect()
      mo.disconnect()
      for (const ev of SLIDES) document.removeEventListener(ev, slid, true)
      removeEventListener("resize", all)
      document.removeEventListener("visibilitychange", all)
      clearInterval(tick)
      unpass()
      setCover(id, null)
      setHole(id, el, null)
      setOnScreen(id, false)
    }
  }, [id, web, away])
  // (an error's note in the box: the page goes, and comes back with a retry)
  useEffect(() => kick.current?.(), [state.error, state.crashed, !!passkey])
  // (no error page while it's tried again over http, below)
  const [retried, setRetried] = useState(false)
  // An address typed with no scheme went to https: one that can't connect there is tried over http, as browsers do.
  useEffect(() => {
    if (!id || !state.error) return
    const to = fallbackFor(state.url, state.error) ?? fallbackFor(arg, state.error)
    if (to) { setRetried(true); void web.go(id, "load", to) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, state.error])
  useEffect(() => { if (!state.error) setRetried(false) }, [state.error])
  const falling = !!state.error && (retried || fallsBack(state.url, state.error) || fallsBack(arg, state.error))

  // What's typed in the address, kept till Esc, Enter or the page going elsewhere (while it's typed, it rebases).
  const [draft, setDraft] = useDraft(tab)
  const noHash = (u: string) => u.replace(/#.*$/, "")
  useEffect(() => {
    if (!draft || noHash(draft.on) === noHash(state.url)) return
    setDraft(document.activeElement === address.current ? { ...draft, on: state.url } : null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.url])
  /** The address Enter would open now (the bar's first or chosen suggestion). */
  const [target, setTarget] = useState<string | null>(null)
  // Where it opens, live on the chip while it's typed (and on a new tab): one answer for Enter, ⌥Enter and ⌘Enter.
  const drafting = blank || !!draft
  const where = (to: string) => destination(to, { from: container, fresh: blank, chosen: draft?.chosen })
  const into = drafting ? where(target ?? (blank ? "" : state.url || arg)) : { container, why: "" }
  const choose = (chosen: string | null) => setDraft({ text: draft?.text ?? null, chosen, on: draft?.on ?? state.url })
  const pickContainer = (id: string | null) => {
    if (drafting) return choose(id)
    const url = state.url || arg
    if (id === null) keepOutside(url)
    setTabArg(argOf(url, id))
  }
  const turn = (by: 1 | -1) => {
    const ids = [null, ...containers().map((c) => c.id)], i = ids.indexOf(into.container)
    choose(ids[(i + by + ids.length) % ids.length])
  }

  const inside = containerById(container)
  const ext = useExtensionBar(id, state.url)

  const go: Go = (to, how, place, guessed) => {
    markTyped(to, how)
    if (guessed) guessedFor(to)
    const { container: c } = where(to)
    setDraft(null)
    // (a new page in none stays there: the chip said so, whatever the workspace's container)
    if (c === null && (place !== "here" || !id || container !== null)) keepOutside(to)
    if (place !== "here") return openWebTab(to, c, place === "back", tab || undefined)
    // (another container is another page: the tab moves there, its back history with it)
    if (c !== container) return setTabArg(argOf(to, c))
    if (!id) return setArg(to)
    void web.go(id, "load", to)
    void web.go(id, "focus")
  }

  // (behind it, as a link's new tab: a tab of its own even when another shows that address, a copy is what Reload's asked for)
  const inNewTab = (to: unknown) => { if (typeof to === "string" && to) openBehind(to, destination(to, { from: container, fresh: false }).container, tab || undefined) }

  const onWeb = http(state.url)
  const actions = onWeb ? webPageActions({ url: state.url, title: state.title }) : []
  // Back and Forward walk the page's history, then the tab's (Back from a page opened from another tab goes back to it).
  const me = panesOf(getTabLayout().root).flatMap((g) => g.tabs).find((t) => t.id === tab)
  const back = state.back || canNavigate(me, -1), forward = state.forward || canNavigate(me, 1)
  const walk = (dir: -1 | 1) => { if (dir < 0 ? state.back : state.forward) void web.go(id, dir < 0 ? "back" : "forward"); else navigate(dir) }
  /** Back's or Forward's places, nearest first, as a menu under its button. */
  const places = async (el: HTMLElement, dir: -1 | 1) => {
    const h = await web.go(id, "history").catch(() => null) as { at: number; entries: { i: number; url: string; title: string }[] } | null
    if (!h) return
    const list = h.entries.filter((x) => (dir < 0 ? x.i < h.at : x.i > h.at))
    if (dir < 0) list.reverse()
    const r = el.getBoundingClientRect()
    openMenu({ x: r.left, y: r.bottom + 4, flip: r.top - 4 }, [
      ...list.slice(0, 15).map((x): MenuItem => ({ label: x.title || x.url, icon: siteIcon(x.url), run: () => void web.go(id, "go-to", String(x.i)) })),
      { label: "Show full history", icon: History, sep: list.length > 0, run: () => openView("web-history", { newTab: true }) },
    ])
  }
  const barItem = (sep = false): MenuItem => (barHid
    ? { label: "Always show page bar", icon: PanelTopOpen, sep, run: () => void setBarHidden(false) }
    : { label: "Hide page bar", icon: PanelTopClose, sep, run: () => void setBarHidden(true) })
  // (its own buttons and the address have menus of their own)
  const barMenu = (e: React.MouseEvent) => { if (!(e.target as Element).closest("button, input, [role=listbox]")) menuFor(() => [barItem()])(e) }
  return (
    <div className={cn("relative flex h-full min-h-0 flex-col", barHid && "overflow-hidden")} data-web-page={id || ""}>
      {/* (a container: as it narrows, the address gives way first, then labels, pinned extensions and Forward go) */}
      <div ref={bar} onContextMenu={barMenu} data-web-bar data-web-bar-hidden={barHid ? (barOut ? "out" : "in") : undefined}
        className={cn("@container/bar relative flex h-10 shrink-0 items-center gap-0.5 border-b-[0.5px] border-border px-1.5",
          barHid && "absolute inset-x-0 top-0 z-20 bg-background shadow-[0_8px_20px_-12px_rgb(0_0_0/0.45)] [transition:translate_var(--motion)_var(--ease-out)]",
          barHid && !barOut && "-translate-y-full")}>
        <BarButton icon={ArrowLeft} label="Back" disabled={!back} onClick={() => walk(-1)} onNewTab={() => void web.go(id, "back-address").then(inNewTab)}
          onMenu={id && state.back ? (el) => void places(el, -1) : undefined} />
        <BarButton icon={ArrowRight} label="Forward" disabled={!forward} onClick={() => walk(1)} onNewTab={() => void web.go(id, "forward-address").then(inNewTab)}
          onMenu={id && state.forward ? (el) => void places(el, 1) : undefined} className="@max-xs/bar:hidden" />
        <BarButton icon={state.loading ? X : RotateCw} label={state.loading ? "Stop" : "Reload"} disabled={!id} onClick={() => void web.go(id, state.loading ? "stop" : "reload")}
          onNewTab={state.loading ? undefined : () => inNewTab(state.url)} />
        <AddressBar url={state.url} tab={tab} more={() => [barItem()]} blank={blank} draft={draft} setDraft={setDraft} inputRef={address} onGo={go} onTurn={turn} onTarget={setTarget}
          onLeave={() => { if (id) void web.go(id, "focus") }}
          lead={<ContainerButton container={into.container} url={drafting ? target ?? "" : state.url || arg} why={into.why} pick={pickContainer} manage={manageContainers} />}
          trail={id > 0 && onWeb ? <>{state.zoom && <ZoomButton zoom={state.zoom} reset={() => void web.go(id, "zoom-reset")} />}<ShieldsButton id={id} url={state.url} loading={state.loading} /></> : null} />
        {id > 0 && <AgentChip id={id} />}
        {(state.playing || state.muted) && (
          <BarButton icon={state.muted ? VolumeX : Volume2} label={state.muted ? "Unmute tab" : "Mute tab"} onClick={() => void web.go(id, state.muted ? "unmute" : "mute")} />
        )}
        <ExtensionButtons bar={ext} className="@max-md/bar:hidden" />
        <SaveButton disabled={!id || !onWeb} saving={saving} onSave={() => void clip()} actions={actions.filter((a) => a.kind === "save")} />
        <MoreButton disabled={!onWeb} items={(at) => [
          { label: "Bookmark", icon: Bookmark, hint: commandKeys("web:bookmark") || undefined, run: () => void bookmark(state.url, state.title) },
          ...(id && web.find ? [{ label: "Find in page…", icon: Search, hint: commandKeys("web:find") || undefined, run: () => askFind("open") }] : []),
          ...(id ? [{ label: "Print…", icon: Printer, run: () => void web.go(id, "print") }] : []),
          { label: "View page source", icon: FileCode2, hint: commandKeys("web:source") || undefined, run: () => viewSource(state.url, container, tab) },
          ...(web.engine && id ? [{ label: "Block an element…", icon: MousePointerSquareDashed, run: () => void pickElement(id) }] : []),
          { label: "Open in another browser", icon: ArrowUpRight, run: () => void web.external(state.url) },
          ...(web.player && id ? [away
            ? { label: "Bring back from player", icon: Undo2, sep: true, run: () => setPlayer(id, false) }
            : { label: "Open as player", icon: MonitorPlay, hint: commandKeys("web:player") || undefined, sep: true, run: () => setPlayer(id, true) }] : []),
          ...(id ? [{ label: "Picture in picture", icon: PictureInPicture2, run: () => void pictureInPicture(web, id) }] : []),
          ...withSep(actionItems(actions.filter((a) => a.kind !== "save"))),
          ...withSep(extensionItems(ext, at)),
          barItem(true),
        ]} />
        <Progress loading={id > 0 && state.loading && !state.error} />
      </div>
      {ask && id > 0 && <FindBar web={web} id={id} tab={tab} ask={ask} found={found}
        close={() => { setFindOpen(tab, false); setAsk(null); setFound(null); void web.go(id, "focus") }} />}
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-background" data-web-box>
        {blank && <Start onOpen={(to, newTab) => go(to, "typed", newTab ? "back" : "here")} />}
        {away && <Away onShow={() => setPlayer(id, true)} onBack={() => setPlayer(id, false)} />}
        {passkey && <Passkey ask={passkey} />}
        {blank ? null : state.crashed ? <Crashed url={state.url || arg} onReload={() => void web.go(id, "reload")} />
          : state.error && state.unsafe ? <Unsafe error={state.error} url={state.url || arg} onBack={() => (state.back ? void web.go(id, "back") : setTabArg(argOf("", container)))}
            onGo={() => void web.go(id, "allow-cert")} />
          : state.error && !falling && <Problem error={state.error} url={state.url || arg} onRetry={() => void web.go(id, "reload")} />}
        {locked && inside && <Locked name={inside.name} unlock={() => void Promise.resolve(web.engine?.("lock:unlock", profileIn(container), inside.name))
          .then((ok) => { if (ok === true) setLocked(false) }, (e) => notifyError(e, "Couldn't unlock it"))} />}
      </div>
      {id > 0 && <AskCard id={id} />}
    </div>
  )
}

/** An agent at work in this tab, in its bar: who, what it's doing now, paused; its menu pauses agents here, or moves an
 *  agent's own page back to the background. Never a bar of its own: the page doesn't move as agents come and go. */
function AgentChip({ id }: { id: number }) {
  const page = agentPages.use((l) => l.find((p) => p.id === id))
  const [, tick] = useState(0)
  const busy = !!page && working(page)
  useEffect(() => {
    if (!busy || !page?.at) return
    const t = setTimeout(() => tick((n) => n + 1), WORKING_MS - (Date.now() - page.at) + 50)
    return () => clearTimeout(t)
  }, [busy, page?.at])
  if (!page) return null
  const menu = (e: React.MouseEvent) => menuBelow(e, [
    { label: page.paused ? "Resume agents in this tab" : "Pause agents in this tab", icon: page.paused ? Play : Pause, run: () => void pauseAgents(id, !page.paused) },
    ...(page.own && page.tab ? [{ label: "Move to background", icon: MousePointer2, run: () => void toBackground(page) }] : []),
    { label: "Show agents in the browser", icon: AppWindow, sep: true, run: () => openView("agent-runs", { newTab: true }) },
  ])
  const label = page.paused ? "Paused" : busy ? page.what : page.by
  return (
    <button type="button" onClick={menu} data-web-agent={page.paused ? "paused" : busy ? "working" : "idle"} aria-haspopup="menu"
      data-tip={page.paused ? `Agents are paused in this tab` : `${page.by}${page.task ? `: ${page.task}` : ""}`}
      className="ml-0.5 flex h-7 max-w-52 shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[12px] hover:bg-foreground/[0.06]"
      style={{ background: page.paused ? undefined : "color-mix(in srgb, var(--purple) 10%, transparent)" }}>
      {page.paused ? <Pause className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.25} />
        : <MousePointer2 className={cn("size-3.5 shrink-0", busy && "animate-pulse")} strokeWidth={2.25} style={{ color: "var(--purple)" }} />}
      <span className={cn("min-w-0 truncate @max-xl/bar:hidden", page.paused && "text-muted-foreground")}>{label}</span>
    </button>
  )
}

/** What an agent asked the user to do in this tab (sign in, a check), with Done: a card at the tab's foot, under the page,
 *  never over it (what's asked is on the page). */
function AskCard({ id }: { id: number }) {
  const page = agentPages.use((l) => l.find((p) => p.id === id && !!p.asking))
  if (!page?.asking) return null
  return (
    <div className="@container/ask shrink-0 border-t-[0.5px] border-border px-3 py-2.5" data-web-agent-ask>
      <div className="mx-auto flex max-w-[720px] animate-in items-center gap-3 rounded-[12px] px-3.5 py-3 shadow-md ring-1 duration-300 fade-in slide-in-from-bottom-2"
        style={{ background: "color-mix(in srgb, var(--purple) 9%, var(--card))", ["--tw-ring-color" as string]: "color-mix(in srgb, var(--purple) 40%, transparent)" }}>
        <span className="grid size-9 shrink-0 place-items-center rounded-full @max-sm/ask:hidden" style={{ background: "color-mix(in srgb, var(--purple) 18%, transparent)" }}>
          <MousePointer2 className="size-[18px]" strokeWidth={2.25} style={{ color: "var(--purple)" }} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[12px] font-semibold" style={{ color: "var(--purple)" }}>{page.by} needs you</span>
          <span className="line-clamp-4 text-[15px] leading-[20px] @max-sm/ask:text-[13px] @max-sm/ask:leading-[18px]" data-web-agent-reason>{page.asking}</span>
        </span>
        <Button look="primary" onClick={() => void doneAsk(id)} data-web-agent-done className="px-4">
          <Check className="size-4" strokeWidth={2.5} />Done
        </Button>
      </div>
    </div>
  )
}

/** Its main video in a window over every other (the Mac's picture in picture), or back. */
async function pictureInPicture(web: WebPages, id: number) {
  if ((await web.go(id, "pip").catch(() => null)) === "none") notify("No video on this page")
}

/** The tab of a page in its player. */
function Away({ onShow, onBack }: { onShow: () => void; onBack: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center bg-background px-8 pt-20 text-center" data-web-away>
      <MonitorPlay className="size-8 text-tertiary" strokeWidth={1.5} />
      <p className="mt-4 text-[15px] text-foreground">Playing in its own window</p>
      <p className="mt-1 text-[13px] text-muted-foreground">Esc in it brings it back here.</p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onShow} className="cursor-pointer rounded-[6px] border-[0.5px] border-border px-3 py-1.5 text-[13px] hover:bg-foreground/[0.06]">Show player</button>
        <button type="button" onClick={onBack} className="cursor-pointer rounded-[6px] border-[0.5px] border-border px-3 py-1.5 text-[13px] hover:bg-foreground/[0.06]" data-web-away-back>Bring back</button>
      </div>
    </div>
  )
}

function Locked({ name, unlock }: { name: string; unlock: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center bg-background px-8 pt-20 text-center" data-web-locked>
      <Lock className="size-8 text-tertiary" strokeWidth={1.5} />
      <p className="mt-4 text-[15px] text-foreground">{name} is locked</p>
      <button type="button" onClick={unlock} className="mt-4 cursor-pointer rounded-[6px] border-[0.5px] border-border px-3 py-1.5 text-[13px] hover:bg-foreground/[0.06]">Unlock with Touch ID</button>
    </div>
  )
}

/** Why a page didn't load, in words (Chrome's), by Chromium's error: its heading and what to do. */
function problemOf(error: string, host: string): { icon: LucideIcon; title: string; detail: string } {
  const e = error.replace(/^net::/, "")
  if (/^ERR_INTERNET_DISCONNECTED$/.test(e)) return { icon: WifiOff, title: "You're offline", detail: "It loads again once this Mac is back online." }
  if (/^ERR_NETWORK_CHANGED$/.test(e)) return { icon: WifiOff, title: "Your connection was interrupted", detail: "The network changed while it loaded." }
  if (/^ERR_NAME_(NOT_RESOLVED|RESOLUTION_FAILED)$/.test(e)) return { icon: Globe, title: `Can't find ${host}`, detail: "Check the address for a typo, or that the site still exists." }
  if (/^ERR_CONNECTION_REFUSED$/.test(e)) return { icon: Globe, title: `${host} refused to connect`, detail: "Nothing is answering at that address, or it turned this browser away." }
  if (/^ERR_(CONNECTION_)?TIMED_OUT$/.test(e)) return { icon: Globe, title: `${host} took too long to respond`, detail: "The site may be down or busy, or the network slow." }
  if (/^ERR_TOO_MANY_REDIRECTS$/.test(e)) return { icon: Globe, title: `${host} redirected you too many times`, detail: "Signing out of it, or clearing its cookies in Sites, may fix it." }
  if (/^ERR_CONNECTION_(RESET|CLOSED|ABORTED)$|^ERR_EMPTY_RESPONSE$/.test(e)) return { icon: Globe, title: `${host} closed the connection`, detail: "It may work if you try again." }
  if (/^ERR_ADDRESS_UNREACHABLE$/.test(e)) return { icon: Globe, title: `Can't reach ${host}`, detail: "It's on a network this Mac isn't on." }
  if (/^ERR_(SSL|CERT)_/.test(e)) return { icon: ShieldAlert, title: `${host} can't make a secure connection`, detail: "It sent something this browser can't trust." }
  if (/^ERR_(FILE_NOT_FOUND|INVALID_RESPONSE|INVALID_HTTP_RESPONSE|HTTP_RESPONSE_CODE_FAILURE)$/.test(e)) return { icon: FileWarning, title: `${host} sent nothing to show`, detail: "Its page may be broken." }
  return { icon: Globe, title: `Couldn't open ${host}`, detail: "Something went wrong loading it." }
}
/** Errors from being offline: tried again on their own once the Mac is back online, as Chrome does. */
const OFFLINE = /^(net::)?ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|ADDRESS_UNREACHABLE)$/

const PANEL = "absolute inset-0 flex flex-col items-center overflow-y-auto bg-background px-8 pt-20 pb-10 text-center"
const PANEL_BUTTON = "mt-4 cursor-pointer rounded-[6px] border-[0.5px] border-border px-3 py-1.5 text-[13px] hover:bg-foreground/[0.06]"

function Problem({ error, url, onRetry }: { error: string; url: string; onRetry: () => void }) {
  const p = problemOf(error, hostOf(url)), Icon = p.icon
  const retry = useRef(onRetry)
  useEffect(() => { retry.current = onRetry })
  useEffect(() => {
    if (!OFFLINE.test(error)) return
    const back = () => retry.current()
    addEventListener("online", back)
    return () => removeEventListener("online", back)
  }, [error])
  return (
    <div className={PANEL} data-web-error={error}>
      <Icon className="size-8 text-tertiary" strokeWidth={1.5} />
      <p className="mt-4 max-w-[520px] text-[15px] text-foreground" data-web-error-title>{p.title}</p>
      <p className="mt-1 max-w-[520px] text-[13px] text-muted-foreground">{p.detail}</p>
      <button type="button" onClick={onRetry} className={PANEL_BUTTON} data-web-retry>Try again</button>
      <p className="mt-6 font-mono text-[11px] text-tertiary select-text">{error.replace(/^net::/, "")}</p>
    </div>
  )
}

/** A certificate this Mac doesn't trust, as Chrome warns of it: back to safety, or (Advanced) on to the site anyway, which
 *  trusts that certificate for that site till the app quits. */
function Unsafe({ error, url, onBack, onGo }: { error: string; url: string; onBack: () => void; onGo: () => void }) {
  const [more, setMore] = useState(false)
  const host = hostOf(url)
  return (
    <div className={PANEL} data-web-unsafe>
      <ShieldAlert className="size-8" strokeWidth={1.5} style={{ color: "var(--red)" }} />
      <p className="mt-4 text-[15px] text-foreground">Your connection isn't private</p>
      <p className="mt-1 max-w-[520px] text-[13px] text-muted-foreground">Someone may be trying to steal what you send to {host}, like passwords, messages or card numbers.</p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => setMore(!more)} className={cn(PANEL_BUTTON, "mt-0")} data-web-unsafe-more>{more ? "Hide details" : "Advanced"}</button>
        <Button look="primary" onClick={onBack} data-web-unsafe-back>Back to safety</Button>
      </div>
      {more && (
        <div className="mt-5 max-w-[520px] text-[13px] text-muted-foreground">
          <p>{host}'s certificate isn't one this Mac trusts: the site may be set up wrong, or someone may be standing in for it.</p>
          <button type="button" onClick={onGo} className="mt-2 cursor-pointer text-[13px] underline underline-offset-2 hover:text-foreground" data-web-unsafe-go>
            Continue to {host} (unsafe)
          </button>
        </div>
      )}
      <p className="mt-6 font-mono text-[11px] text-tertiary select-text">{error.replace(/^net::/, "")}</p>
    </div>
  )
}

/** Its page kept crashing (web.ts gave up reloading it): said, with Reload, never a blank tab. */
function Crashed({ url, onReload }: { url: string; onReload: () => void }) {
  return (
    <div className={PANEL} data-web-crashed>
      <FileWarning className="size-8 text-tertiary" strokeWidth={1.5} />
      <p className="mt-4 text-[15px] text-foreground">This page crashed</p>
      <p className="mt-1 max-w-[520px] text-[13px] text-muted-foreground">Something went wrong showing {hostOf(url)}. Reloading it may help.</p>
      <button type="button" onClick={onReload} className={PANEL_BUTTON} data-web-reload>Reload</button>
    </div>
  )
}

/** A thin line under the bar while the page loads, as Safari's and Arc's: it eases most of the way, then fills and fades
 *  as the load ends. It says only that it's loading, not how much is left (Chromium doesn't know). */
function Progress({ loading }: { loading: boolean }) {
  const el = useRef<HTMLDivElement>(null), was = useRef(false)
  useEffect(() => {
    const e = el.current
    if (!e || loading === was.current) return
    was.current = loading
    if (loading) {
      e.getAnimations().forEach((a) => a.cancel())
      e.animate([{ opacity: 1, transform: "scaleX(0.02)" }, { opacity: 1, transform: "scaleX(0.85)" }], { duration: 9000, easing: "cubic-bezier(.08,.7,.25,1)", fill: "forwards" })
    } else {
      const from = getComputedStyle(e).transform
      e.getAnimations().forEach((a) => a.cancel())
      e.animate([{ opacity: 1, transform: from === "none" ? "scaleX(0.85)" : from }, { opacity: 1, transform: "scaleX(1)", offset: 0.4 }, { opacity: 0, transform: "scaleX(1)" }],
        { duration: 450, easing: "ease-out", fill: "forwards" })
    }
  }, [loading])
  return <div ref={el} aria-hidden data-web-progress={loading ? "loading" : ""} className="pointer-events-none absolute inset-x-0 -bottom-[0.5px] h-[2px] origin-left opacity-0"
    style={{ background: "var(--primary)" }} />
}

/** `onNewTab`: a middle-click or ⌘-click, as on a link (Back's page in a new tab, Reload's a copy of this one). `onMenu`:
 *  a right-click or a press held, as Chrome's Back lists its places. */
function BarButton({ icon: Icon, label, onClick, onNewTab, onMenu, disabled, className }: { icon: LucideIcon; label: string; onClick: () => void; onNewTab?: () => void
  onMenu?: (el: HTMLElement) => void; disabled?: boolean; className?: string }): ReactNode {
  const hold = useRef(0), held = useRef(false)
  const unhold = () => { clearTimeout(hold.current); hold.current = 0 }
  return (
    <button type="button" disabled={disabled} aria-label={label} data-tip={label} className={cn(BAR_ICON, className)}
      onClick={(e) => { if (held.current) { held.current = false; return } if (onNewTab && (e.metaKey || e.ctrlKey)) onNewTab(); else onClick() }}
      onAuxClick={(e) => { if (e.button === 1 && onNewTab) { e.preventDefault(); onNewTab() } }}
      onContextMenu={onMenu && ((e) => { e.preventDefault(); onMenu(e.currentTarget) })}
      onPointerDown={onMenu && ((e) => {
        if (e.button !== 0 || e.pointerType === "touch") return
        const el = e.currentTarget
        held.current = false
        hold.current = window.setTimeout(() => { held.current = true; onMenu(el) }, HOLD_MS)
      })}
      onPointerUp={unhold} onPointerLeave={unhold}>
      <Icon className="size-4" strokeWidth={2} />
    </button>
  )
}
/** How long Back is held for its list. */
const HOLD_MS = 450

/** A site zoomed in or out: how much, a click putting it back to 100%. */
function ZoomButton({ zoom, reset }: { zoom: number; reset: () => void }) {
  return (
    <button type="button" onClick={reset} aria-label={`Zoom ${Math.round(zoom * 100)}%: reset to 100%`} data-tip="Reset zoom" data-web-zoom={Math.round(zoom * 100)}
      className="flex h-6 shrink-0 cursor-pointer items-center rounded-[5px] px-1.5 text-[12px] tabular-nums text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground">
      {Math.round(zoom * 100)}%
    </button>
  )
}

const BAR_ICON = "grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"

/** Plugins' actions as menu rows. */
const actionItems = (actions: WebPageAction[]): MenuItem[] => actions.map((a) => ({ label: a.label, icon: a.icon, run: a.run }))
/** A group of rows after others: a line above its first. */
const withSep = (items: MenuItem[]) => items.map((it, i) => (i === 0 ? { ...it, sep: true } : it))

/** Save: a click saves the page to the vault (a note in Clippings); plugins' ways to save (Save video) are in its menu,
 *  the chevron beside it or a right-click. */
function SaveButton({ disabled, saving, onSave, actions }: { disabled: boolean; saving: boolean; onSave: () => void; actions: WebPageAction[] }) {
  const more = actions.length > 0
  const menu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (disabled || !more) return
    menuBelow(e, [{ label: "Save page to vault", icon: Scissors, hint: commandKeys("web:clip") || undefined, run: onSave }, ...withSep(actionItems(actions))])
  }
  const part = "flex h-7 shrink-0 cursor-pointer items-center text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
  return (
    <div className="ml-0.5 flex shrink-0 items-center" data-web-save onContextMenu={menu}>
      <button type="button" onClick={onSave} disabled={disabled || saving} aria-label="Save page to vault" data-tip="Save page to vault: a note in Clippings" data-web-clip
        className={cn(part, "gap-1.5 px-2 text-[13px] @max-lg/bar:px-1.5", more ? "rounded-l-[6px]" : "rounded-[6px]")}>
        <Scissors className="size-4" strokeWidth={2} />
        <span className="@max-lg/bar:hidden">{saving ? "Saving…" : "Save"}</span>
      </button>
      {more && (
        <button type="button" onClick={menu} disabled={disabled} aria-label="Ways to save" aria-haspopup="menu" data-tip="Ways to save" data-web-save-menu
          className={cn(part, "w-5 justify-center rounded-r-[6px]")}>
          <ChevronDown className="size-3.5" strokeWidth={2.25} />
        </button>
      )}
    </div>
  )
}

/** The bar's … menu: what's done with the page less often (`items` asked as it opens, for the button it opens under). */
function MoreButton({ disabled, items }: { disabled: boolean; items: (at: HTMLElement) => MenuItem[] }) {
  return (
    <button type="button" disabled={disabled} aria-label="More for this page" aria-haspopup="menu" data-tip="More" data-web-more className={BAR_ICON}
      onClick={(e) => menuBelow(e, items(e.currentTarget))}>
      <Ellipsis className="size-4" strokeWidth={2} />
    </button>
  )
}
