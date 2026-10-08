export { cn } from "cn"

export const capitalize = (s: string | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "")
export const isDark = () => document.documentElement.classList.contains("dark")

/** A length in Tailwind's spacing unit, so it follows density like `h-6.5`: `space(6.5)` is 26px in compact. Text,
 *  px icons, hairlines and radii stay px. */
export const space = (n: number) => `calc(var(--spacing) * ${n})`

/** Run fn when the browser has nothing else to do (soon after, where there's no requestIdleCallback: Safari): work the
 *  app will want later but the first paint doesn't need. */
export function whenIdle(fn: () => void) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 3000 })
  else setTimeout(fn, 300)
}

/** The nearest box around `el` that scrolls now (a pane, the sheet, a panel), or null: the window. */
export function scrollingBox(el: Element | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p
  }
  return null
}
