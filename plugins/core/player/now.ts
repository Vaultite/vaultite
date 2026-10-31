// What's playing: one media element, moved (never remade) between the views showing it, the mini player and a hidden
// park, so it plays on as you go elsewhere. Also the lock screen, where you stopped, bookmarks, chapters, sleep timer.
import { useSyncExternalStore } from "react"
import { currentFile, devicePref, get, getStore, phoneFiles, put, rawUrl } from "@vaultite"
import { AUDIO, VIDEO, type Chapter, type Mark, type Place } from "./shelves"
import { steady } from "./steady"

/** `from`: the note it was started in (the mini player goes back there). */
export type Now = { path: string; el: HTMLMediaElement; video: boolean; from?: string }

let now: Now | null = null
const subs = new Set<() => void>()
let version = 0
const changed = () => { version++; guard(); for (const f of subs) f() }

// A view's DOM can go before its React does (an editor's widget): a browser pauses what's left out of the page, so
// what's playing is parked at once, before it can.
let watching: MutationObserver | null = null
function guard() {
  if (now && !watching) {
    watching = new MutationObserver(() => { if (now && !now.el.isConnected && !presenting(now.el)) parkEl(now.el) })
    watching.observe(document.body, { childList: true, subtree: true })
  } else if (!now && watching) { watching.disconnect(); watching = null }
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const useNow = () => useSyncExternalStore(subscribe, () => now)
export const getNow = () => now

// Redraws while it plays (the mini player's time), at most a few times a second.
const ticks = new Set<() => void>()
export const useTick = (el: HTMLMediaElement | null) => useSyncExternalStore(
  (f) => { ticks.add(f); return () => { ticks.delete(f) } }, () => (el ? `${Math.floor(el.currentTime * 4)}:${el.paused}:${el.playbackRate}:${el.duration}` : ""))
const tick = () => { for (const f of ticks) f() }
export const subscribeTime = (f: () => void) => { ticks.add(f); return () => { ticks.delete(f) } }

export const speed = devicePref<number>("player.speed", 1)
export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]
/** Seconds back and forward, as podcast apps skip. */
export const BACK = 15, FORWARD = 30

// ---------- where you stopped (plugin.ts keeps them for every device)

let places: Record<string, Place> = {}
const placeSubs = new Set<() => void>()
let fetched = 0
export function loadPlaces(force = false) {
  if (!force && Date.now() - fetched < 10_000) return
  fetched = Date.now()
  get<{ places: Record<string, Place> }>("player/places").then((r) => { places = r.places ?? {}; for (const f of placeSubs) f() }, () => {})
}
export const usePlaces = () => useSyncExternalStore((f) => { placeSubs.add(f); loadPlaces(); return () => { placeSubs.delete(f) } }, () => places)
export const placeOf = (path: string) => places[path]

const lastSaved = new WeakMap<HTMLMediaElement, number>()
export function savePlace(path: string, el: HTMLMediaElement, extra: { done?: boolean } = {}) {
  if (!Number.isFinite(el.duration) || el.duration < 60) return // a voice memo or a clip: nothing to come back to
  lastSaved.set(el, Date.now())
  const d = el.duration, t = el.currentTime
  const done = extra.done ?? (t >= d - Math.min(30, d * 0.05) ? true : undefined)
  const marks = places[path]?.marks
  places = { ...places, [path]: { t: done && extra.done === undefined ? 0 : t, d: Math.round(d), at: Date.now(), ...(done ? { done } : {}), ...(marks ? { marks } : {}) } }
  for (const f of placeSubs) f()
  put("player/places", { path, t, d, ...extra }).catch(() => {})
}
export function markDone(path: string, done: boolean) {
  const p = places[path]
  places = { ...places, [path]: { t: done ? 0 : p?.t ?? 0, d: p?.d, at: Date.now(), ...(done ? { done } : {}), ...(p?.marks ? { marks: p.marks } : {}) } }
  for (const f of placeSubs) f()
  put("player/places", { path, t: done ? 0 : p?.t ?? 0, done }).catch(() => {})
}

/** Its bookmarks, all of them, shown at once and then sent. */
export function setMarks(path: string, marks: Mark[]) {
  const sorted = [...marks].sort((a, b) => a.t - b.t)
  places = { ...places, [path]: { ...(places[path] ?? { t: 0, at: Date.now() }), marks: sorted } }
  for (const f of placeSubs) f()
  put("player/marks", { path, marks: sorted }).catch(() => {})
}

