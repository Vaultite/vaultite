// What's playing: one media element at a time, moved (never remade) between the note showing it, the mini player and a
// hidden park, so it keeps playing as you go elsewhere. Also the lock screen's controls and where you stopped.
import { useSyncExternalStore } from "react"
import { currentFile, devicePref, get, getStore, phoneFiles, put, rawUrl } from "@vaultite"
import { AUDIO, VIDEO, type Place } from "./shelves"

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
  places = { ...places, [path]: { t: done && extra.done === undefined ? 0 : t, d: Math.round(d), at: Date.now(), ...(done ? { done } : {}) } }
  for (const f of placeSubs) f()
  put("player/places", { path, t, d, ...extra }).catch(() => {})
}
export function markDone(path: string, done: boolean) {
  const p = places[path]
  places = { ...places, [path]: { t: done ? 0 : p?.t ?? 0, d: p?.d, at: Date.now(), ...(done ? { done } : {}) } }
  for (const f of placeSubs) f()
  put("player/places", { path, t: done ? 0 : p?.t ?? 0, done }).catch(() => {})
}

// ---------- files next to it: captions and a picture

const others = () => getStore()?.files.others ?? []
const base = (path: string) => path.replace(/\.[^./]+$/, "")
/** Its captions: `Talk.vtt` or `Talk.en.vtt` beside `Talk.mp4`. */
export const captionsOf = (path: string) => others().filter((f) => f.path.startsWith(base(path) + ".") && /\.([a-z]{2,3}(-[\w]+)?\.)?vtt$/i.test(f.path)).map((f) => f.path)
/** Its picture (a video's thumbnail, an episode's artwork): `Talk.jpg` beside `Talk.mp4`. */
export const pictureOf = (path: string) => others().find((f) => /\.(jpe?g|png|webp)$/i.test(f.path) && base(f.path) === base(path))?.path ?? null
export const titleOf = (path: string) => path.split("/").pop()!.replace(/\.[^.]+$/, "")
/** What it's called where it's shown (the mini player, the lock screen): the note it was started in and who it's from
 *  (an inbox result's: the show, the site), else the file's name and folder. */
export function labelOf(n: Pick<Now, "path" | "from">) {
  const id = n.from?.replace(/\.md$/i, "")
  const r = id ? ((getStore() as { inbox?: { id: string; title: string; from: string }[] } | null)?.inbox ?? []).find((x) => x.id === id) : null
  if (r) return { title: r.title, by: r.from }
  return { title: id ? id.split("/").pop()! : titleOf(n.path), by: n.path.split("/").slice(-2, -1)[0] ?? "" }
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

function wire(el: HTMLMediaElement, path: string, video: boolean) {
  let restored = false
  el.addEventListener("loadedmetadata", () => {
    if (restored) return
    restored = true
    const p = places[path]
    if (p && !p.done && p.t > 5 && p.t < el.duration - 10) el.currentTime = p.t
  })
  el.addEventListener("play", () => {
    if (now?.el !== el) {
      if (now) { now.el.pause(); const old = now.el; now = null; if (orphan(old)) release(old) }
      const here = currentFile()
      now = { path, el, video, from: el.dataset.from || (/\.md$/i.test(here) ? here : undefined) }
      changed()
    }
    session(el, path)
    tick()
  })
  el.addEventListener("pause", () => { savePlace(path, el); tick(); position(el) })
  el.addEventListener("seeked", () => { savePlace(path, el); position(el) })
  el.addEventListener("ended", () => { savePlace(path, el, { done: true }); tick() })
  el.addEventListener("ratechange", () => { if (el.playbackRate !== speed.get()) speed.set(el.playbackRate); tick(); position(el) })
  el.addEventListener("durationchange", tick)
  el.addEventListener("timeupdate", () => {
    tick()
    if (Date.now() - (lastSaved.get(el) ?? 0) > 30_000) { savePlace(path, el); position(el) }
  })
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

// ---------- the lock screen, Control Center, headphones and the keyboard's media keys

function session(el: HTMLMediaElement, path: string) {
  const ms = navigator.mediaSession
  if (!ms) return
  const pic = pictureOf(path)
  try {
    const { title, by } = labelOf({ path, from: now?.from })
    ms.metadata = new MediaMetadata({ title, artist: by, album: "Vaultite",
      artwork: pic ? [{ src: new URL(rawUrl(pic), location.href).href }] : [] })
  } catch { /* no MediaMetadata */ }
  const on = (a: MediaSessionAction, f: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, f) } catch { /* not this one */ } }
  on("play", () => void el.play())
  on("pause", () => el.pause())
  on("seekbackward", (d) => { el.currentTime = Math.max(0, el.currentTime - (d.seekOffset ?? BACK)) })
  on("seekforward", (d) => { el.currentTime = Math.min(el.duration || Infinity, el.currentTime + (d.seekOffset ?? FORWARD)) })
  on("seekto", (d) => { if (d.seekTime !== undefined) el.currentTime = d.seekTime })
  on("stop", () => stop())
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
