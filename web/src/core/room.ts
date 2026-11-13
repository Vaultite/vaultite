// A custom property changed on an element restyles everything under it; a rule's declarations restyle only what it matches.
import { signal } from "@/core/signal"

let sheet: CSSStyleSheet | null = null
function liveRule(selector: string): CSSStyleDeclaration {
  if (!sheet) {
    const el = document.createElement("style")
    el.dataset.live = ""
    document.head.append(el)
    sheet = el.sheet!
  }
  const rule = sheet.cssRules[sheet.insertRule(`${selector} {}`, sheet.cssRules.length)]
  if (!(rule instanceof CSSStyleRule)) throw new Error(`${selector} isn't a selector`)
  return rule.style
}

let now = { left: "0px", right: "0px" }
let roomRule: CSSStyleDeclaration | null = null
const changed = signal()

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

const open: Partial<Record<"left" | "right", { body: CSSStyleDeclaration; bar: CSSStyleDeclaration; px: number }>> = {}

export function setOpenWidth(side: "left" | "right", px: number) {
  const at = `aside[data-side=${side}]:not([data-collapsed])`
  const o = open[side] ??= { body: liveRule(`${at} > :not(nav, [data-lights-ghost], [role=separator])`), bar: liveRule(`${at} > nav`), px: NaN }
  if (o.px === px) return
  o.px = px
  o.body.setProperty("min-width", `calc(${px}px - var(--spacing) * 4)`)
  o.bar.setProperty("min-width", `${px - 0.5}px`)
}