// ---------- what the file says about itself: title, author, chapters, cover (plugin.ts reads them)

export type Meta = { title: string | null; artist: string | null; chapters: Chapter[]; cover: boolean }
const metas = new Map<string, Meta>()
const metaSubs = new Set<() => void>()
const asked = new Set<string>()
const LONG = /\.(mp3|m4a|m4b|aac|mp4|m4v|mov)$/i
function askMeta(path: string) {
  if (asked.has(path) || !LONG.test(path)) return
  asked.add(path)
  get<Meta>(`player/meta?path=${encodeURIComponent(path)}`).then((m) => {
    metas.set(path, m)
    for (const f of metaSubs) f()
    if (now?.path === path) session(now.el, path)
  }, () => asked.delete(path))
}
export const metaOf = (path: string) => { askMeta(path); return metas.get(path) ?? null }
export const useMeta = (path: string) => useSyncExternalStore((f) => { metaSubs.add(f); askMeta(path); return () => { metaSubs.delete(f) } }, () => metas.get(path) ?? null)
export const chaptersOf = (path: string) => metaOf(path)?.chapters ?? []
/** The chapter playing at `t`, by index (-1 before the first). */
export const chapterAt = (cs: Chapter[], t: number) => { let i = -1; cs.forEach((c, k) => { if (c.t <= t + 0.25) i = k }); return i }
/** Where chapter `i` ends: the next one's start, else the end. */
export const chapterEnd = (cs: Chapter[], i: number, d: number) => cs[i + 1]?.t ?? d
/** To the previous chapter (its start, or the one before if this one began moments ago) or the next. */
export function stepChapter(el: HTMLMediaElement, cs: Chapter[], by: 1 | -1) {
  const i = chapterAt(cs, el.currentTime)
  if (by > 0) { if (cs[i + 1]) el.currentTime = cs[i + 1].t; return }
  el.currentTime = i > 0 && el.currentTime - cs[i].t < 3 ? cs[i - 1].t : Math.max(0, cs[i]?.t ?? 0)
}

// ---------- files next to it: captions and a picture

const others = () => getStore()?.files.others ?? []
const base = (path: string) => path.replace(/\.[^./]+$/, "")
/** Its captions: `Talk.vtt` or `Talk.en.vtt` beside `Talk.mp4`. */
export const captionsOf = (path: string) => others().filter((f) => f.path.startsWith(base(path) + ".") && /\.([a-z]{2,3}(-[\w]+)?\.)?vtt$/i.test(f.path)).map((f) => f.path)
/** Its picture (a video's thumbnail, an episode's artwork): `Talk.jpg` beside `Talk.mp4`. */
export const pictureOf = (path: string) => others().find((f) => /\.(jpe?g|png|webp)$/i.test(f.path) && base(f.path) === base(path))?.path ?? null
/** Its artwork's address: the picture beside it, else the cover inside it (an audiobook's). */
export function artOf(path: string) {
  const pic = pictureOf(path)
  if (pic) return rawUrl(pic)
  return metas.get(path)?.cover ? `api/player/cover?path=${encodeURIComponent(path)}` : null
}
export const titleOf = (path: string) => path.split("/").pop()!.replace(/\.[^.]+$/, "")
/** What it's called where it's shown (the mini player, the lock screen): the note it was started in and who it's from
 *  (an inbox result's: the show, the site), else the file's name and folder. */
export function labelOf(n: Pick<Now, "path" | "from">) {
  const id = n.from?.replace(/\.md$/i, "")
  const r = id ? ((getStore() as { inbox?: { id: string; title: string; from: string }[] } | null)?.inbox ?? []).find((x) => x.id === id) : null
  if (r) return { title: r.title, by: r.from }
  const m = metas.get(n.path)
  if (m?.title) return { title: m.title, by: m.artist ?? "" }
  return { title: id ? id.split("/").pop()! : titleOf(n.path), by: m?.artist ?? n.path.split("/").slice(-2, -1)[0] ?? "" }
}
export const isVideo = (path: string) => VIDEO.test(path)
export const isMedia = (path: string) => VIDEO.test(path) || AUDIO.test(path)

// ---------- the element

