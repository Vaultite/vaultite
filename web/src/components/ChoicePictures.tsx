// A setting chosen by its picture (Settings > Appearance: theme, style, colour scheme, density, what new tabs open):
// small windows drawn in a colour scheme, light or dark, each showing what choosing it looks like.
import { useLayoutEffect, useRef, type ReactNode } from "react"
import { Globe } from "lucide-react"
import { haptic } from "@/core/haptics"
import { usePrefs } from "@/core/prefs"
import { onlyMode } from "@/core/appearance"
import { cn, isDark } from "@/lib/utils"

/** What a window shows: a note, the rows at a density, a new tab's page, the quick switcher over a note, another view. */
export type Scene = "note" | "compact" | "comfortable" | "page" | "switcher" | "view"

/** A line of text, `w` wide. */
export const line = (w: string, cls = "bg-foreground/15") => <span className={cn("block h-[3px] shrink-0 rounded-full", cls)} style={{ width: w }} />

/** A window's three buttons. */
export const Lights = ({ className }: { className?: string }) => (
  <span className={cn("flex shrink-0 gap-[2px]", className)}>
    {["red", "yellow", "green"].map((c) => <span key={c} className="size-[4px] rounded-full" style={{ background: `var(--${c})` }} />)}
  </span>
)

function Sidebar({ gap, glass }: { gap: number; glass?: boolean }) {
  return (
    <div className={cn("flex w-[30%] shrink-0 flex-col px-[5px] pt-[5px]", glass ? "bg-[color-mix(in_srgb,var(--sidebar)_25%,transparent)]" : "bg-sidebar")} style={{ gap }}>
      <Lights className="mb-[2px]" />
      {line("80%", "bg-primary/70")}{line("65%")}{line("75%")}{gap < 5 && <>{line("55%")}{line("70%")}{line("60%")}</>}
    </div>
  )
}

function Content({ scene }: { scene: Scene }) {
  if (scene === "page") return (
    <div className="flex flex-1 flex-col items-center gap-[5px] pt-[10px]">
      <span className="block h-[7px] w-[60%] rounded-full border-[0.5px] border-border bg-card" />
      <span className="grid w-[64%] grid-cols-3 gap-[3px]">
        {Array.from({ length: 6 }, (_, i) => <span key={i} className="block h-[8px] rounded-[2px] bg-foreground/10" />)}
      </span>
    </div>
  )
  if (scene === "view") return <div className="grid flex-1 place-items-center text-muted-foreground"><Globe className="size-4" strokeWidth={2} /></div>
  const note = (
    <div className={cn("flex flex-1 flex-col px-[7px]", scene === "comfortable" ? "gap-[7px] pt-[10px]" : "gap-[4px] pt-[8px]")}>
      {line("45%", "bg-foreground/60")}{line("90%")}{line("80%")}{line("85%")}{line("40%", "bg-primary/60")}{line("75%")}
    </div>
  )
  if (scene !== "switcher") return note
  return (
    <div className="relative flex flex-1">
      <div className="flex flex-1 opacity-40">{note}</div>
      <div className="absolute inset-x-[12%] top-[6px] flex flex-col gap-[3px] rounded-[3px] border-[0.5px] border-border bg-popover p-[3px] shadow-[0_2px_6px_rgb(0_0_0/0.18)]">
        {line("60%", "bg-foreground/40")}
        <span className="block rounded-[2px] bg-primary/20 px-[2px] py-[1px]">{line("70%", "bg-primary/70")}</span>
        {line("55%")}{line("65%")}
      </div>
    </div>
  )
}

/** A picture's box, in the colour scheme in use (`mode`: light or dark, else the app's). */
export function Frame({ mode, className, children }: { mode?: "light" | "dark"; className?: string; children: ReactNode }) {
  const { scheme } = usePrefs()
  const dark = mode ? mode === "dark" : isDark()
  return (
    <div aria-hidden data-scheme={scheme === "default" ? undefined : scheme}
      className={cn("scheme-preview relative flex h-full w-full overflow-hidden bg-background text-foreground", dark && "dark", className)}>
      {children}
    </div>
  )
}

/** A small window in a colour scheme (`scheme`, else the one in use; `mode`: light or dark, else the scheme's only one
 *  or the app's). `glass`: the desktop shows through its sidebar, and through its page too with `pages`. */
export function WindowPicture({ scene, mode, scheme, glass, className }: {
  scene: Scene; mode?: "light" | "dark"; scheme?: string; glass?: "window" | "pages"; className?: string
}) {
  const inUse = usePrefs().scheme
  const id = scheme ?? inUse
  const only = onlyMode(id)
  const dark = mode ? mode === "dark" : only ? only === "dark" : isDark()
  return (
    <div aria-hidden data-scheme={id === "default" ? undefined : id}
      className={cn("scheme-preview flex h-full w-full overflow-hidden text-foreground", glass ? "glass-desktop" : "bg-background", dark && "dark", className)}>
      <Sidebar gap={scene === "comfortable" ? 6 : 3} glass={!!glass} />
      {glass
        ? <div className={cn("flex flex-1", glass === "pages" ? "bg-[color-mix(in_srgb,var(--background)_80%,transparent)]" : "bg-background")}><Content scene={scene} /></div>
        : <Content scene={scene} />}
    </div>
  )
}

/** Light and dark, split corner to corner: following the system. */
export function SystemPicture({ scene }: { scene: Scene }) {
  return (
    <div className="relative h-full w-full">
      <WindowPicture scene={scene} mode="light" className="absolute inset-0" />
      <WindowPicture scene={scene} mode="dark" className="absolute inset-0 [clip-path:polygon(62%_0,100%_0,100%_100%,38%_100%)]" />
    </div>
  )
}

export type PictureOption<T extends string> = { value: T; label: string; picture: ReactNode; tip?: string }

/** The choices side by side, each its picture over its name; the one chosen ringed in the accent. `scroll`: one row
 *  that scrolls sideways, faded where there's more, opening on the one chosen (many choices: the colour schemes). */
export function PictureChoice<T extends string>({ value, options, onChange, label, scroll }: {
  value: T; options: PictureOption<T>[]; onChange: (v: T) => void; label: string; scroll?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // (once, as it opens: the chosen one in sight without moving the page; after that only the user scrolls it)
    const el = ref.current, on = el?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!scroll || !el || !on) return
    const end = on.offsetLeft + on.offsetWidth + 24
    if (end > el.clientWidth) el.scrollLeft = end - el.clientWidth
  }, [scroll])
  return (
    // (scrolling, its padding keeps the rings unclipped; the negative margins put the first picture where it would be)
    <div ref={ref} role="radiogroup" aria-label={label} data-picture-choice={label}
      className={cn("flex gap-3", scroll ? "edge-fade-x -mx-3 -my-[6px] overflow-x-auto px-3 py-[6px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "flex-wrap")}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.label} data-tip={o.tip}
            onClick={() => { if (!on) { haptic("selection"); onChange(o.value) } }}
            className="group/pic flex w-[92px] shrink-0 cursor-pointer flex-col items-center gap-1.5">
            <span className={cn("block h-[58px] w-full overflow-hidden rounded-[8px] ring-[0.5px] ring-border transition-shadow",
              on ? "shadow-[0_0_0_2.5px_var(--background),0_0_0_4.5px_var(--primary)]" : "group-hover/pic:shadow-[0_0_0_2.5px_var(--background),0_0_0_4.5px_var(--border)]")}>
              {o.picture}
            </span>
            <span className={cn("max-w-full truncate text-[12px] leading-[16px]", on ? "font-semibold" : "text-muted-foreground")}>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
