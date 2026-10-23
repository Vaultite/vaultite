// A web page in a tab: a slim bar over the desktop app's native page. While anything of the app covers the box, the
// window goes over its pages and shows the live page through a hole (layers.ts).
import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, Bot, Check, ChevronDown, Ellipsis, Globe, Lock, MonitorPlay, MousePointerSquareDashed, Pause, PictureInPicture2, Play, RotateCw, Scissors, Undo2, Volume2,
  VolumeX, X, type LucideIcon } from "lucide-react"
import {
  cn, commandKeys, getTabLayout, menuBelow, notify, notifyError, openInSplit, openView, panesOf, post, typingIn, useEnabled, usePane, usePaneTopBar, webPageActions, webPages, type MenuItem,
  type WebPageAction, type WebPageState, type WebPages,
} from "@vaultite"
import { hostOf } from "./address"
import { floatCover, hitCover, matters, moved, overlap, painted, passPointer, popupOpen, sameRect, setCover, setHole, type Change, type Cover } from "./layers"
import { ExtensionButtons, extensionItems, useExtensionBar } from "./Extensions"
import { AddressBar, type Go } from "./AddressBar"
import { ContainerButton } from "./ContainerButton"
import { manageContainers } from "./Sites"
import { argOf, containerById, profileIn, ruleFor, splitArg } from "./containers"
import { markTyped } from "./history"
import { pickElement, ShieldsButton } from "./shields"
import { Start } from "./Start"
import { Passkey } from "./Passkey"
import { agentNews, bookmark, hasKeyboard, helpAsks, passkeyAsks, pausedPages, setFocusedPage, setPlayer, settingsRead, setTitle, shown } from "./state"

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

/** Where in the box the page goes: above the status bar where that's drawn over the pane's foot (laid over it, the page
 *  would hide the bar, and the bar over the page would raise the window over it the whole time). */
function pageArea(r: DOMRect) {
  const bar = document.querySelector("[data-status-bar]")?.getBoundingClientRect()
  if (!bar?.height || bar.left >= r.right || bar.right <= r.left || bar.top >= r.bottom || bar.bottom <= r.top) return r
  return new DOMRect(r.left, r.top, r.width, Math.max(0, bar.top - r.top))
}

