export { cn } from "cn"

export const capitalize = (s: string | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "")
/** A count and its noun: "1 file", "3 files" (`many`: a plural that isn't the word + s). */
export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`
export const isDark = () => document.documentElement.classList.contains("dark")
export function followSystemTheme() {
  const dark = matchMedia("(prefers-color-scheme: dark)")
  const theme = () => document.documentElement.classList.toggle("dark", dark.matches)
  theme()
  dark.addEventListener("change", theme)
}

export const space = (n: number) => `calc(var(--spacing) * ${n})`

// Safari has no requestIdleCallback: a short timeout there.
export function whenIdle(fn: () => void) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 3000 })
  else setTimeout(fn, 300)
}

export function scrollingBox(el: Element | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p
  }
  return null
}