/** Out of sight: where the element waits while nothing shows it (it keeps playing; the mini player takes it). */
let park: HTMLDivElement | null = null
export function parkEl(el: HTMLMediaElement) {
  if (!park) {
    park = document.createElement("div")
    park.dataset.playerPark = ""
    park.style.cssText = "position:fixed;width:1px;height:1px;left:-10px;top:-10px;overflow:hidden;opacity:0;pointer-events:none"
    document.body.append(park)
  }
  if (el.parentElement !== park) park.append(el)
}
export const isParked = (el: HTMLMediaElement) => !!park && el.parentElement === park
/** Held by no view: parked, in the mini player, or nowhere. */
const orphan = (el: HTMLMediaElement) => !el.isConnected || isParked(el) || !!el.closest("[data-mini-player]")

/** Whether it's showing full screen or picture in picture: then it's never moved. */
export function presenting(el: HTMLMediaElement) {
  const mode = (el as HTMLVideoElement & { webkitPresentationMode?: string }).webkitPresentationMode
  return document.fullscreenElement === el || document.pictureInPictureElement === el || (!!mode && mode !== "inline")
}

// The views showing an element, and whether each is on screen: the mini player shows while none is.
const slots = new Map<HTMLElement, { el: HTMLMediaElement; seen: boolean }>()
export function setSlot(div: HTMLElement, el: HTMLMediaElement | null, seen = false) {
  if (el) slots.set(div, { el, seen }); else slots.delete(div)
  changed()
}
/** Is it in a view on screen now? */
export const shown = (el: HTMLMediaElement) => [...slots].some(([div, s]) => s.el === el && s.seen && div.contains(el))
/** A view of it that's drawn (on screen or scrolled off), to take it back from the mini player. */
export const homeOf = (el: HTMLMediaElement) => [...slots].find(([div, s]) => s.el === el && div.isConnected && div.getClientRects().length > 0)?.[0] ?? null
/** Redraws when what's playing or where it's shown changes. */
export const useVersion = () => useSyncExternalStore(subscribe, () => version)

/** The element for a file: the one playing it, or a new one. */
export function take(path: string, video: boolean, v?: number): HTMLMediaElement {
  if (now && now.path === path) return now.el
  const el = document.createElement(video ? "video" : "audio")
  el.src = rawUrl(path, { v })
  el.preload = "metadata"
  el.controls = true
  el.setAttribute("playsinline", "")
  el.setAttribute("x-webkit-airplay", "allow")
  if (video) {
    el.setAttribute("autopictureinpicture", "")
    const pic = pictureOf(path)
    if (pic) (el as HTMLVideoElement).poster = rawUrl(pic)
  }
  el.dataset.playerFor = path
  el.dataset.keepsPlaying = "" // (a hidden tab doesn't stop it: Workspace.tsx)
  for (const c of captionsOf(path)) {
    const t = document.createElement("track")
    const lang = /\.([a-z]{2,3})(-[\w]+)?\.vtt$/i.exec(c)?.[1] ?? "en"
    Object.assign(t, { kind: "subtitles", src: rawUrl(c), srclang: lang, label: lang === "en" ? "English" : lang })
    el.append(t)
  }
  el.playbackRate = speed.get()
  wire(el, path, video)
  return el
}

/** A view showing it is gone: playing (or the one up), it's parked for the mini player; otherwise it stops for good. */
export function release(el: HTMLMediaElement) {
  if (now?.el === el) { if (!presenting(el)) parkEl(el); changed(); return }
  el.pause()
  el.removeAttribute("src")
  el.load() // (stops the download)
  el.remove()
}

/** The mini player's ✕: stop, remember the place, and let go of it (a view still showing it keeps it). */
export function stop() {
  if (!now) return
  setSleep(null)
  const { el, path } = now
  el.pause()
  savePlace(path, el)
  now = null
  changed()
  if (orphan(el)) release(el)
  clearSession()
}

/** Start a file without a view to show it in (the queue's play button): it plays in the mini player. */
export function playFile(path: string, from?: string) {
  const el = take(path, isVideo(path))
  if (from) el.dataset.from = from
  if (!el.isConnected) parkEl(el)
  void el.play().catch(() => {})
}

// Smart rewind: back a little after a pause, more the longer it was, so a book picks up mid-thought (audio of 10 minutes
// or more; a seek in between means you chose the spot).
const pausedAt = new WeakMap<HTMLMediaElement, number>()
const rewindFor = (ms: number) => (ms < 30_000 ? 0 : ms < 300_000 ? 5 : ms < 3_600_000 ? 10 : 20)
const rewinds = (el: HTMLMediaElement) => !(el instanceof HTMLVideoElement) && el.duration >= 600