const http = (u: string) => /^https?:\/\//i.test(u)
/** What a tab may follow and name: the web, and an extension's own pages (its options). */
const ownPage = (u: string) => http(u) || /^chrome-extension:\/\//i.test(u)

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
  usePaneTopBar(bar)
  const [id, setId] = useState(0)
  const [state, setState] = useState<WebPageState>({ url: arg, title: "", back: false, forward: false, loading: http(arg) })
  const [saving, setSaving] = useState(false)
  useEnabled() // (other plugins' buttons, as they're switched)
  // What the effects below read without starting again.
  /** A passkey it asked for: drawn in its place till the phone answers. */
  const passkey = passkeyAsks.use((m) => (id ? m.get(id) : undefined))
  const live = useRef({ arg, state, setArg, setTabArg, error: false, passkey: false })
  useEffect(() => { live.current = { arg, state, setArg, setTabArg, error: !!state.error, passkey: !!passkey } })
  // In its player (a window of its own): the tab says so, and nothing here places the page.
  const away = !!state.player

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
      // A site that always opens in a container, opened in none: its tab goes there (drawn afresh, index.tsx).
      const rule = container ? null : ruleFor(arg)
      if (rule && containerById(rule)) { live.current.setTabArg(argOf(arg, rule)); return Promise.reject(null) }
      // (where its box is now: shown at once, not after this tab draws again; not under something of the app's)
      const el = box.current, r = el && !popupOpen() ? pageArea(el.getBoundingClientRect()) : null
      return web.open(arg, r && r.width >= 2 && r.height >= 2 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null, profileIn(container), tab)
    }).then((r) => {
      if (gone) { leave(r.id); return }
      mine = r.id
      shownFocused.current = !!r.focused
      taken.current = live.current.arg
      setId(r.id)
      setState(r.state)
    }, (e) => { if (e !== null) notifyError(e, "Couldn't open the page") })
    return () => { gone = true; if (mine) leave(mine); setId(0) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, blank])

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
      group, container, url: () => live.current.state.url, onState: setState, clip: () => void clipRef.current(),
      focusAddress: () => { address.current?.focus(); address.current?.select() }, inPlayer: () => !!live.current.state.player,
    })
    return () => { shown.delete(id) }
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
    // (something sliding over it is looked at where it stops)
    const ended = (e: Event) => { if (dirty !== "hits") touch(moved(e, el)) }
    const all = () => touch()
    for (const ev of ["transitionend", "animationend"]) document.addEventListener(ev, ended, true)
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
      for (const ev of ["transitionend", "animationend"]) document.removeEventListener(ev, ended, true)
      removeEventListener("resize", all)
      document.removeEventListener("visibilitychange", all)
      clearInterval(tick)
      unpass()
      setCover(id, null)
      setHole(id, el, null)
    }
  }, [id, web, away])
  // (an error's note in the box: the page goes, and comes back with a retry)
  useEffect(() => kick.current?.(), [state.error, !!passkey])

  const inside = containerById(container)
  const ext = useExtensionBar(id, state.url)

  const go: Go = (to, how, newTab) => {
    markTyped(to, how)
    if (newTab) { openView(`web/${argOf(to, container)}`, { newTab: true }); return }
    // (a site that always opens in another container: the tab moves there)
    const rule = ruleFor(to)
    if (rule && rule !== container && containerById(rule)) { setTabArg(argOf(to, rule)); return }
    if (!id) { setArg(to); return }
    void web.go(id, "load", to)
    void web.go(id, "focus")
  }

  // (a tab of its own even when another shows that address: a copy is what Reload's asked for)
  const inNewTab = (to: unknown) => { if (typeof to === "string" && to) openView(`web/${argOf(to, container)}`, { another: true }) }

  const onWeb = http(state.url)
  const actions = onWeb ? webPageActions({ url: state.url, title: state.title }) : []
  return (
    <div className="flex h-full min-h-0 flex-col" data-web-page={id || ""}>
      {/* (a container: as it narrows, the address gives way first, then labels, pinned extensions and Forward go) */}
      <div ref={bar} className="@container/bar flex h-10 shrink-0 items-center gap-0.5 border-b-[0.5px] border-border px-1.5" data-web-bar>
        <BarButton icon={ArrowLeft} label="Back" disabled={!state.back} onClick={() => void web.go(id, "back")} onNewTab={() => void web.go(id, "back-address").then(inNewTab)} />
        <BarButton icon={ArrowRight} label="Forward" disabled={!state.forward} onClick={() => void web.go(id, "forward")} onNewTab={() => void web.go(id, "forward-address").then(inNewTab)} className="@max-xs/bar:hidden" />
        <BarButton icon={state.loading ? X : RotateCw} label={state.loading ? "Stop" : "Reload"} disabled={!id} onClick={() => void web.go(id, state.loading ? "stop" : "reload")}
          onNewTab={state.loading ? undefined : () => inNewTab(state.url)} />
        <AddressBar url={state.url} current={tabArg} inputRef={address} onGo={go} onLeave={() => { if (id) void web.go(id, "focus") }}
          lead={<ContainerButton container={container} url={state.url || arg} reopen={(to) => setTabArg(to)} manage={manageContainers} />}
          trail={id > 0 && onWeb ? <ShieldsButton id={id} url={state.url} loading={state.loading} /> : null} />
        {(state.playing || state.muted) && (
          <BarButton icon={state.muted ? VolumeX : Volume2} label={state.muted ? "Unmute tab" : "Mute tab"} onClick={() => void web.go(id, state.muted ? "unmute" : "mute")} />
        )}
        <ExtensionButtons bar={ext} className="@max-md/bar:hidden" />
        <SaveButton disabled={!id || !onWeb} saving={saving} onSave={() => void clip()} actions={actions.filter((a) => a.kind === "save")} />
        <MoreButton disabled={!onWeb} items={(at) => [
          { label: "Bookmark", icon: Bookmark, hint: commandKeys("web:bookmark") || undefined, run: () => void bookmark(state.url, state.title) },
          ...(web.engine && id ? [{ label: "Block an element…", icon: MousePointerSquareDashed, run: () => void pickElement(id) }] : []),
          { label: "Open in another browser", icon: ArrowUpRight, run: () => void web.external(state.url) },
          ...(web.player && id ? [away
            ? { label: "Bring back from player", icon: Undo2, sep: true, run: () => setPlayer(id, false) }
            : { label: "Open as player", icon: MonitorPlay, hint: commandKeys("web:player") || undefined, sep: true, run: () => setPlayer(id, true) }] : []),
          ...(id ? [{ label: "Picture in picture", icon: PictureInPicture2, run: () => void pictureInPicture(web, id) }] : []),
          ...withSep(actionItems(actions.filter((a) => a.kind !== "save"))),
          ...withSep(extensionItems(ext, at)),
        ]} />
      </div>
      {id > 0 && <AgentBar web={web} id={id} />}
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-background" data-web-box>
        {blank && <Start onOpen={(to, newTab) => go(to, "typed", newTab)} />}
        {away && <Away onShow={() => setPlayer(id, true)} onBack={() => setPlayer(id, false)} />}
        {passkey && <Passkey ask={passkey} />}
        {state.error && <Problem error={state.error} url={state.url || arg} onRetry={() => void web.go(id, "reload")} />}
        {locked && inside && <Locked name={inside.name} unlock={() => void Promise.resolve(web.engine?.("lock:unlock", profileIn(container), inside.name))
          .then((ok) => { if (ok === true) setLocked(false) }, (e) => notifyError(e, "Couldn't unlock it"))} />}
      </div>
    </div>
  )
}

