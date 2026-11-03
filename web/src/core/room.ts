// The sidebars' sizes, on rules of their own: a custom property changed on an element restyles all under it (on <html>,
// every element) per toggle and drag move, while a rule's declarations restyle only what it matches.
import { signal } from "@/core/signal"

let sheet: CSSStyleSheet | null = null
function liveRule(selector: string): CSSStyleDeclaration {
  if (!sheet) {
    const el = document.createElement("style")
    el.dataset.live = ""
    document.head.append(el)
    sheet = el.sheet!
  }
  return (sheet.cssRules[sheet.insertRule(`${selector} {}`, sheet.cssRules.length)] as CSSStyleRule).style
}

// ---------- the window's room beside the sidebars, for what's fixed to its edges (the status bar, corner cards)

let now = { left: "0px", right: "0px" }
let roomRule: CSSStyleDeclaration | null = null
const changed = signal()

/** --left-sidebar and --right-sidebar on `.vau-room`: CSS lengths (`calc()`s of the sidebars' widths). */
export function setRoom(left: string, right: string) {
  if (left === now.left && right === now.right) return
  now = { left, right }
  roomRule ??= liveRule(".vau-room")
  roomRule.setProperty("--left-sidebar", left)
  roomRule.setProperty("--right-sidebar", right)
  changed.notify()
}
export const room = () => now
export const onRoom = changed.subscribe

// ---------- an open sidebar's content at its open width while the sidebar opens: its edge uncovers it, nothing reflows
// each frame (its padding and edge take 4 units; the vault's bar runs edge to edge)

const open: Partial<Record<"left" | "right", { body: CSSStyleDeclaration; bar: CSSStyleDeclaration; px: number }>> = {}

export function setOpenWidth(side: "left" | "right", px: number) {
  const at = `aside[data-side=${side}]:not([data-collapsed])`
  const o = open[side] ??= { body: liveRule(`${at} > :not(nav, [data-lights-ghost], [role=separator])`), bar: liveRule(`${at} > nav`), px: NaN }
  if (o.px === px) return
  o.px = px
  o.body.setProperty("min-width", `calc(${px}px - var(--spacing) * 4)`)
  o.bar.setProperty("min-width", `${px - 0.5}px`)
}
