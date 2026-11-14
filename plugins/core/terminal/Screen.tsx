import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { Captioned, HoverCard, onLook, placeBesideColumn, type HoverShown } from "@vaultite"
import { paletteBeyondTheme, useScreen } from "./screens"
import { codeFont, theme } from "./theme"

const FONT = 13, LEAST_SCALE = 0.5
const LINE = { height: "1lh" }

let colours: Record<string, string> | null = null, ch = 0
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`
const themeColours = () => (colours ??= Object.fromEntries(theme().ansi.map((n, i) => [`--vt-palette-${i}`, hex(n)])))
const looks = (f: () => void) => onLook(() => { colours = null; ch = 0; f() })
function charWidth() {
  if (ch) return ch
  const c = document.createElement("canvas").getContext("2d")
  if (!c) return FONT * 0.6
  c.font = `${FONT}px ${codeFont()}`
  return (ch = c.measureText("0".repeat(20)).width / 20)
}

export function TerminalPicture({ id }: { id: string }) {
  const screen = useScreen(id)
  const vars = useSyncExternalStore(looks, themeColours)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const cw = charWidth(), wide = ((screen?.cols ?? 80) + 2) * cw
  const k = size ? Math.min(1, Math.max(LEAST_SCALE, size.w / wide)) : 0
  return (
    <div ref={box} inert aria-hidden data-terminal-picture={id} className="pointer-events-none absolute inset-0 overflow-hidden bg-background text-foreground" style={{ ...paletteBeyondTheme, ...vars }}>
      {screen && size && k > 0 && (
        <div className="absolute top-0 left-0 flex origin-top-left flex-col justify-end font-mono whitespace-pre"
          style={{ width: wide, height: size.h / k, transform: `scale(${k})`, fontSize: FONT, lineHeight: 1.3, paddingInline: cw }}>
          <div className="min-h-full py-1">
            {screen.lines.map((l, i) => <div key={i} style={LINE}>{l.map((r, j) => <span key={j} style={r.style}>{r.text}</span>)}</div>)}
          </div>
        </div>
      )}
    </div>
  )
}

const sidebarOf = (row: HTMLElement) => row.closest("aside")

export function ScreenCard({ shown, row, id, title, about }: { shown: HoverShown; row: RefObject<HTMLElement | null>; id: string; title: string; about: string }) {
  return (
    <HoverCard shown={shown} anchor={row} place={placeBesideColumn(sidebarOf)} data-terminal-card={id}>
      <Captioned picture={<TerminalPicture id={id} />} title={title} about={about} />
    </HoverCard>
  )
}
