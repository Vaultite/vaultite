// iOS ends a background page it wants the memory of.
import { useEffect } from "react"
import { adoptNative, isNative } from "./native"
import { getNow, isVideo, parkEl, take } from "./now"

type Playing = { path: string; t: number; from?: string; at: number }
const KEY = "vaultite.player.playing"
const read = (): Playing | null => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null") } catch { return null } }
const write = (p: Playing | null) => { try { if (p) sessionStorage.setItem(KEY, JSON.stringify(p)); else sessionStorage.removeItem(KEY) } catch {} }

const STUCK = 20_000, TRIES = 10

export function steady(el: HTMLMediaElement, path: string) {
  if (isNative(el)) return
  let wanted = false, tries = 0, waiting = false, kept = 0, last = -1, still = 0
  let timer: ReturnType<typeof setInterval> | null = null
  const keep = () => { kept = Date.now(); write({ path, t: el.currentTime, from: el.dataset.from, at: kept }) }
  const quit = () => {
    wanted = false
    if (timer) clearInterval(timer)
    timer = null
    if (read()?.path === path) write(null)
  }
  const restart = () => {
    if (!wanted || waiting || tries >= TRIES) return
    const at = el.currentTime, src = el.src
    waiting = true
    setTimeout(() => {
      waiting = false
      if (!wanted || !src) return
      el.addEventListener("loadedmetadata", () => { el.currentTime = at; void el.play().catch(() => {}) }, { once: true })
      el.src = src
    }, Math.min(30_000, 1000 * 2 ** tries++))
  }
  el.addEventListener("play", () => {
    wanted = true
    keep()
    timer ??= setInterval(() => {
      if (el.paused || el.seeking || el.currentTime !== last) { last = el.currentTime; still = 0; return }
      if ((still += 5000) >= STUCK) { still = 0; restart() }
    }, 5000)
  })
  el.addEventListener("playing", () => { tries = 0 })
  el.addEventListener("timeupdate", () => { if (wanted && Date.now() - kept > 5000) keep() })
  // A pause the network caused comes with an error.
  el.addEventListener("pause", () => setTimeout(() => { if (el.paused && !el.error && !waiting) quit() }))
  el.addEventListener("ended", quit)
  el.addEventListener("error", () => { if (el.error?.code === MediaError.MEDIA_ERR_NETWORK) restart() })
}

// A browser may refuse to start media in a page out of sight.
function resume() {
  const p = read()
  if (!p) return
  if (Date.now() - p.at > 10 * 60_000) return write(null)
  const now = getNow()
  if (now && !now.el.paused) return
  const el = now?.path === p.path ? now.el
    : (document.querySelector(`[data-player-for="${CSS.escape(p.path)}"]`) as HTMLMediaElement | null) ?? take(p.path, isVideo(p.path))
  if (p.from && !el.dataset.from) el.dataset.from = p.from
  if (!el.isConnected) parkEl(el)
  const go = () => {
    el.currentTime = p.t
    el.play().catch(() => {
      const seen = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", seen); resume() } }
      document.addEventListener("visibilitychange", seen)
    })
  }
  if (el.readyState >= 1) go(); else el.addEventListener("loadedmetadata", go, { once: true })
}

// iOS ending the page runs no handler: then the place kept last (at most 5 s back) is where it goes on.
function leaving() {
  const now = getNow()
  if (now && !now.el.paused) write({ path: now.path, t: now.el.currentTime, from: now.el.dataset.from ?? now.from, at: Date.now() })
}

export function Resume() {
  useEffect(() => {
    adoptNative()
    resume()
    addEventListener("pagehide", leaving)
    return () => removeEventListener("pagehide", leaving)
  }, [])
  return null
}
