import { useEffect, useRef, useState, type ReactNode } from "react"
import { AppWindow, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, Ellipsis, FileCode2, FileWarning, Globe, History, Lock, MonitorPlay, MousePointer2, MousePointerSquareDashed, Pause, PictureInPicture2, Play, Printer, RotateCw, Scissors,
  Search, ShieldAlert, Star, Undo2, Volume2, VolumeX, WifiOff, X, type LucideIcon } from "lucide-react"
import {
  Button, canNavigate, cn, commandKeys, getTabLayout, ink, menuBelow, menuFor, navigate, notify, notifyError, onPaneMotion, openInSplit, openMenu, openView, allPanes, PaneControls, post, trace, typingIn, useEnabled, usePane, usePaneTopBar, useStore, useZoomTarget, webPageActions, webPages,
  type MenuItem, type WebPageAction, type WebPageState, type WebPages,
} from "@vaultite"
import { hostOf } from "./address"
import { floatCover, hitCover, matters, moved, painted, passPointer, popupOpen, setCover, setHole, SLIDES } from "./layers"
import { placementStart, placeStep, type Look, type PlaceEffect, type PlaceEvent, type Seen, worthTracing } from "./placement"
import type { Box, Change } from "./box"
import { ExtensionButtons, extensionItems, useExtensionBar } from "./Extensions"
import { AddressBar, type Go } from "./AddressBar"
import { ContainerButton } from "./ContainerButton"
import { DownloadsButton } from "./downloads"
import { signInReached, watchTab } from "./linklogins"
import { movedFrom } from "./where.ts"
import { manageContainers } from "./Sites"
import { argOf, containerById, containers, destination, keepOutside, keptOutside, openBehind, profileIn, splitArg, viewSource } from "./containers"
import { fallbackFor, fallsBack, guessedFor, openWebTab, useDraft } from "./drafts"
import { markTyped } from "./history"
import { pickElement, ShieldsButton } from "./shields"
import { LoginButton } from "./LoginFill"
import { Start } from "./Start"
import { openBookmark, StarButton, starOf } from "./Star"
import { Passkey } from "./Passkey"
import { forgetUnheard, hasKeyboard, passkeyAsks, setFocusedPage, setOnScreen, setPlayer, settings, settingsRead, setTitle, shown, takeUnheard, type FindAsk } from "./state"
import { FindBar, findOpen, setFindOpen, type Found } from "./FindBar"
import { siteIcon } from "./icons"
import { barItems } from "./pagebar"
import { usePageBar } from "./usebar"
import { BookmarksBar } from "./BookmarksBar"
import { agentPages, doneAsk, pauseAgents, takeOver, toBackground, working, WORKING_MS } from "./agentpages"
import { AgentWatch } from "./AgentWatch"
import { framing } from "./framed"
import FramedPage from "./FramedPage"

type Props = { arg: string; focused: boolean; setArg: (arg: string) => void }

export default function WebPage(props: Props) {
  return webPages ? <Page web={webPages} {...props} /> : framing() ? <FramedPage {...props} /> : <Elsewhere url={splitArg(props.arg).url} />
}

/** Most sites refuse to be shown inside another page (X-Frame-Options), so they open outside. */
function Elsewhere({ url }: { url: string }) {
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center px-8 pt-20 text-center" data-web-elsewhere>
      <Globe className="size-8 text-tertiary" strokeWidth={1.5} />
      <p className="mt-4 text-[15px] leading-[21px] text-muted-foreground">Web pages open in a tab in Vaultite's desktop app. Here they open in your browser.</p>
      <a href={url} target="_blank" rel="noreferrer" className="mt-3 max-w-full truncate text-[15px] text-primary hover:underline">Open {hostOf(url)}</a>
    </div>
  )
}

function pageArea(r: DOMRect) {
  const over = [...document.querySelectorAll("[data-status-bar]")].map((el) => el.getBoundingClientRect())
    .filter((bar) => bar.height && bar.left < r.right && bar.right > r.left && bar.top < r.bottom && bar.bottom > r.top)
  if (!over.length) return r
  return new DOMRect(r.left, r.top, r.width, Math.max(0, Math.min(...over.map((bar) => bar.top)) - r.top))
}

