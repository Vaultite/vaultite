import { pluginSettings } from "@vaultite"
import { TERMINAL_POINTS } from "./font"
import type { Theme } from "./vt/term"

type RGBA = [number, number, number, number]

function resolver() {
  const el = document.createElement("span")
  el.style.display = "none"
  document.body.appendChild(el)
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!
  ctx.canvas.width = ctx.canvas.height = 1
  const read = (token: string): RGBA => {
    el.style.color = ""
    el.style.color = `var(${token})`
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = getComputedStyle(el).color
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }
  return { read, done: () => el.remove() }
}

const num = ([r, g, b]: RGBA) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
const mix = (a: RGBA, b: RGBA, t: number): RGBA => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1]

export const glassy = () => { const r = document.documentElement; return r.hasAttribute("data-translucent") && r.hasAttribute("data-translucent-pages") }

export function theme(): Theme {
  const { read, done } = resolver()
  const dark = document.documentElement.classList.contains("dark")
  const bg = read("--background"), fg = read("--foreground"), gray = read("--gray")
  const bright = (c: RGBA) => mix(c, fg, 0.25)
  const colour = (token: string) => { const c = read(token); return [num(c), num(bright(c))] }
  const [red, brightRed] = colour("--red"), [green, brightGreen] = colour("--green"), [yellow, brightYellow] = colour("--yellow")
  const [blue, brightBlue] = colour("--blue"), [magenta, brightMagenta] = colour("--purple"), [cyan, brightCyan] = colour("--teal")
  const yel = read("--yellow"), orange = read("--orange")
  const out: Theme = {
    background: num(bg), foreground: num(fg), cursor: num(fg), cursorAccent: num(bg), clear: glassy(),
    selection: { color: num(read("--primary")), alpha: 0.3 }, selectionInactive: { color: num(gray), alpha: 0.25 }, scrollbar: num(gray),
    ansi: [num(dark ? mix(bg, fg, 0.22) : fg), red, green, yellow, blue, magenta, cyan, num(dark ? mix(bg, fg, 0.82) : mix(bg, fg, 0.5)),
      num(gray), brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, num(dark ? fg : mix(bg, fg, 0.35))],
    find: { match: num(mix(bg, yel, 0.32)), active: num(mix(bg, orange, 0.5)), border: num(orange), ruler: num(yel), activeRuler: num(orange) },
  }
  done()
  return out
}

export const codeFont = () => getComputedStyle(document.documentElement).getPropertyValue("--font-code").trim() || "monospace"

export const settings = pluginSettings<{ cursor?: string; cursorBlink?: boolean }>("terminal")
export function cursor() {
  const s = settings.get()
  const style = s.cursor === "bar" || s.cursor === "underline" ? s.cursor : "block"
  return { style, inactive: style === "block" ? "outline" : style, blink: s.cursorBlink !== false } as const
}

export const fontSize = (percent: number) => Math.max(6, Math.round(TERMINAL_POINTS * percent / 100))
