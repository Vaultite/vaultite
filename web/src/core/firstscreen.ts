import { useEffect, useLayoutEffect } from "react"
import { span } from "./spans"

const LONGEST_HOLD_MS = 1500, NO_SCREEN_MS = 10_000
const holds = new Set<string>()
const told: (() => void)[] = []
let shell = false, drawn = false, gaveUp = false, cap: ReturnType<typeof setTimeout> | null = null
const STARTING = "vaultite.starting"
const keepStarting = (on: boolean) => { try { if (on) localStorage.setItem(STARTING, "1"); else localStorage.removeItem(STARTING) } catch { return } }
export const lastStartUnfinished = (() => { try { return localStorage.getItem(STARTING) === "1" } catch { return false } })()
export const pluginsStarting = () => { if (!drawn) keepStarting(true) }
export const forgetUnfinishedStart = () => keepStarting(false)

function tell() {
  if (drawn || !shell || holds.size) return
  drawn = true
  if (cap) clearTimeout(cap)
  if (!gaveUp) keepStarting(false)
  requestAnimationFrame(() => setTimeout(() => {
    span("app.screen", {}, 0).end()
    for (const fn of told.splice(0)) fn()
  }, 0))
}

export function shellDrawn() {
  if (shell) return
  shell = true
  cap = setTimeout(() => { holds.clear(); tell() }, LONGEST_HOLD_MS)
  requestAnimationFrame(() => setTimeout(tell, 0))
}

export function releaseFirstScreen(key: string) {
  if (holds.delete(key)) tell()
}

export function onFirstScreen(fn: () => void) {
  if (drawn) fn()
  else told.push(fn)
}

export function useFirstScreenHold(key: string, done: boolean) {
  useLayoutEffect(() => {
    if (drawn) return
    holds.add(key)
    return () => releaseFirstScreen(key)
  }, [key])
  useEffect(() => { if (done) releaseFirstScreen(key) }, [key, done])
}

setTimeout(() => { gaveUp = !drawn; shell = true; holds.clear(); tell() }, NO_SCREEN_MS)

export function whenIdle(fn: () => void, timeout = 3000): () => void {
  let on = true, cancel = () => {}
  onFirstScreen(() => {
    if (!on) return
    if (typeof requestIdleCallback === "function") { const t = requestIdleCallback(() => fn(), { timeout }); cancel = () => cancelIdleCallback(t) }
    else { const t = setTimeout(fn, 300); cancel = () => clearTimeout(t) }
  })
  return () => { on = false; cancel() }
}
