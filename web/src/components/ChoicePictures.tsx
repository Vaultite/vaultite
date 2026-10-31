// A setting chosen by its picture (Settings > Appearance: theme, density, what new tabs open): small windows drawn in
// the colour scheme in use, light or dark, each showing what choosing it looks like.
import type { ReactNode } from "react"
import { Globe } from "lucide-react"
import { haptic } from "@/core/haptics"
import { usePrefs } from "@/core/prefs"
import { cn, isDark } from "@/lib/utils"

/** What a window shows: a note, the rows at a density, a new tab's page, the quick switcher over a note, another view. */
export type Scene = "note" | "compact" | "comfortable" | "page" | "switcher" | "view"

const line = (w: string, cls = "bg-foreground/15") => <span className={cn("block h-[3px] shrink-0 rounded-full", cls)} style={{ width: w }} />

function Sidebar({ gap }: { gap: number }) {
  return (
    <div className="flex w-[30%] shrink-0 flex-col bg-sidebar px-[5px] pt-[5px]" style={{ gap }}>
      <span className="mb-[2px] flex gap-[2px]">
        {["red", "yellow", "green"].map((c) => <span key={c} className="size-[4px] rounded-full" style={{ background: `var(--${c})` }} />)}
      </span>
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

/** A small window in the colour scheme in use (`mode`: light or dark, else the app's). */
export function WindowPicture({ scene, mode, className }: { scene: Scene; mode?: "light" | "dark"; className?: string }) {
  const { scheme } = usePrefs()
  const dark = mode ? mode === "dark" : isDark()
  return (
    <div aria-hidden data-scheme={scheme === "default" ? undefined : scheme}
      className={cn("scheme-preview flex h-full w-full overflow-hidden bg-background text-foreground", dark && "dark", className)}>
      <Sidebar gap={scene === "comfortable" ? 6 : 3} />
      <Content scene={scene} />
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

export type PictureOption<T extends string> = { value: T; label: string; picture: ReactNode }

/** The choices side by side, each its picture over its name; the one chosen ringed in the accent. */
export function PictureChoice<T extends string>({ value, options, onChange, label }: {
  value: T; options: PictureOption<T>[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-3" data-picture-choice={label}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.label}
            onClick={() => { if (!on) { haptic("selection"); onChange(o.value) } }}
            className="group/pic flex w-[92px] cursor-pointer flex-col items-center gap-1.5">
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
