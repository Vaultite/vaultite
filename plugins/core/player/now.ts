import { useSyncExternalStore } from "react"
import { currentFile, devicePref, get, getStore, phoneFiles, put, rawUrl } from "@vaultite"
import { VIDEO, type Chapter, type Mark, type Place } from "./shelves"
import { describeNative, isMediaEl, isNative, nativeAudio, sleepNative } from "./native"
import { steady } from "./steady"

export type MediaEl = HTMLElement & Pick<HTMLMediaElement, "src" | "currentSrc" | "currentTime" | "duration" | "paused" | "ended" | "readyState" | "playbackRate" | "controls" | "preload" | "seeking" | "play" | "pause" | "load"> & {
  readonly error: { readonly code: number; readonly message: string } | null
  readonly textTracks: ArrayLike<TextTrack>
  webkitPresentationMode?: string
  webkitSetPresentationMode?: (mode: string) => void
  webkitShowPlaybackTargetPicker?: () => void
}
export type Now = { path: string; el: MediaEl; video: boolean; from?: string }

let now: Now | null = null
const subs = new Set<() => void>()
let version = 0
const changed = () => { version++; guard(); for (const f of subs) f() }

// A browser pauses media taken out of the page.
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

const ticks = new Set<() => void>()
export const useTick = (el: MediaEl | null) => useSyncExternalStore(
  (f) => { ticks.add(f); return () => { ticks.delete(f) } }, () => (el ? `${Math.floor(el.currentTime * 4)}:${el.paused}:${el.playbackRate}:${el.duration}` : ""))
const tick = () => { for (const f of ticks) f() }
export const subscribeTime = (f: () => void) => { ticks.add(f); return () => { ticks.delete(f) } }

export const speed = devicePref<number>("player.speed", 1)
export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]
export const BACK = 15, FORWARD = 30

let places: Record<string, Place> = {}
const placeSubs = new Set<() => void>()
let fetched = 0
export function loadPlaces(force = false) {
  if (!force && Date.now() - fetched < 10_000) return
  fetched = Date.now()
  get<{ places: Record<string, Place> }>("player/places").then((r) => { places = r.places ?? {}; for (const f of placeSubs) f() }, () => {})
}
export const usePlaces = () => useSyncExternalStore((f) => { placeSubs.add(f); loadPlaces(); return () => { placeSubs.delete(f) } }, () => places)