function wire(el: HTMLMediaElement, path: string, video: boolean) {
  let restored = false
  askMeta(path)
  el.addEventListener("loadedmetadata", () => {
    if (restored) return
    restored = true
    const p = places[path]
    if (p && !p.done && p.t > 5 && p.t < el.duration - 10) el.currentTime = Math.max(0, p.t - (rewinds(el) ? rewindFor(Date.now() - p.at) : 0))
  })
  el.addEventListener("seeking", () => pausedAt.delete(el))
  el.addEventListener("play", () => {
    const at = pausedAt.get(el)
    pausedAt.delete(el)
    if (at && rewinds(el)) { const back = rewindFor(Date.now() - at); if (back) el.currentTime = Math.max(0, el.currentTime - back) }
    if (now?.el !== el) {
      if (now) { now.el.pause(); const old = now.el; now = null; if (orphan(old)) release(old) }
      const here = currentFile()
      now = { path, el, video, from: el.dataset.from || (/\.md$/i.test(here) ? here : undefined) }
      changed()
    }
    session(el, path)
    tick()
  })
  el.addEventListener("pause", () => { if (!el.ended) pausedAt.set(el, Date.now()); savePlace(path, el); tick(); position(el) })
  el.addEventListener("seeked", () => { savePlace(path, el); position(el) })
  el.addEventListener("ended", () => { savePlace(path, el, { done: true }); tick() })
  el.addEventListener("ratechange", () => { if (el.playbackRate !== speed.get()) speed.set(el.playbackRate); tick(); position(el) })
  el.addEventListener("durationchange", tick)
  el.addEventListener("timeupdate", () => {
    sleepCheck(el)
    retitle(el, path)
    tick()
    if (Date.now() - (lastSaved.get(el) ?? 0) > 30_000) { savePlace(path, el); position(el) }
  })
  steady(el, path)
}

// Leaving the page (another app, the phone locked, the tab closed): keep the place. In the iPhone app a video playing
// inline goes on as sound (iOS stops a page's video in the background, not its audio), and back to the picture after.
let swapped: HTMLVideoElement | null = null
function away() {
  if (!now) return
  savePlace(now.path, now.el)
  if (phoneFiles && now.video && !now.el.paused && !presenting(now.el)) toSound()
}
function toSound() {
  const { el: v, path } = now!
  const a = document.createElement("audio")
  a.src = v.currentSrc || v.src
  a.preload = "auto"
  a.playbackRate = v.playbackRate
  a.dataset.playerFor = path
  a.dataset.keepsPlaying = ""
  if (v.dataset.from) a.dataset.from = v.dataset.from
  wire(a, path, false)
  const at = v.currentTime
  a.addEventListener("loadedmetadata", () => { a.currentTime = at }, { once: true })
  parkEl(a)
  swapped = v as HTMLVideoElement
  v.pause()
  void a.play().catch(() => { swapped = null; void v.play().catch(() => {}) })
}
function back() {
  const v = swapped, a = now?.el
  swapped = null
  if (!v || !a || now?.video || !v.isConnected) return
  const playing = !a.paused
  v.currentTime = a.currentTime
  a.pause()
  if (playing) void v.play().catch(() => {})
  else { now = { path: now!.path, el: v, video: true, from: now!.from }; changed(); release(a) }
}
const seen = () => { if (document.hidden) away(); else { back(); loadPlaces() } }
/** Listen for the page going away and coming back (the plugin's background, while it's on). */
export function watchAway() {
  addEventListener("pagehide", away)
  addEventListener("vaultite:away", away)
  addEventListener("vaultite:back", back)
  document.addEventListener("visibilitychange", seen)
  return () => {
    removeEventListener("pagehide", away); removeEventListener("vaultite:away", away); removeEventListener("vaultite:back", back)
    document.removeEventListener("visibilitychange", seen)
  }
}

// ---------- the sleep timer: stops it after some minutes or at the end of the chapter (this window's, not saved)

