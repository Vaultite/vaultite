import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { setLayer } from "./layer"
import { isMac } from "@vaultite"

const KEYS = "sadfjklewcmpgh"

const CLICKABLE = [
  "a[href]", "button:not([disabled])", "summary", "select", "textarea", "input:not([type=hidden]):not([disabled])",
  "[role=button]", "[role=tab]", "[role=menuitem]", "[role=option]", "[role=link]", "[role=checkbox]", "[role=switch]",
  "[data-tree-path]", "[data-wiki]", "[data-url]", "[data-tag]", ".cm-task", "[tabindex]:not([tabindex='-1'])",
].join(",")

function targets(): HTMLElement[] {
  const seen = new Set<HTMLElement>()
  const out: HTMLElement[] = []
  const vw = innerWidth, vh = innerHeight
  const consider = (el: HTMLElement) => {
    if (seen.has(el)) return
    seen.add(el)
    if (el.closest("[aria-hidden=true], [inert]")) return
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return
    const r = el.getBoundingClientRect()
    if (r.width < 3 || r.height < 3 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return
    const x = Math.min(Math.max(r.left + Math.min(r.width / 2, 12), 0), vw - 1), y = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1)
    const hit = document.elementFromPoint(x, y)
    if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) return
    out.push(el)
  }
  for (const el of document.querySelectorAll<HTMLElement>(CLICKABLE)) consider(el)
  for (const el of document.querySelectorAll<HTMLElement>("div, span, li, img, svg")) {
    if (seen.has(el) || getComputedStyle(el).cursor !== "pointer") continue
    const p = el.parentElement
    if (p && getComputedStyle(p).cursor === "pointer") continue
    if (el.closest(CLICKABLE)) continue
    consider(el)
  }
  const spots = new Set<string>()
  return out.filter((el) => {
    const r = el.getBoundingClientRect()
    const k = `${Math.round(r.left)}:${Math.round(r.top)}`
    if (spots.has(k)) return false
    spots.add(k)
    return true
  })
}

function labels(n: number) {
  let len = 1
  while (KEYS.length ** len < n) len++
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    let s = "", x = i
    for (let j = 0; j < len; j++) { s = KEYS[x % KEYS.length] + s; x = Math.floor(x / KEYS.length) }
    out.push(s)
  }
  return out
}

function activate(el: HTMLElement, newTab: boolean) {
  const mods = { bubbles: true, cancelable: true, view: window, button: 0, metaKey: newTab && isMac, ctrlKey: newTab && !isMac }
  if (el.matches("input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=true]")) {
    el.focus()
    return
  }
  if (el.matches("[data-wiki], [data-url], [data-tag]") && el.closest(".cm-content")) {
    el.dispatchEvent(new MouseEvent("mousedown", mods))
    el.dispatchEvent(new MouseEvent("mouseup", mods))
    return
  }
  el.dispatchEvent(new PointerEvent("pointerdown", { ...mods, pointerType: "mouse", isPrimary: true }))
  el.dispatchEvent(new MouseEvent("mousedown", mods))
  el.dispatchEvent(new PointerEvent("pointerup", { ...mods, pointerType: "mouse", isPrimary: true }))
  el.dispatchEvent(new MouseEvent("mouseup", mods))
  el.dispatchEvent(new MouseEvent("click", mods))
  if (el.matches("button, a, [role=button], [role=tab], [tabindex]") && !el.matches("[data-tree-path]")) el.focus({ preventScroll: true })
}

export function Hints({ newTab }: { newTab: boolean }) {
  const found = useMemo(() => {
    const els = targets()
    const ls = labels(els.length)
    return els.map((el, i) => ({ el, label: ls[i], rect: el.getBoundingClientRect() }))
  }, [])
  const [typed, setTyped] = useState("")
  const sofar = useRef("")

  useEffect(() => {
    const close = () => setLayer(null)
    if (!found.length) { close(); return }
    const key = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === "Backspace") { sofar.current = sofar.current.slice(0, -1); setTyped(sofar.current); return }
      const k = e.key.length === 1 ? e.key.toLowerCase() : ""
      if (!k || e.metaKey || e.ctrlKey || e.altKey) { close(); return }
      const next = sofar.current + k
      const left = found.filter((f) => f.label.startsWith(next))
      if (!left.length) { close(); return }
      sofar.current = next
      setTyped(next)
      if (left.length === 1 && left[0].label === next) {
        close()
        setTimeout(() => activate(left[0].el, newTab))
      }
    }
    const away = () => close()
    addEventListener("keydown", key, true)
    addEventListener("pointerdown", away, true)
    addEventListener("wheel", away, { capture: true, passive: true })
    addEventListener("resize", away)
    return () => {
      removeEventListener("keydown", key, true)
      removeEventListener("pointerdown", away, true)
      removeEventListener("wheel", away, true)
      removeEventListener("resize", away)
    }
  }, [found, newTab])

  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[200]" data-vim-hints>
      {found.filter((f) => f.label.startsWith(typed)).map((f) => (
        <span key={f.label} data-hint={f.label}
          className="absolute rounded-[3px] border-[0.5px] border-primary bg-primary px-[3px] font-mono text-[11px] leading-[15px] font-bold text-primary-foreground shadow-sm"
          style={{ left: Math.max(0, f.rect.left - 2), top: Math.max(0, f.rect.top + Math.min(0, f.rect.height / 2 - 8)) }}>
          <span className="opacity-50">{typed}</span>{f.label.slice(typed.length)}
        </span>
      ))}
    </div>,
    document.body,
  )
}
