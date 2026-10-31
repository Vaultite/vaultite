// Settings' previews (components/SettingPreview.tsx): what each setting changes, as small windows in the colour scheme
// in use. Each exaggerates the one thing that differs and mutes the rest; behaviours play a calm loop where things move.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react"
import { FileText, Folder, MousePointer2 } from "lucide-react"
import { moves, PACES } from "@/core/animation"
import { setPrefs, usePrefs, type Animation } from "@/core/prefs"
import { PROPERTIES_SHOWN, setEditor, type PropertiesShown } from "@/core/editorPrefs"
import { switchPreview, type Preview } from "@/components/SettingPreview"
import { Frame, Lights, line } from "@/components/ChoicePictures"
import { cn } from "@/lib/utils"

/** An element playing `frames` over `ms`, over and over; still (its own style, the telling frame) while nothing moves. */
function Moving({ frames, ms, className, style, children }: { frames: Keyframe[]; ms: number; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const el = useRef<HTMLDivElement>(null)
  const { animation } = usePrefs()
  useEffect(() => {
    if (!el.current || !moves()) return
    const a = el.current.animate(frames, { duration: ms, iterations: Infinity })
    return () => a.cancel()
    // (frames are written in place each draw; the loop restarts only when animations are turned on or off)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animation, ms])
  return <div ref={el} className={className} style={style}>{children}</div>
}
/** A keyframe at `t` ms of a loop `ms` long. */
const kf = (ms: number) => (t: number, k: Keyframe): Keyframe => ({ ...k, offset: Math.min(1, t / ms) })

const MUTED = "bg-foreground/12"
const lines = (ws: string[], cls = MUTED) => ws.map((w, i) => <span key={i} className="contents">{line(w, cls)}</span>)

/** The left sidebar: the window's buttons and a few rows (`children`: others). */
function Side({ w = "26%", className, style, children }: { w?: string; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div className={cn("relative flex shrink-0 flex-col gap-[4px] bg-sidebar px-[5px] pt-[5px]", className)} style={{ width: w, ...style }}>
      <Lights className="mb-[1px]" />
      {children ?? <>{line("78%", "bg-primary/45")}{lines(["60%", "72%", "52%", "66%"])}</>}
    </div>
  )
}

/** A note's text: its first line a heading. */
const Note = ({ className, heading = true }: { className?: string; heading?: boolean }) => (
  <div className={cn("flex flex-col gap-[4px] px-[8px] pt-[7px]", className)}>
    {heading && line("42%", "bg-foreground/30")}{lines(["88%", "80%", "84%", "56%", "76%"])}
  </div>
)

const Pane = ({ className, children }: { className?: string; children: ReactNode }) => <div className={cn("relative flex min-w-0 flex-1 flex-col", className)}>{children}</div>

/** Tabs over a pane: the active one a card. `icons`: files' icons. */
function TabBar({ icons = true, n = 3 }: { icons?: boolean; n?: number }) {
  return (
    <div className="flex h-[15px] shrink-0 items-center gap-[2px] border-b-[0.5px] border-border px-[3px]">
      <span className="flex h-[10px] w-[38%] items-center gap-[2px] rounded-[3px] px-[3px]"
        style={{ background: "color-mix(in srgb, var(--foreground) 9%, transparent)" }}>
        {icons && <span className="size-[4px] shrink-0 rounded-[1px] bg-primary/80" />}
        {line("70%", "bg-foreground/45")}
      </span>
      {Array.from({ length: n - 1 }, (_, i) => (
        <span key={i} className="flex h-[10px] w-[26%] items-center gap-[2px] px-[3px]">
          {icons && <span className="size-[4px] shrink-0 rounded-[1px] bg-foreground/20" />}{line("70%", "bg-foreground/18")}
        </span>
      ))}
    </div>
  )
}

/** The pointer, moving through `at` ([ms, left %, top %, opacity?]) in a loop `ms` long; still at `rest`. */
function Pointer({ ms, path, rest }: { ms: number; path: [number, number, number, number?][]; rest: [number, number, number?] }) {
  const pos = (x: number, y: number, o = 1) => ({ left: `${x}%`, top: `${y}%`, opacity: o })
  return (
    <Moving ms={ms} className="absolute" style={pos(...rest)}
      frames={path.map(([t, x, y, o]) => ({ ...pos(x, y, o), offset: Math.min(1, t / ms), easing: "ease-in-out" }))}>
      <MousePointer2 aria-hidden className="size-[10px] fill-foreground text-background drop-shadow-[0_0.5px_1px_rgb(0_0_0/0.4)]" strokeWidth={1.5} />
    </Moving>
  )
}

// ---------- Tabs ----------

const tabBar = (on: boolean) => <Frame><Side w="22%" /><Pane>{on ? <TabBar /> : <div className="h-[4px]" />}<Note /></Pane></Frame>

/** Two panes split; with `titles`, each says what it shows above it. */
const paneTitles = (on: boolean) => (
  <Frame>
    <Side w="20%" />
    {[0, 1].map((i) => (
      <Pane key={i} className={cn(i && "border-l-[0.5px] border-border")}>
        {on
          ? <div className="flex h-[13px] shrink-0 items-center gap-[2px] border-b-[0.5px] border-border px-[5px]"><span className="size-[4px] shrink-0 rounded-[1px] bg-primary/80" />{line(i ? "40%" : "52%", "bg-foreground/55")}</div>
          : <div className="h-[4px]" />}
        <Note className="px-[6px]" />
      </Pane>
    ))}
  </Frame>
)

// ---------- Window ----------

/** Split, the pane without the focus fades; the pointer clicks into the other and the fade follows. */
function DimPanes({ on }: { on: boolean }) {
  const ms = 4800, at = kf(ms), fast = PACES.natural.fast[0]
  // (the page's own colour over it, a shade darker; in dark the page itself: black over a dark page hardly shows)
  const dim = "absolute inset-0 bg-[color-mix(in_srgb,var(--background)_82%,black)] dark:bg-background"
  // (left focused first: the right one dim, then the other way round)
  const fade = (first: boolean) => [at(0, { opacity: first ? 0 : 0.7 }), at(1500, { opacity: first ? 0 : 0.7 }), at(1500 + fast, { opacity: first ? 0.7 : 0 }),
    at(3900, { opacity: first ? 0.7 : 0 }), at(3900 + fast, { opacity: first ? 0 : 0.7 }), at(ms, { opacity: first ? 0 : 0.7 })]
  return (
    <Frame>
      <Side w="20%" />
      {[0, 1].map((i) => (
        <Pane key={i} className={cn(i && "border-l-[0.5px] border-border")}>
          <div className="h-[4px]" /><Note className="px-[6px]" />
          {on && <Moving ms={ms} frames={fade(i === 0)} className={dim} style={{ opacity: i ? 0.7 : 0 }} />}
        </Pane>
      ))}
      <Pointer ms={ms} rest={[36, 52]} path={[[0, 36, 52], [1000, 36, 52], [1500, 74, 46], [3400, 74, 46], [3900, 36, 52], [ms, 36, 52]]} />
    </Frame>
  )
}

/** A hidden sidebar: as an icon rail (`rail`), or sliding in over the page when the pointer reaches the window's edge.
 *  `shade`: the page dims behind it. `pace`: how it moves (Animations). */
function Peek({ rail, shade, pace = "natural", pointer }: { rail?: boolean; shade?: boolean; pace?: Animation; pointer?: boolean }) {
  if (rail) return (
    <Frame>
      <div className="flex w-[11%] shrink-0 flex-col items-center gap-[5px] bg-sidebar pt-[5px]">
        <span className="size-[6px] rounded-[1.5px] bg-primary/80" />
        {[0, 1, 2].map((i) => <span key={i} className="size-[6px] rounded-[1.5px] bg-foreground/30" />)}
      </div>
      <Pane className="border-l-[0.5px] border-border"><TabBar /><Note /></Pane>
    </Frame>
  )
  const ms = 4400, at = kf(ms)
  const [d, easing] = pace === "off" ? [0, "linear"] : PACES[pace === "snappy" ? "snappy" : "natural"].spring
  const out = "translateX(-110%)"
  const slide = [at(0, { transform: out }), at(1000, { transform: out, easing }), at(1000 + d, { transform: "none" }),
    at(3000, { transform: "none", easing }), at(3000 + d, { transform: out }), at(ms, { transform: out })]
  return (
    <Frame>
      <Pane><TabBar /><Note /></Pane>
      {shade && <Moving ms={ms} className="absolute inset-0 bg-black/20 dark:bg-black/50"
        frames={[at(0, { opacity: 0 }), at(1140, { opacity: 0 }), at(1420, { opacity: 1 }), at(3000, { opacity: 1 }), at(3120, { opacity: 0 }), at(ms, { opacity: 0 })]} />}
      <Moving ms={ms} frames={slide} className="absolute inset-y-[3px] left-[3px] flex w-[36%] rounded-[4px] border-[0.5px] border-border shadow-[0_3px_10px_rgb(0_0_0/0.25)]">
        <Side w="100%" className="rounded-[4px]" />
      </Moving>
      {pointer && <Pointer ms={ms} rest={[2, 46]} path={[[0, 60, 58], [900, 2, 46], [2500, 2, 46], [3000, 62, 54], [ms, 60, 58]]} />}
    </Frame>
  )
}

/** Typing, the file bar above the note fades; the pointer moved, it's back. */
function TypingFade({ on }: { on: boolean }) {
  const ms = 5600, at = kf(ms)
  return (
    <Frame>
      <Side w="22%" />
      <Pane>
        <Moving ms={ms} className="flex h-[14px] shrink-0 items-center gap-[3px] border-b-[0.5px] border-border bg-foreground/[0.05] px-[7px]" style={{ opacity: on ? 0.12 : 1 }}
          frames={on ? [at(0, { opacity: 1 }), at(900, { opacity: 1 }), at(1400, { opacity: 0.12 }), at(3900, { opacity: 0.12 }), at(4060, { opacity: 1 }), at(ms, { opacity: 1 })] : [{ opacity: 1 }, { opacity: 1 }]}>
          <span className="size-[4px] rounded-[1px] bg-primary/80" />{line("14%", "bg-foreground/40")}<span className="text-[6px] leading-none text-foreground/40">/</span>{line("24%", "bg-foreground/50")}
        </Moving>
        <div className="flex flex-col gap-[4px] px-[8px] pt-[7px]">
          {line("42%", "bg-foreground/30")}{lines(["88%", "80%"])}
          <span className="flex items-center gap-[1px]">
            <Moving ms={ms} className={cn("h-[3px] rounded-full", MUTED)} style={{ width: "62%" }}
              frames={[at(0, { width: "4%" }), at(500, { width: "4%" }), at(3300, { width: "62%" }), at(ms - 200, { width: "62%" }), at(ms, { width: "4%" })]} />
            <span className="h-[6px] w-[1px] bg-primary" />
          </span>
        </div>
      </Pane>
      {on && <Pointer ms={ms} rest={[80, 70, 0]} path={[[0, 80, 70, 0], [3500, 80, 70, 0], [3600, 80, 70], [4000, 70, 58], [5200, 70, 58], [ms, 70, 58, 0]]} />}
    </Frame>
  )
}

/** Glass: the window inset over the desktop, its sidebar and tab bar letting it through; `pages`: its note too, more
 *  lightly. */
function Translucent({ pages }: { pages: boolean }) {
  const through = (k: number, v: string) => ({ background: `color-mix(in srgb, var(${v}) ${k}%, transparent)`, backdropFilter: "blur(3px)" })
  return (
    <Frame>
      <div className="glass-desktop absolute inset-0" />
      <div className="absolute inset-x-[7%] top-[11%] bottom-0 flex overflow-hidden rounded-t-[5px] shadow-[0_2px_8px_rgb(0_0_0/0.3)]">
        <Side w="30%" className="bg-transparent" style={through(42, "--sidebar")} />
        <Pane className="border-l-[0.5px] border-border">
          <div style={through(42, "--background")}><TabBar n={2} /></div>
          <div className="flex-1" style={pages ? through(70, "--background") : { background: "var(--background)" }}><Note /></div>
        </Pane>
      </div>
    </Frame>
  )
}

/** A sidebar close up: two panels, scrolled as one (one scroll bar) or each on its own (one each). */
function SidebarScroll({ on }: { on: boolean }) {
  const ms = 4800, at = kf(ms)
  const panel = (k: number) => (
    <div className="flex flex-col gap-[4px] px-[6px] pt-[5px]">
      {line(k ? "34%" : "40%", "bg-foreground/40")}{lines(["72%", "58%", "66%", "50%", "70%", "62%", "54%"])}
    </div>
  )
  const by = (px: number) => [at(0, { transform: "none" }), at(800, { transform: "none", easing: "ease-in-out" }), at(2000, { transform: `translateY(${-px}px)` }),
    at(3200, { transform: `translateY(${-px}px)`, easing: "ease-in-out" }), at(4400, { transform: "none" }), at(ms, { transform: "none" })]
  const thumb = (px: number) => by(-px)
  const bar = "absolute right-[2px] w-[2px] rounded-full bg-foreground/40"
  return (
    <Frame>
      <div className="relative flex w-[66%] shrink-0 flex-col overflow-hidden bg-sidebar">
        {on ? [0, 1].map((k) => (
          <div key={k} className="relative h-1/2 overflow-hidden">
            {k === 0 ? <Moving ms={ms} frames={by(14)}>{panel(k)}</Moving> : panel(k)}
            <Moving ms={ms} frames={k === 0 ? thumb(10) : [{ transform: "none" }, { transform: "none" }]} className={cn(bar, "top-[4px] h-[45%]")} />
            {k === 0 && <span className="absolute inset-x-0 bottom-0 h-[0.5px] bg-border" />}
          </div>
        )) : (
          <>
            <Moving ms={ms} frames={by(16)}><div className="flex flex-col">{panel(0)}{panel(1)}</div></Moving>
            <Moving ms={ms} frames={thumb(16)} className={cn(bar, "top-[4px] h-[60%]")} />
          </>
        )}
      </div>
      <Pane className="border-l-[0.5px] border-border"><Note className="px-[6px]" /></Pane>
    </Frame>
  )
}

/** A sidebar close up: three panels, a line between each (exaggerated) or only room. */
const panelDividers = (on: boolean) => (
  <Frame>
    <div className="flex w-[66%] shrink-0 flex-col bg-sidebar px-[6px] pt-[5px]">
      {[["40%", "70%", "56%"], ["32%", "64%", "74%"], ["46%", "60%", "52%"]].map(([h, ...rows], i) => (
        <div key={i} className="flex flex-col gap-[4px] py-[4px]">
          {i > 0 && <span className={cn("-mx-[6px] mb-[3px] h-[1px]", on ? "bg-foreground/35" : "bg-transparent")} />}
          {line(h, "bg-foreground/40")}{lines(rows)}
        </div>
      ))}
    </div>
    <Pane className="border-l-[0.5px] border-border"><Note className="px-[6px]" /></Pane>
  </Frame>
)

/** Files in the sidebar and the tabs, with their icons or without. */
const fileIcons = (on: boolean) => {
  const row = (Icon: typeof Folder, w: string, indent: number, tint?: string) => (
    <span className="flex items-center gap-[3px]" style={{ paddingLeft: indent }}>
      {on && <Icon className="size-[8px] shrink-0" style={{ color: tint ?? "var(--muted-foreground)" }} strokeWidth={2.5} />}{line(w, "bg-foreground/30")}
    </span>
  )
  return (
    <Frame>
      <Side w="56%" className="gap-[5px]">
        {row(Folder, "46%", 0)}{row(FileText, "56%", 6, "var(--blue)")}{row(FileText, "44%", 6, "var(--purple)")}{row(Folder, "38%", 0)}{row(FileText, "50%", 6, "var(--green)")}
      </Side>
      <Pane className="border-l-[0.5px] border-border"><TabBar icons={on} n={2} /><Note className="px-[6px]" /></Pane>
    </Frame>
  )
}

/** A note with its lines numbered in a gutter, or not. */
const lineNumbers = (on: boolean) => (
  <Frame>
    <Side w="22%" />
    <Pane>
      <TabBar />
      <div className="flex flex-1 flex-col gap-[3px] pt-[6px] pr-[6px] pl-[8px]">
        {["42%", "86%", "78%", "82%", "54%", "70%", "64%"].map((w, i) => (
          <span key={i} className="flex h-[7px] items-center gap-[5px]">
            {on && <span className="w-[8px] shrink-0 text-right font-mono text-[7px] leading-none font-medium text-foreground/60 tabular-nums">{i + 1}</span>}
            {line(w, i ? MUTED : "bg-foreground/30")}
          </span>
        ))}
      </div>
    </Pane>
  </Frame>
)


// ---------- Editor ----------

const readableLineLength = (on: boolean) => (
  <Frame>
    <Side w="16%" />
    <Pane>
      <TabBar />
      <div className={cn("flex flex-col gap-[4px] pt-[7px]", on ? "mx-auto w-[54%]" : "w-full px-[6px]")}>
        {line("46%", "bg-foreground/30")}{lines(["100%", "94%", "100%", "62%", "97%", "80%"], "bg-foreground/22")}
      </div>
    </Pane>
  </Frame>
)

const inlineTitle = (on: boolean) => (
  <Frame>
    <Side w="22%" />
    <Pane>
      <TabBar />
      <div className="flex flex-col gap-[4px] px-[8px] pt-[8px]">
        {on && <span className="mb-[2px] block h-[6px] w-[56%] rounded-full bg-foreground/60" />}
        {lines(["88%", "80%", "84%", "56%", "76%"])}
      </div>
    </Pane>
  </Frame>
)

/** Properties in document: a table of them, nothing, or their YAML as text. */
function propertiesPicture(how: string) {
  const mono = "font-mono text-[5.5px] leading-[7px] text-foreground/55"
  return (
    <Frame>
      <Side w="20%" />
      <Pane>
        <TabBar />
        <div className="flex flex-col gap-[4px] px-[8px] pt-[6px]">
          {how === "source"
            ? <div className={mono}><div>---</div><div>type: <span className="text-primary">note</span></div><div>tags: [trip]</div><div>---</div></div>
            : line("42%", "bg-foreground/30")}
          {how === "visible" && (
            <div className="flex flex-col gap-[3px] rounded-[3px] bg-foreground/[0.06] p-[4px]">
              {[["22%", "38%"], ["18%", "46%"], ["26%", "30%"]].map(([k, v], i) => (
                <span key={i} className="flex items-center gap-[3px]">
                  <span className="size-[4px] shrink-0 rounded-[1px] bg-foreground/35" />{line(k, "bg-foreground/35")}<span className="ml-[6%]" />{line(v, "bg-primary/45")}
                </span>
              ))}
            </div>
          )}
          {lines(how === "source" ? ["86%", "74%"] : ["88%", "80%", "84%"])}
        </div>
      </Pane>
    </Frame>
  )
}

// ---------- the switches' ----------

type Pictures = { text: string; draw: (on: boolean) => ReactNode }
const PICTURES: Record<string, Pictures> = {
  "tab-bar": { text: "On, a pane's tabs show in a bar above it; off, only what's open, without tabs.", draw: tabBar },
  "pane-titles": { text: "With the tab bar off, each pane shows the name of what's open above it.", draw: paneTitles },
  "dim-panes": { text: "With the window split, the panes you're not in fade a little, following the focus.", draw: (on) => <DimPanes on={on} /> },
  "file-icons": { text: "Files show their icons in the sidebar and in tabs.", draw: fileIcons },
  "typing-fade": { text: "While you type, the bar above the file fades; it's back when the pointer moves.", draw: (on) => <TypingFade on={on} /> },
  "translucent-pages": { text: "Notes and terminals let the desktop through too, more lightly.", draw: (on) => <Translucent pages={on} /> },
  "line-numbers": { text: "Each line of a note shows its number in a gutter.", draw: lineNumbers },
  rails: { text: "On, a hidden sidebar folds to a rail of icons; off, it slides in when the pointer reaches the window's edge.", draw: (on) => <Peek rail={on} pointer /> },
  "peek-shade": { text: "While a hidden sidebar is slid in, the page behind it dims.", draw: (on) => <Peek shade={on} pointer /> },
  "sidebar-scroll": { text: "On, each sidebar panel scrolls on its own; off, the whole sidebar scrolls as one.", draw: (on) => <SidebarScroll on={on} /> },
  "panel-dividers": { text: "A line between the panels of a sidebar.", draw: panelDividers },
  "readable-line-length": { text: "Notes keep their lines to a readable width, centred in a wide pane.", draw: readableLineLength },
  "show-inline-title": { text: "A note shows its name as a title above its text.", draw: inlineTitle },
}

/** A switch's preview by its Settings row ("tab-bar"), if it has pictures. */
export function switchPictures(row: string, value: boolean, set: (on: boolean) => unknown): Preview | undefined {
  const p = PICTURES[row]
  return p && switchPreview(p.text, [p.draw(false), p.draw(true)], value, set)
}

/** Animations' preview: each pace, its sidebar moving at that pace. */
export const animationPreview = (value: Animation): Preview => ({
  text: "How panes, tabs and sidebars move: with a soft spring, quickly, or not at all.", value, set: (v) => setPrefs({ animation: v as Animation }),
  options: [{ value: "natural", label: "Natural" }, { value: "snappy", label: "Snappy" }, { value: "off", label: "Off" }].map((o) => ({ ...o, picture: <Peek pace={o.value as Animation} /> })),
})

/** Properties in document's preview: shown as a table, hidden, or as their YAML. */
export const propertiesPreview = (value: PropertiesShown): Preview => ({
  text: "A note's properties above its text: as a table, hidden, or as their YAML while editing.", value, set: (v) => setEditor({ propertiesInDocument: v as PropertiesShown }),
  options: PROPERTIES_SHOWN.map((o) => ({ ...o, picture: propertiesPicture(o.value) })),
})