export type Sleep = { until: number } | { chapter: true } | null
let sleep: Sleep = null
let sleepTimer: ReturnType<typeof setTimeout> | undefined
let sleepChapter = -1 // (the chapter it was in when the timer was set)
const sleepSubs = new Set<() => void>()
export const useSleep = () => useSyncExternalStore((f) => { sleepSubs.add(f); return () => { sleepSubs.delete(f) } }, () => sleep)
export function setSleep(s: Sleep) {
  sleep = s
  sleepChapter = -1
  clearTimeout(sleepTimer)
  if (s && "until" in s) sleepTimer = setTimeout(() => sleepCheck(now?.el), s.until - Date.now() + 50)
  for (const f of sleepSubs) f()
}
function sleepCheck(el: HTMLMediaElement | undefined) {
  if (!sleep || !el || now?.el !== el) return
  if ("until" in sleep) { if (Date.now() >= sleep.until) { el.pause(); setSleep(null) } return }
  const cs = chaptersOf(now.path), i = chapterAt(cs, el.currentTime)
  if (sleepChapter < 0) sleepChapter = i
  else if (i !== sleepChapter) { el.pause(); el.currentTime = cs[i]?.t ?? el.currentTime; sleepChapter = -1; setSleep(null) }
}

// ---------- the lock screen, Control Center, headphones and the keyboard's media keys

// With chapters, the lock screen names the chapter, and the book under it.
let titled = ""
function retitle(el: HTMLMediaElement, path: string) {
  const cs = chaptersOf(path)
  if (!cs.length || now?.el !== el) return
  const key = `${path}#${chapterAt(cs, el.currentTime)}`
  if (key !== titled) session(el, path)
}

function session(el: HTMLMediaElement, path: string) {
  const ms = navigator.mediaSession
  if (!ms) return
  const art = artOf(path), cs = chaptersOf(path), i = chapterAt(cs, el.currentTime)
  titled = `${path}#${i}`
  try {
    const { title, by } = labelOf({ path, from: now?.from })
    const chapter = cs[i]?.title
    ms.metadata = new MediaMetadata({ title: chapter || title, artist: chapter ? title : by, album: chapter ? by : "Vaultite",
      artwork: art ? [{ src: new URL(art, location.href).href }] : [] })
  } catch { /* no MediaMetadata */ }
  const on = (a: MediaSessionAction, f: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, f) } catch { /* not this one */ } }
  on("play", () => void el.play())
  on("pause", () => el.pause())
  on("seekbackward", (d) => { el.currentTime = Math.max(0, el.currentTime - (d.seekOffset ?? BACK)) })
  on("seekforward", (d) => { el.currentTime = Math.min(el.duration || Infinity, el.currentTime + (d.seekOffset ?? FORWARD)) })
  on("seekto", (d) => { if (d.seekTime !== undefined) el.currentTime = d.seekTime })
  on("stop", () => stop())
  // (headphones' double and triple press; the lock screen keeps its skips)
  on("nexttrack", cs.length ? () => stepChapter(el, chaptersOf(path), 1) : null)
  on("previoustrack", cs.length ? () => stepChapter(el, chaptersOf(path), -1) : null)
  position(el)
}
function position(el: HTMLMediaElement) {
  const ms = navigator.mediaSession
  if (!ms || now?.el !== el) return
  ms.playbackState = el.paused ? "paused" : "playing"
  if (Number.isFinite(el.duration) && el.duration > 0) {
    try { ms.setPositionState({ duration: el.duration, position: Math.min(el.currentTime, el.duration), playbackRate: el.playbackRate || 1 }) } catch { /* bad numbers */ }
  }
}
function clearSession() {
  const ms = navigator.mediaSession
  if (!ms) return
  ms.metadata = null
  ms.playbackState = "none"
}

/** Go to a time in a file: the one playing, else the first view of it in `within` (a note's editor), started. */
export function seek(path: string, t: number, within?: Element | null) {
  const el = now?.path === path ? now.el
    : (within?.querySelector(`[data-player-for="${CSS.escape(path)}"]`) ?? document.querySelector(`[data-player-for="${CSS.escape(path)}"]`)) as HTMLMediaElement | null
  const target = el ?? take(path, isVideo(path))
  if (!target.isConnected) parkEl(target)
  const go = () => { target.currentTime = t; void target.play().catch(() => {}) }
  if (target.readyState >= 1) go(); else target.addEventListener("loadedmetadata", go, { once: true })
}

export const clock = (s: number) => {
  if (!Number.isFinite(s)) return "0:00"
  s = Math.max(0, Math.floor(s))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}