/** Electron rounds all four corners alike. */
function corners(box: HTMLElement, r: DOMRect) {
  const card = box.closest<HTMLElement>("[data-pane-frame]")
  if (!card || card.hasAttribute("data-floating")) return 0
  const radius = parseFloat(getComputedStyle(card).borderBottomLeftRadius) || 0
  const c = card.getBoundingClientRect(), at = (a: number, b: number) => Math.abs(a - b) < 1
  return radius && at(r.left, c.left) && at(r.right, c.right) && at(r.top, c.top) && at(r.bottom, c.bottom) ? radius : 0
}
const spot = (r: Box, radius: number) => ({ x: r.left, y: r.top, width: r.width, height: r.height, radius })

const http = (u: string) => /^https?:\/\//i.test(u)
const ownPage = (u: string) => http(u) || /^(chrome-extension:\/\/|(view-source|blob):https?:\/\/)/i.test(u)

const stillWeb = (id: string) => {
  const t = allPanes(getTabLayout()).find((x) => x.id === id)
  return !t || t.to === "view:web" || t.to.startsWith("view:web/")
}

function Page({ web, arg: tabArg, focused, setArg: setTabArg }: Props & { web: WebPages }) {
  const { pane: tab, hidden: tabHidden } = usePane(), group = tab
  const { container, url: arg } = splitArg(tabArg)
  const setArg = (url: string) => setTabArg(argOf(url, container))
  const box = useRef<HTMLDivElement>(null)
  const address = useRef<HTMLInputElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const [id, setId] = useState(0)
  const [state, setState] = useState<WebPageState>({ url: arg, title: "", back: false, forward: false, loading: http(arg) })
  const [saving, setSaving] = useState(false)
  useEnabled()
  const passkey = passkeyAsks.use((m) => (id ? m.get(id) : undefined))
  const agent = agentPages.use((l) => (id ? l.find((p) => p.id === id) : undefined))
  const held = !!agent?.held
  const live = useRef({ arg, state, setArg, setTabArg, error: false, passkey: false, held: false })
  useEffect(() => { live.current = { arg, state, setArg, setTabArg, error: !!state.error || !!state.crashed, passkey: !!passkey, held } })
  const away = !!state.player
  const [ask, setAsk] = useState<{ n: number; how: FindAsk } | null>(() => (findOpen(tab) ? { n: 0, how: "open" } : null))
  const [found, setFound] = useState<Found | null>(null)
  const askFind = (how: FindAsk) => { setFindOpen(tab, true); setAsk((a) => ({ n: (a?.n ?? 0) + 1, how })) }

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

  const blank = !ownPage(arg)
  const { hidden: barHid, out: barOut } = usePageBar(web, id, tabHidden ? undefined : group, bar, blank)
  usePaneTopBar(bar, !barHid)
  const taken = useRef("")
  const shownFocused = useRef(false)
  useEffect(() => {
    if (locked !== false || blank) return
    let gone = false, mine = 0
    const leave = (id: number) => void painted().then(() => { void web.release(id); if (tab && !stillWeb(tab)) void web.close(tab) })
    settingsRead().then(() => {
      watchTab(arg, tab)
      const into = container || keptOutside(arg) ? null : destination(arg, { from: null, fresh: true }).container
      if (into) { live.current.setTabArg(argOf(arg, into)); return Promise.reject(null) }
      const el = box.current, r = el && !popupOpen() ? pageArea(el.getBoundingClientRect()) : null
      return web.open(arg, el && r && r.width >= 2 && r.height >= 2 ? spot(r, corners(el, r)) : null, profileIn(container), tab)
    }).then((r) => {
      if (gone) { leave(r.id); return }
      mine = r.id
      shownFocused.current = !!r.focused
      forgetUnheard(r.id)
      taken.current = live.current.arg
      setId(r.id)
      setState(r.state)
    }, (e) => { if (e !== null) notifyError(e, "Couldn't open the page") })
    return () => { gone = true; if (mine) leave(mine); setId(0) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, blank])

  const [frame, setFrame] = useState<{ src: string; width: number; height: number } | null>(null)
  useEffect(() => {
    if (locked !== false || blank || !web.frame) return
    let gone = false, src = ""
    void web.frame(tab, arg, profileIn(container)).then(async (f) => {
      if (!f || gone || live.current.state.painted) return
      const img = new Image()
      img.src = src = URL.createObjectURL(new Blob([f.data as BlobPart], { type: "image/jpeg" }))
      await img.decode().catch(() => {})
      if (!gone && !live.current.state.painted) setFrame({ src, width: f.width, height: f.height })
    }, () => {})
    return () => { gone = true; setFrame(null); if (src) URL.revokeObjectURL(src) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, blank])
  const framed = !!frame && !state.painted && !state.error && !state.crashed

  useEffect(() => { if (blank) setState({ url: "", title: "", back: false, forward: false, loading: false }) }, [blank])

  const told = useRef("")
  useEffect(() => {
    if (!id) return
    const back = arg === taken.current
    taken.current = ""
    if (back || arg === told.current || arg === live.current.state.url || !ownPage(arg)) return
    void web.go(id, "load", arg)
  }, [id, arg, web])
  useEffect(() => {
    if (ownPage(state.url) && state.url !== live.current.arg) { told.current = state.url; live.current.setArg(state.url) }
    if (ownPage(state.url)) setTitle(state.url, state.title)
  }, [state.url, state.title])
  useEffect(() => {
    const { signIn, opened } = state
    if (signIn && opened && tab) void signInReached(tab, container, signIn, opened, (url, c) => live.current.setTabArg(argOf(url, c)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.signIn])
  useEffect(() => setFound(null), [state.url])

  const clip = async () => {
    if (!id || saving) return
    setSaving(true)
    try {
      const page = await web.html(id)
      const r = await post<{ path: string; title: string; existing?: boolean; video?: boolean }>("clip", { url: page.url, html: page.html })
      if (!r.existing) notify(`Saved "${r.title}"${r.video ? ": its video follows in a few minutes" : ""}`, { action: { label: "Open", run: () => openInSplit(`file:${r.path}`) } })
      else {
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
  useEffect(() => { if (blank && focused && !typingIn(document.activeElement)) address.current?.focus() }, [blank, focused])
  useEffect(() => {
    if (!id) return
    setFocusedPage(id, focused)
    if (focused && !hasKeyboard(id) && !typingIn(document.activeElement)) void web.go(id, "focus")
    return () => setFocusedPage(id, false)
  }, [id, focused, web])

  const kick = useRef<() => void>(undefined)
  useEffect(() => { kick.current?.() }, [held])
  useEffect(() => {
    const el = box.current
    if (!id || !el || away) return
    let s = placementStart(shownFocused.current), gone = false, raf = 0, motions = 0
    let moving: HTMLElement = el, taken: HTMLImageElement | null = null, picture: HTMLImageElement | null = null
    let holding: Promise<unknown> | undefined
    const look: Look = { hits: (a) => hitCover(el, a), floats: floatCover }
    const see = (): Seen => {
      const area = pageArea(el.getBoundingClientRect()), { error, passkey, held } = live.current, a = document.activeElement
      return { area, radius: corners(el, area), error, passkey, held, keysFree: !a || a === document.body, paneFocused: el.closest("[data-pane]")?.id === "main-scroll" }
    }
    const send = (e: PlaceEvent) => {
      if (gone) return
      const was = s, step = placeStep(s, e, look)
      s = step.to
      if (worthTracing(was, s)) trace("web-page", { id, on: e.type, from: was.phase.kind, to: s.phase.kind, where: s.where.kind })
      for (const fx of step.do) run(fx)
    }
    const unpicture = () => { if (!picture) return; picture.remove(); URL.revokeObjectURL(picture.src); picture = null }
    const shoot = async (motion: number) => {
      const shot = await web.shot!(id).catch(() => null), img = new Image()
      if (shot) { img.src = URL.createObjectURL(new Blob([shot as BlobPart], { type: "image/jpeg" })); await img.decode().catch(() => {}) }
      taken = img
      send({ type: "shot", motion, ok: !!shot })
      if (picture !== img) { URL.revokeObjectURL(img.src); return }
      await new Promise(requestAnimationFrame)
      send({ type: "drawn", motion })
    }
    const run = (fx: PlaceEffect) => {
      switch (fx.do) {
        // A hidden or covered window gets no animation frames.
        case "ask": if (!raf) raf = document.hidden ? window.setTimeout(frame, 50) : requestAnimationFrame(frame); return
        case "cover": return setCover(id, fx.cover)
        case "hole": return setHole(id, el, fx.at, fx.radius)
        case "paint": return void painted().then(() => send({ type: "painted", n: fx.n }))
        case "place": return void web.place(id, fx.to && spot(fx.to, fx.radius)).catch(() => undefined)
          .then((p) => send({ type: "placed", n: fx.n, to: fx.to, radius: fx.radius, shown: p?.shown !== false, focused: !!p?.focused }))
        case "focus": return void web.go(id, "focus")
        case "on-screen": return setOnScreen(id, fx.on)
        case "spent": shownFocused.current = false; return
        case "shoot": holding = shoot(fx.motion); return
        case "picture": {
          const img = taken
          if (!img) return
          img.alt = ""
          img.className = "pointer-events-none absolute top-0 left-0 max-w-none select-none"
          Object.assign(img.style, { width: `${fx.was.width}px`, height: `${fx.was.height}px` })
          el.append(img)
          picture = img
          return
        }
        case "off": {
          const m = new DOMMatrixReadOnly(getComputedStyle(moving).transform), r = el.getBoundingClientRect()
          const to = pageArea(new DOMRect(r.left - m.m41, r.top - m.m42, el.offsetWidth, el.offsetHeight))
          return void web.place(id, { x: -40000, y: 0, width: Math.max(2, to.width), height: Math.max(2, to.height) }).catch(() => undefined)
        }
        case "unpicture": return unpicture()
      }
    }
    const frame = () => { raf = 0; send({ type: "frame", seen: see() }) }
    const touch = (change: Change = "hits") => send({ type: "changed", change })
    kick.current = touch
    const unmotion = onPaneMotion(({ moving: secs, finished }) => {
      const sec = secs.find((m) => m.contains(el))
      if (!sec || !web.shot) return
      const motion = ++motions
      moving = sec
      holding = undefined
      void finished.then(() => send({ type: "stopped", motion, seen: see() }))
      send({ type: "motion", motion })
      return holding
    })
    const ro = new ResizeObserver(() => touch())
    ro.observe(el)
    const mo = new MutationObserver((rs) => { for (const m of rs) { if (s.dirty === "hits") return; touch(matters(m, el)) } })
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "class", "style", "hidden", "data-dragging", "data-state", "data-visible", "data-removed"] })
    const slid = (e: Event) => { if (s.dirty !== "hits") touch(moved(e, el)) }
    const all = () => touch()
    for (const ev of SLIDES) document.addEventListener(ev, slid, true)
    addEventListener("resize", all)
    document.addEventListener("visibilitychange", all)
    const tick = setInterval(() => send({ type: "tick" }), 500)
    const unpass = passPointer(el, () => id, () => pageArea(el.getBoundingClientRect()))
    send({ type: "tick" })
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
      unmotion()
      unpicture()
      setCover(id, null)
      setHole(id, el, null)
      setOnScreen(id, false)
    }
  }, [id, web, away])
  useEffect(() => kick.current?.(), [state.error, state.crashed, !!passkey])
  const [retried, setRetried] = useState(false)
  useEffect(() => {
    if (!id || !state.error) return
    const to = fallbackFor(state.url, state.error) ?? fallbackFor(arg, state.error)
    if (to) { setRetried(true); void web.go(id, "load", to) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, state.error])
  useEffect(() => { if (!state.error) setRetried(false) }, [state.error])
  const falling = !!state.error && (retried || fallsBack(state.url, state.error) || fallsBack(arg, state.error))

  const [draft, setDraft] = useDraft(tab)
  const noHash = (u: string) => u.replace(/#.*$/, "")
  useEffect(() => {
    if (!draft || noHash(draft.on) === noHash(state.url)) return
    setDraft(document.activeElement === address.current ? { ...draft, on: state.url } : null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.url])
  const [target, setTarget] = useState<string | null>(null)
  const drafting = blank || !!draft
  const where = (to: string) => destination(to, { from: container, fresh: blank, chosen: draft?.chosen })
  const into = drafting ? where(target ?? (blank ? "" : state.url || arg)) : { container, why: "" }
  const choose = (chosen: string | null) => setDraft({ text: draft?.text ?? null, chosen, on: draft?.on ?? state.url })
  const pickContainer = (id: string | null) => {
    if (drafting) return choose(id)
    const url = movedFrom(state, arg)
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
    if (c === null && (place !== "here" || !id || container !== null)) keepOutside(to)
    if (place !== "here") return openWebTab(to, c, place === "back", tab || undefined)
    if (c !== container) return setTabArg(argOf(to, c))
    if (!id) return setArg(to)
    void web.go(id, "load", to)
    void web.go(id, "focus")
  }

  const inNewTab = (to: unknown) => { if (typeof to === "string" && to) openBehind(to, destination(to, { from: container, fresh: false, opened: true }).container, tab || undefined) }

  const onWeb = http(state.url)
  useZoomTarget(box, id > 0 && onWeb ? async (step) => {
    const z = await web.go(id, step > 0 ? "zoom-in" : step < 0 ? "zoom-out" : "zoom-reset") as { host?: unknown; zoom?: unknown } | null | undefined
    if (typeof z?.zoom !== "number" || typeof z.host !== "string") return null
    return { text: `${z.host.replace(/^www\./, "")} ${Math.round(z.zoom * 100)}%`, actual: Math.abs(z.zoom - 1) < 0.001 }
  } : null)
  const bookmarked = useStore().store?.bookmarks?.some((b) => b.url === state.url) ?? false
  const store = useStore().store, always = settings.use().bookmarksBar === "shown"
  const marks = !barHid && (always || (blank && !!(store?.bookmarks?.length || store?.bookmarkFolders?.length)))
  const actions = onWeb ? webPageActions({ url: state.url, title: state.title }) : []
  const me = allPanes(getTabLayout()).find((t) => t.id === tab)
  const back = state.back || canNavigate(me, -1), forward = state.forward || canNavigate(me, 1)
  const walk = (dir: -1 | 1) => { if (dir < 0 ? state.back : state.forward) void web.go(id, dir < 0 ? "back" : "forward"); else navigate(dir) }
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
  const barMenu = (e: React.MouseEvent) => { if (!(e.target as Element).closest("button, input, [role=listbox]")) menuFor(() => barItems())(e) }
  return (
    <div className={cn("relative flex h-full min-h-0 flex-col", barHid && "overflow-hidden")} data-web-page={id || ""}>
      <div ref={bar} onContextMenu={barMenu} data-web-bar data-web-bar-hidden={barHid ? (barOut ? "out" : "in") : undefined}
        className={cn("group/bar @container/bar relative flex h-10 shrink-0 items-center gap-0.5 border-b-[0.5px] border-border px-1.5",
          barHid && "absolute inset-x-0 top-0 z-20 bg-background shadow-[0_8px_20px_-12px_rgb(0_0_0/0.45)] [transition:translate_var(--motion)_var(--ease-out)]",
          barHid && !barOut && "-translate-y-full")}>
        <BarButton icon={ArrowLeft} label="Back" disabled={!back} onClick={() => walk(-1)} onNewTab={() => void web.go(id, "back-address").then(inNewTab)}
          onMenu={id && state.back ? (el) => void places(el, -1) : undefined} />
        <BarButton icon={ArrowRight} label="Forward" disabled={!forward} onClick={() => walk(1)} onNewTab={() => void web.go(id, "forward-address").then(inNewTab)}
          onMenu={id && state.forward ? (el) => void places(el, 1) : undefined} className="@max-xs/bar:hidden" />
        <BarButton icon={state.loading ? X : RotateCw} label={state.loading ? "Stop" : "Reload"} disabled={!id} onClick={() => void web.go(id, state.loading ? "stop" : "reload")}
          onNewTab={state.loading ? undefined : () => inNewTab(state.url)} />
        <AddressBar url={state.url} tab={tab} more={() => barItems()} blank={blank} draft={draft} setDraft={setDraft} inputRef={address} onGo={go} onTurn={turn} onTarget={setTarget}
          onLeave={() => { if (id) void web.go(id, "focus") }}
          lead={<ContainerButton container={into.container} url={drafting ? target ?? "" : state.url || arg} why={into.why} pick={pickContainer} manage={manageContainers} />}
          trail={id > 0 && onWeb ? <>{state.zoom && <ZoomButton zoom={state.zoom} reset={() => void web.go(id, "zoom-reset")} />}<LoginButton id={id} url={state.url} /><ShieldsButton id={id} url={state.url} loading={state.loading} /><StarButton url={state.url} title={state.title} /></> : null} />
        {id > 0 && <AgentChip id={id} />}
        {(state.playing || state.muted) && (
          <BarButton icon={state.muted ? VolumeX : Volume2} label={state.muted ? "Unmute tab" : "Mute tab"} onClick={() => void web.go(id, state.muted ? "unmute" : "mute")} />
        )}
        <DownloadsButton />
        <ExtensionButtons bar={ext} className="@max-md/bar:hidden" />
        <SaveButton disabled={!id || !onWeb} saving={saving} onSave={() => void clip()} actions={actions.filter((a) => a.kind === "save")} />
        <MoreButton disabled={!onWeb} items={(at) => [
          { label: bookmarked ? "Edit bookmark…" : "Bookmark this page…", icon: Star, hint: commandKeys("web:bookmark") || undefined,
            run: () => openBookmark(state.url, state.title, (starOf(id) ?? at).getBoundingClientRect()) },
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
          ...barItems(true),
        ]} />
        <PaneControls />
        <Progress loading={id > 0 && state.loading && !state.error} />
      </div>
      {marks && <BookmarksBar page={{ url: state.url, title: state.title }} open={(to, place) => go(to, "bookmark", place)} />}
      {ask && id > 0 && <FindBar web={web} id={id} tab={tab} ask={ask} found={found} className={barHid ? "top-2" : marks ? "top-20" : "top-12"}
        close={() => { setFindOpen(tab, false); setAsk(null); setFound(null); void web.go(id, "focus") }} />}
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-background" data-web-box>
        <div aria-hidden data-web-cut className="pointer-events-none absolute inset-0 [-webkit-app-region:no-drag]" />
        {framed && <img src={frame.src} alt="" data-web-frame draggable={false} className="pointer-events-none absolute top-0 left-0 max-w-none select-none"
          style={{ width: frame.width, height: frame.height }} />}
        {blank && <Start onOpen={(to, newTab) => go(to, "typed", newTab ? "back" : "here")} />}
        {away && <Away onShow={() => setPlayer(id, true)} onBack={() => setPlayer(id, false)} />}
        {passkey && <Passkey ask={passkey} />}
        {held && agent && <AgentWatch page={agent} shown={!tabHidden} />}
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
    ...(page.taken ? [{ label: `Give back to ${page.by}`, icon: Play, run: () => void takeOver(id, false) }]
      : page.held ? [{ label: "Take over", icon: MousePointer2, run: () => void takeOver(id, true) }] : []),
    ...(page.taken ? [] : [{ label: page.paused ? "Resume agents in this tab" : "Pause agents in this tab", icon: page.paused ? Play : Pause, run: () => void pauseAgents(id, !page.paused) }]),
    ...(page.own && page.tab ? [{ label: "Move to background", icon: MousePointer2, run: () => void toBackground(page) }] : []),
    { label: "Show agents in the browser", icon: AppWindow, sep: true, run: () => openView("agent-runs", { newTab: true }) },
  ])
  const label = page.paused ? "Paused" : busy ? page.what : page.by
  if (page.taken) return (
    <Button size="small" look="secondary" onClick={() => void takeOver(id, false)} data-web-agent="taken" data-web-agent-give
      data-tip={`You took this page over: ${page.by} is paused till you give it back`} className="ml-0.5 shrink-0">
      <Play className="size-3.5" strokeWidth={2.25} /><span>Give back<span className="@max-xl/bar:hidden"> to {page.by}</span></span>
    </Button>
  )
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
          <span className="truncate text-[12px] font-semibold" style={{ color: ink("var(--purple)") }}>{page.by} needs you</span>
          <span className="line-clamp-4 text-[15px] leading-[20px] @max-sm/ask:text-[13px] @max-sm/ask:leading-[18px]" data-web-agent-reason>{page.asking}</span>
        </span>
        <Button look="primary" onClick={() => void doneAsk(id)} data-web-agent-done className="px-4">
          <Check className="size-4" strokeWidth={2.5} />Done
        </Button>
      </div>
    </div>
  )
}

async function pictureInPicture(web: WebPages, id: number) {
  if ((await web.go(id, "pip").catch(() => null)) === "none") notify("No video on this page")
}

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

function problemOf(error: string, host: string): { icon: LucideIcon; title: string; detail: string } {
  const e = error.replace(/^net::/, "")
  const http = /^HTTP ERROR (\d{3})$/.exec(e)
  if (http) {
    const code = Number(http[1]), said = `It answered HTTP ${code} with an empty page.`
    if (code === 401 || code === 403) return { icon: ShieldAlert, title: `${host} denied access`, detail: `${said} Its firewall may be blocking this browser, or the page needs a sign-in.` }
    if (code === 404 || code === 410) return { icon: FileWarning, title: `${host} has no page here`, detail: `${said} Check the address, or the page may have moved.` }
    if (code === 429) return { icon: Globe, title: `${host} got too many requests`, detail: `${said} Wait a moment, then try again.` }
    if (code >= 500) return { icon: Globe, title: `${host} isn't working`, detail: `${said} The site had a problem; it may work if you try again.` }
    return { icon: FileWarning, title: `${host} couldn't answer this request`, detail: said }
  }
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

/** Chromium doesn't say how much of a load is left: it eases most of the way, then fills as the load ends. */
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
const HOLD_MS = 450

function ZoomButton({ zoom, reset }: { zoom: number; reset: () => void }) {
  return (
    <button type="button" onClick={reset} aria-label={`Zoom ${Math.round(zoom * 100)}%: reset to 100%`} data-tip="Reset zoom" data-web-zoom={Math.round(zoom * 100)}
      className="flex h-6 shrink-0 cursor-pointer items-center rounded-[5px] px-1.5 text-[12px] tabular-nums text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground">
      {Math.round(zoom * 100)}%
    </button>
  )
}

const BAR_ICON = "grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"

const actionItems = (actions: WebPageAction[]): MenuItem[] => actions.map((a) => ({ label: a.label, icon: a.icon, run: a.run }))
const withSep = (items: MenuItem[]) => items.map((it, i) => (i === 0 ? { ...it, sep: true } : it))

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

function MoreButton({ disabled, items }: { disabled: boolean; items: (at: HTMLElement) => MenuItem[] }) {
  return (
    <button type="button" disabled={disabled} aria-label="More for this page" aria-haspopup="menu" data-tip="More" data-web-more className={BAR_ICON}
      onClick={(e) => menuBelow(e, items(e.currentTarget))}>
      <Ellipsis className="size-4" strokeWidth={2} />
    </button>
  )
}