const lastSaved = new WeakMap<MediaEl, number>()
export function savePlace(path: string, el: MediaEl, extra: { done?: boolean } = {}) {
  if (!Number.isFinite(el.duration) || el.duration < 60) return
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

export function setMarks(path: string, marks: Mark[]) {
  const sorted = [...marks].sort((a, b) => a.t - b.t)
  places = { ...places, [path]: { ...(places[path] ?? { t: 0, at: Date.now() }), marks: sorted } }
  for (const f of placeSubs) f()
  put("player/marks", { path, marks: sorted }).catch(() => {})
}

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
export const chapterAt = (cs: Chapter[], t: number) => { let i = -1; cs.forEach((c, k) => { if (c.t <= t + 0.25) i = k }); return i }
export const chapterEnd = (cs: Chapter[], i: number, d: number) => cs[i + 1]?.t ?? d
export function stepChapter(el: MediaEl, cs: Chapter[], by: 1 | -1) {
  const i = chapterAt(cs, el.currentTime)
  if (by > 0) { if (cs[i + 1]) el.currentTime = cs[i + 1].t; return }
  el.currentTime = i > 0 && el.currentTime - cs[i].t < 3 ? cs[i - 1].t : Math.max(0, cs[i]?.t ?? 0)
}

const others = () => getStore()?.files.others ?? []
const base = (path: string) => path.replace(/\.[^./]+$/, "")
export const captionsOf = (path: string) => others().filter((f) => f.path.startsWith(base(path) + ".") && /\.([a-z]{2,3}(-[\w]+)?\.)?vtt$/i.test(f.path)).map((f) => f.path)
export const pictureOf = (path: string) => others().find((f) => /\.(jpe?g|png|webp)$/i.test(f.path) && base(f.path) === base(path))?.path ?? null
export function artOf(path: string) {
  const pic = pictureOf(path)
  if (pic) return rawUrl(pic)
  return metas.get(path)?.cover ? `api/player/cover?path=${encodeURIComponent(path)}` : null
}
export const titleOf = (path: string) => path.split("/").pop()!.replace(/\.[^.]+$/, "")
export function labelOf(n: Pick<Now, "path" | "from">) {
  const id = n.from?.replace(/\.md$/i, "")
  const r = id ? (getStore()?.inbox ?? []).find((x) => x.id === id) : null
  if (r) return { title: r.title, by: r.from }
  const m = metas.get(n.path)
  if (m?.title) return { title: m.title, by: m.artist ?? "" }
  return { title: id ? id.split("/").pop()! : titleOf(n.path), by: m?.artist ?? n.path.split("/").slice(-2, -1)[0] ?? "" }
}
export const isVideo = (path: string) => VIDEO.test(path)

let park: HTMLDivElement | null = null
export function parkEl(el: MediaEl) {
  if (!park) {
    park = document.createElement("div")
    park.dataset.playerPark = ""
    park.style.cssText = "position:fixed;width:1px;height:1px;left:-10px;top:-10px;overflow:hidden;opacity:0;pointer-events:none"
    document.body.append(park)
  }
  if (el.parentElement !== park) park.append(el)
}
export const isParked = (el: MediaEl) => !!park && el.parentElement === park
const orphan = (el: MediaEl) => !el.isConnected || isParked(el) || !!el.closest("[data-mini-player]")

// Moving the element would end its full screen or picture in picture.
export function presenting(el: MediaEl) {
  const mode = el.webkitPresentationMode
  return document.fullscreenElement === el || document.pictureInPictureElement === el || (!!mode && mode !== "inline")
}

const slots = new Map<HTMLElement, { el: MediaEl; seen: boolean }>()
export function setSlot(div: HTMLElement, el: MediaEl | null, seen = false) {
  if (el) slots.set(div, { el, seen }); else slots.delete(div)
  changed()
}
export const shown = (el: MediaEl) => [...slots].some(([div, s]) => s.el === el && s.seen && div.contains(el))
export const homeOf = (el: MediaEl) => [...slots].find(([div, s]) => s.el === el && div.isConnected && div.getClientRects().length > 0)?.[0] ?? null
export const useVersion = () => useSyncExternalStore(subscribe, () => version)

export function playerOf(path: string, within: ParentNode | null | undefined) {
  const el = within?.querySelector(`[data-player-for="${CSS.escape(path)}"]`) ?? null
  return isMediaEl(el) ? el : null
}

export function take(path: string, video: boolean, v?: number): MediaEl {
  if (now && now.path === path) return now.el
  const el = (!video && nativeAudio()) || document.createElement(video ? "video" : "audio")
  el.src = rawUrl(path, { v })
  el.preload = "metadata"
  el.controls = true
  el.setAttribute("playsinline", "")
  el.setAttribute("x-webkit-airplay", "allow")
  if (video) {
    el.setAttribute("autopictureinpicture", "")
    const pic = pictureOf(path)
    if (pic && el instanceof HTMLVideoElement) el.poster = rawUrl(pic)
  }
  el.dataset.playerFor = path
  el.dataset.keepsPlaying = ""
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

export function release(el: MediaEl) {
  if (now?.el === el) { if (!presenting(el)) parkEl(el); changed(); return }
  el.pause()
  el.removeAttribute("src")
  el.load()
  el.remove()
}

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

export function playFile(path: string, from?: string) {
  const el = take(path, isVideo(path))
  if (from) el.dataset.from = from
  if (!el.isConnected) parkEl(el)
  void el.play().catch(() => {})
}

const pausedAt = new WeakMap<MediaEl, number>()
const rewindFor = (ms: number) => (ms < 30_000 ? 0 : ms < 300_000 ? 5 : ms < 3_600_000 ? 10 : 20)
const rewinds = (el: MediaEl) => !(el instanceof HTMLVideoElement) && el.duration >= 600

function wire(el: MediaEl, path: string, video: boolean) {
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

// iOS stops a page's video in the background, not its audio.
let swapped: MediaEl | null = null
function away() {
  if (!now) return
  savePlace(now.path, now.el)
  if (phoneFiles && now.video && !now.el.paused && !presenting(now.el)) toSound()
}
function toSound() {
  const { el: v, path } = now!
  const a = nativeAudio() ?? document.createElement("audio")
  a.src = v.currentSrc || v.src
  a.preload = "auto"
  a.playbackRate = v.playbackRate
  a.dataset.playerFor = path
  a.dataset.keepsPlaying = ""
  if (v.dataset.from) a.dataset.from = v.dataset.from
  wire(a, path, false)
  const at = v.currentTime
  a.currentTime = at
  a.addEventListener("loadedmetadata", () => { a.currentTime = at }, { once: true })
  parkEl(a)
  swapped = v
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

export type Sleep = { until: number } | { chapter: true } | null
let sleep: Sleep = null
let sleepTimer: ReturnType<typeof setTimeout> | undefined
let sleepChapter = -1
const sleepSubs = new Set<() => void>()
export const useSleep = () => useSyncExternalStore((f) => { sleepSubs.add(f); return () => { sleepSubs.delete(f) } }, () => sleep)
export function setSleep(s: Sleep) {
  sleep = s
  sleepChapter = -1
  clearTimeout(sleepTimer)
  if (s && "until" in s) sleepTimer = setTimeout(() => sleepCheck(now?.el), s.until - Date.now() + 50)
  if (now && isNative(now.el)) sleepNative(s ? ("until" in s ? { until: s.until } : { chapter: true }) : {})
  for (const f of sleepSubs) f()
}
function sleepCheck(el: MediaEl | undefined) {
  if (!sleep || !el || now?.el !== el) return
  if ("until" in sleep) { if (Date.now() >= sleep.until) { el.pause(); setSleep(null) } return }
  const cs = chaptersOf(now.path), i = chapterAt(cs, el.currentTime)
  if (sleepChapter < 0) sleepChapter = i
  else if (i !== sleepChapter) { el.pause(); el.currentTime = cs[i]?.t ?? el.currentTime; sleepChapter = -1; setSleep(null) }
}

let titled = ""
function retitle(el: MediaEl, path: string) {
  const cs = chaptersOf(path)
  if (!cs.length || now?.el !== el) return
  const key = `${path}#${chapterAt(cs, el.currentTime)}`
  if (key !== titled) session(el, path)
}

function session(el: MediaEl, path: string) {
  const art = artOf(path), cs = chaptersOf(path), i = chapterAt(cs, el.currentTime)
  titled = `${path}#${i}`
  if (isNative(el)) { // (the shell names the chapter itself, as the page may be asleep)
    const { title, by } = labelOf({ path, from: now?.from })
    return describeNative({ title, artist: by, album: "Vaultite", artwork: art ? new URL(art, location.href).href : undefined, chapters: cs })
  }
  const ms = navigator.mediaSession
  if (!ms) return
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
  // nexttrack is the headphones' double press; the lock screen keeps its skips.
  on("nexttrack", cs.length ? () => stepChapter(el, chaptersOf(path), 1) : null)
  on("previoustrack", cs.length ? () => stepChapter(el, chaptersOf(path), -1) : null)
  position(el)
}
function position(el: MediaEl) {
  const ms = navigator.mediaSession
  if (!ms || now?.el !== el || isNative(el)) return
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

export function seek(path: string, t: number, within?: Element | null) {
  const el = now?.path === path ? now.el
    : playerOf(path, within) ?? playerOf(path, document)
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