/** How long an agent's last step shows in the bar. */
const NEWS_MS = 6000

/** An agent at work in this tab: who and what it's doing, with Pause (its next steps are refused till Resume); or
 *  what it asked the user to do here, with Done. */
function AgentBar({ web, id }: { web: WebPages; id: number }) {
  const news = agentNews.use((m) => m.get(id))
  const paused = pausedPages.use((s) => s.has(id))
  const ask = helpAsks.use((m) => m.get(id))
  const [, tick] = useState(0)
  const fresh = !!news && Date.now() - news.at < NEWS_MS
  useEffect(() => {
    if (!fresh || !news) return
    const t = setTimeout(() => tick((n) => n + 1), NEWS_MS - (Date.now() - news.at) + 50)
    return () => clearTimeout(t)
  }, [fresh, news])
  if (ask) {
    const done = () => void Promise.resolve(web.engine?.("agents:helped", id)).catch((e) => notifyError(e, "Couldn't tell the agent"))
    return (
      <div className="flex h-8 shrink-0 items-center gap-2 border-b-[0.5px] border-border px-3 text-[13px]" data-web-agent-ask
        style={{ background: "color-mix(in srgb, var(--purple) 14%, transparent)" }}>
        <Bot className="size-4 shrink-0" strokeWidth={2} style={{ color: "var(--purple)" }} />
        <span className="min-w-0 flex-1 truncate"><span className="font-medium">{ask.by} needs you:</span> {ask.reason}</span>
        <button type="button" onClick={done} data-web-agent-done
          className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium hover:bg-foreground/[0.06]">
          <Check className="size-3.5" strokeWidth={2.25} />
          Done
        </button>
      </div>
    )
  }
  if (!fresh && !paused) return null
  const pause = (on: boolean) => void Promise.resolve(web.engine?.("agents:pause", id, on)).catch((e) => notifyError(e, "Couldn't pause it"))
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b-[0.5px] border-border px-3 text-[13px]" data-web-agent
      style={{ background: "color-mix(in srgb, var(--purple) 9%, transparent)" }}>
      <Bot className="size-4 shrink-0" strokeWidth={2} style={{ color: "var(--purple)" }} />
      <span className="min-w-0 flex-1 truncate">
        {paused ? "Agents are paused in this tab" : <><span className="font-medium">{news!.by}</span> <span className="text-muted-foreground">{news!.what}</span></>}
      </span>
      <button type="button" onClick={() => pause(!paused)} data-web-agent-pause={paused ? "resume" : "pause"}
        className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium hover:bg-foreground/[0.06]">
        {paused ? <Play className="size-3.5" strokeWidth={2.25} /> : <Pause className="size-3.5" strokeWidth={2.25} />}
        {paused ? "Resume" : "Pause"}
      </button>
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

function Problem({ error, url, onRetry }: { error: string; url: string; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center bg-background px-8 pt-20 text-center" data-web-error>
      <Globe className="size-8 text-tertiary" strokeWidth={1.5} />
      <p className="mt-4 text-[15px] text-foreground">Couldn't open {hostOf(url)}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{error}</p>
      <button type="button" onClick={onRetry} className="mt-4 cursor-pointer rounded-[6px] border-[0.5px] border-border px-3 py-1.5 text-[13px] hover:bg-foreground/[0.06]">Try again</button>
    </div>
  )
}

/** `onNewTab`: a middle-click or ⌘-click, as on a link (Back's page in a new tab, Reload's a copy of this one). */
function BarButton({ icon: Icon, label, onClick, onNewTab, disabled, className }: { icon: LucideIcon; label: string; onClick: () => void; onNewTab?: () => void; disabled?: boolean; className?: string }): ReactNode {
  return (
    <button type="button" onClick={(e) => { if (onNewTab && (e.metaKey || e.ctrlKey)) onNewTab(); else onClick() }} disabled={disabled} aria-label={label} data-tip={label}
      onAuxClick={(e) => { if (e.button === 1 && onNewTab) { e.preventDefault(); onNewTab() } }} className={cn(BAR_ICON, className)}>
      <Icon className="size-4" strokeWidth={2} />
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
