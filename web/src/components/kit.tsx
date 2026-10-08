// Small building blocks shared by every page.
import { useEffect, useState, type HTMLAttributes, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"
import { ChevronRight, RotateCcw, Search, X, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { plain } from "@/core/data"
import { haptic } from "@/core/haptics"

/** The element with id `id` (a bar left for a portal: #sheet-bar), found as it renders so the portal is there in the
 *  same frame (a view transition's picture takes it at once); one more render if it isn't in the page yet. */
export function usePortalHost(id: string | null) {
  const [, redraw] = useState(0)
  const host = id ? document.getElementById(id) : null
  useEffect(() => { if (id && !host) redraw((n) => n + 1) }, [id, host])
  return host
}

/** A page's large title. On desktop it sits right under its tab's bar (ViewBar), like a file's title, whatever the page. */
export function PageHeader({ title, subtitle, children, className }: { title: string; subtitle?: ReactNode; children?: ReactNode; className?: string }) {
  // On phones a size down: the header above names the page too (PhoneHeader).
  return (
    <header className={cn("mb-5 flex items-end justify-between gap-4 pt-1 md:pt-0", className)}>
      <div>
        <h1 className="text-[24px] leading-[30px] font-bold md:text-[34px] md:leading-[41px]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[15px] leading-[20px] text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </header>
  )
}

/** The top of a detail sheet: tinted kind line, the title (labels the sheet), a subtitle, then any extras. */
/** The app's own mark, where a lucide icon would go (the Vaults sheet). */
/** An icon with a status dot on its corner while
 *  `on` (a coding agent waiting for you): the same wherever the icon is (a tab, the tab list, the sidebar's row).
 *  `tag`: a tiny label on its bottom corner (the machine a terminal runs on: "M1"). */
export function Badged({ on, tag, children }: { on?: boolean; tag?: string; children: ReactNode }) {
  if (!on && !tag) return <>{children}</>
  return (
    <span className="relative inline-grid shrink-0 place-items-center" data-badged>
      {children}
      {on && <span aria-hidden className="absolute -top-[3px] -right-[3px] size-[7px] rounded-full bg-[var(--yellow)] ring-[1.5px] ring-background" />}
      {tag && <span aria-hidden data-tag className="absolute -right-[6px] -bottom-[2px] rounded-[2px] bg-background px-[1.5px] text-[7px] leading-[8px] font-semibold tracking-tight text-muted-foreground">{tag}</span>}
    </span>
  )
}

export const Logo = ({ className }: { className?: string; strokeWidth?: number }) => <img src="icon.svg" alt="" className={className} />

export function SheetHead({ icon: Icon, tint, kicker, title, sub, children }: {
  icon: LucideIcon | typeof Logo; tint: string; kicker: ReactNode; title: ReactNode; sub?: ReactNode; children?: ReactNode
}) {
  return (
    <div className="mb-5">
      <div className="mb-1 flex items-center gap-1.5 text-[15px] font-semibold" style={{ color: tint }}>
        <Icon className="size-[18px] shrink-0" strokeWidth={2.25} />{kicker}
      </div>
      <h2 id="sheet-title" className="text-[24px] leading-[30px] font-bold text-balance break-words">{title}</h2>
      {sub && <p className="mt-0.5 text-[15px] leading-[20px] text-muted-foreground">{sub}</p>}
      {children}
    </div>
  )
}

/** A card, headed like the Health app: small symbol and title in the category colour. */
export function Panel({
  title, icon: Icon, tint, action, className, children,
}: {
  title?: ReactNode; icon?: LucideIcon; tint?: string; action?: ReactNode; className?: string; children: ReactNode
}) {
  return (
    <section className={cn("glass rounded-[12px] p-4", className)}>
      {title && (
        <div className="mb-3 flex items-center gap-1.5" style={{ color: tint ?? "var(--primary)" }}>
          {Icon && <Icon className="size-[18px]" strokeWidth={2.25} />}
          <h2 className="flex-1 text-[15px] font-semibold">{title}</h2>
          {action && <div className="text-foreground">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, unit, hint }: { label: string; value: ReactNode; unit?: string; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="num mt-0.5 text-[28px] leading-[34px] font-semibold">
        {value}
        {unit && <span className="ml-0.5 text-[15px] font-semibold text-muted-foreground">{unit}</span>}
      </div>
      {hint && <div className="text-[13px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** Empty state. Data arrives by talking to Claude, so say what to ask for. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-[20px] text-muted-foreground">{children}</p>
}

/** A block's data on its way: "Loading…", or what went wrong getting it (`error`: the line to say, "Couldn't ask
 *  Tailscale."). One look for every block: the core draws the same while a block's code loads (components/Blocks.tsx). */
export function Loading({ error, className }: { error?: ReactNode; className?: string }) {
  return <p className={cn("text-[15px] leading-[20px] text-muted-foreground", className)} aria-busy={!error || undefined}>{error || "Loading…"}</p>
}

/** Progress ring for "x of goal this week". */
export function Ring({ value, goal, color, size = 44 }: { value: number; goal: number; color: string; size?: number }) {
  const r = size / 2 - 4
  const c = 2 * Math.PI * r
  const f = Math.min(value / goal, 1)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={5} />
      {f > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
        strokeDasharray={`${c * f} ${c}`} className="transition-[stroke-dasharray] duration-500" />}
    </svg>
  )
}

/** Single-series bar chart with a hover/tap readout. */
export function Bars({
  data, color = "var(--primary)", height = 96, format = (v: number) => String(v), goal,
}: {
  data: { label: string; value: number; tip?: string }[]; color?: string; height?: number
  format?: (v: number) => string; goal?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(goal ?? 0, ...data.map((d) => d.value), 1)
  const shown = hover ?? data.length - 1
  return (
    <div>
      <div className="mb-2 h-5 text-[13px] text-muted-foreground tabular-nums">
        {data[shown] && (
          <>
            <span className="num font-semibold text-foreground">{format(data[shown].value)}</span> · {data[shown].tip ?? data[shown].label}
          </>
        )}
      </div>
      <div className="relative flex items-end gap-[3px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {goal !== undefined && (
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/40"
            style={{ bottom: (goal / max) * height }} />
        )}
        {data.map((d, i) => (
          <button key={i} type="button" className="flex h-full flex-1 items-end" aria-label={`${d.tip ?? d.label}: ${format(d.value)}`}
            onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
            <span className="w-full rounded-t-[4px] transition-opacity"
              style={{
                height: d.value ? Math.max((d.value / max) * height, 3) : 2,
                background: d.value ? color : "var(--muted)",
                opacity: hover === null || hover === i ? 1 : 0.45,
              }} />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px] text-[11px] text-muted-foreground">
        {data.map((d, i) => (
          <span key={i} className="flex-1 truncate text-center">{d.label}</span>
        ))}
      </div>
    </div>
  )
}

/** A list row: title (two lines at most) and meta line; `onOpen` makes it a disclosure row, `href` a new-tab link. On
 *  phones the meta wraps too (no tooltip there); on desktop only with `wrap`. Other props go on the row. */
export function Row({ title, meta, right, lead, className, onOpen, href, wrap, ...rest }: {
  title: ReactNode; meta?: ReactNode; right?: ReactNode; lead?: ReactNode; className?: string
  onOpen?: (e: ReactMouseEvent<HTMLElement>) => void; href?: string
  /** Let the meta line wrap to two lines on desktop too (detail sheets) instead of truncating. */
  wrap?: boolean
} & Omit<HTMLAttributes<HTMLElement>, "title" | "onClick">) {
  const body = (
    <>
      {lead}
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[15px] leading-[20px]">{typeof title === "string" ? plain(title) : title}</div>
        {meta && <div className={cn("text-[13px] text-muted-foreground", wrap ? "line-clamp-2" : "max-md:line-clamp-2 md:truncate")}>{meta}</div>}
      </div>
      {right && <div className="shrink-0 text-[14px] text-muted-foreground tabular-nums">{right}</div>}
      {onOpen && <ChevronRight className="-ml-1.5 size-4 shrink-0 text-tertiary" strokeWidth={2.5} />}
    </>
  )
  const pressable = cn(
    "relative isolate flex min-h-11 w-full cursor-pointer items-center gap-3 py-2 text-left",
    "before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] before:transition-colors",
    "hover:before:bg-foreground/[0.04] active:before:bg-foreground/[0.07]", className,
  )
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={pressable} {...rest}>{body}</a>
  ) : onOpen ? (
    <button type="button" onClick={onOpen} className={pressable} {...rest}>{body}</button>
  ) : (
    <div className={cn("flex min-h-11 items-center gap-3 py-2", className)} {...rest}>{body}</div>
  )
}

export function List({ children }: { children: ReactNode }) {
  return <div className="hairline">{children}</div>
}

/** A labelled group inside a card ("Up next", "Lifts"). */
export function Section({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 text-[13px] font-semibold text-muted-foreground">{title}</div>
      {children}
    </div>
  )
}

/** iOS segmented control ("List / Map"). */
/** A setting: name and line on the left, control on the right, with even room so hairline-separated rows look alike.
 *  `stack`: control under the name on phones; `onClick`: the whole row is a button with `value` and a chevron. */
export function SettingRow({ label, sub, stack, value, onClick, chevron = ChevronRight, children, ...rest }: {
  label: ReactNode; sub?: ReactNode; stack?: boolean; value?: ReactNode; onClick?: () => void; chevron?: LucideIcon | null; children?: ReactNode
} & Omit<HTMLAttributes<HTMLElement>, "onClick">) {
  const Chevron = chevron
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-[20px]">{label}</div>
        {sub && <div className="text-[13px] leading-[18px] text-muted-foreground">{sub}</div>}
      </div>
      {value != null && <span className="min-w-0 max-w-[50%] truncate text-right text-[14px] text-muted-foreground">{value}</span>}
      {children}
      {onClick && Chevron && <Chevron aria-hidden className="-ml-1.5 size-4 shrink-0 text-tertiary" strokeWidth={2.5} />}
    </>
  )
  const cls = cn("flex min-h-12 w-full gap-3 py-2 text-left", stack ? "flex-col items-stretch sm:flex-row sm:items-center" : "items-center")
  return onClick
    ? <button type="button" onClick={onClick} {...rest} className={cn(cls, "cursor-pointer")}>{body}</button>
    : <div {...rest} className={cls}>{body}</div>
}

export function Segmented<T extends string>({ value, options, onChange, label, className }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex rounded-[9px] bg-muted p-[2px]", className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => { if (!on) haptic("selection"); onChange(o.value) }}
            className={cn(
              "relative min-h-8 flex-1 cursor-pointer rounded-[7px] px-4 text-[13px] whitespace-nowrap transition-[background,box-shadow] duration-200",
              on ? "bg-card font-semibold shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04)] dark:bg-[var(--segment-on)]" : "font-medium text-foreground/80",
            )}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** A small switch in the app's accent colour. */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); haptic(); onChange(!on) }}
      className={cn(
        "relative h-[22px] w-[36px] shrink-0 cursor-pointer rounded-full transition-colors duration-200 disabled:cursor-default disabled:opacity-50",
        "after:absolute after:-inset-2.5 after:content-['']", // 42 pt hit area
        on ? "bg-primary" : "bg-foreground/[0.18]",
      )}>
      <span className={cn(
        "absolute top-[2px] left-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-transform duration-200",
        on && "translate-x-[14px]",
      )} />
    </button>
  )
}

/** A setting's way back to its default: a small circular arrow before its control. While the setting is
 *  its default (`on` false) it keeps its place but can't be seen or reached, so the control beside it never moves. */
export function ResetButton({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" aria-label={label} data-tip={on ? "Restore default" : undefined} data-reset-default={on || undefined}
      aria-hidden={!on || undefined} tabIndex={on ? undefined : -1} onClick={(e) => { e.stopPropagation(); onClick() }}
      className={cn("grid size-8 shrink-0 cursor-pointer place-items-center rounded-[7px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground", !on && "invisible")}>
      <RotateCcw className="size-3.5" strokeWidth={2} />
    </button>
  )
}

/** Inset grouped list, like iOS Settings (detail sheets). */
export const Group = ({ children }: { children: ReactNode }) => (
  <div className="rounded-[10px] bg-foreground/[0.04] px-3"><List>{children}</List></div>
)

/** A label and its value, in a Group. */
export function KV({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2 text-[15px]">
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 text-right break-words text-muted-foreground">{children}</span>
    </div>
  )
}

/** A value a block shows that can be changed in place (a person's context): click, type, Enter. `set` (the ctx's
 *  setProperty for a key): absent, it's only shown; "" is undefined (the key goes). Empty, it offers `placeholder`. */
export function Editable({ value, set, placeholder, className, children }: {
  value: string; set?: (v: string | undefined) => void; placeholder: string; className?: string; children?: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  if (!set) return value ? <span className={className}>{children ?? value}</span> : null
  if (editing) {
    const commit = () => { setEditing(false); if (v.trim() !== value) set(v.trim() || undefined) }
    return (
      <input autoFocus value={v} placeholder={placeholder} spellCheck={false} aria-label={placeholder}
        onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() }
          if (e.key === "Escape") { e.preventDefault(); setV(value); setEditing(false) }
        }}
        className={cn("-mx-1 w-[calc(100%+8px)] min-w-0 rounded-[6px] bg-foreground/[0.06] px-1 outline-none placeholder:text-muted-foreground", className)} />
    )
  }
  return (
    <span role="button" tabIndex={0} data-no-edit data-tip={value ? `Change ${placeholder.replace(/^Add /, "")}` : undefined}
      onClick={(e) => { if (!(e.target as Element).closest("a")) setEditing(true) }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditing(true) } }}
      className={cn("-mx-1 cursor-text rounded-[6px] px-1 hover:bg-foreground/[0.04]", !value && "text-tertiary", className)}>
      {value ? children ?? value : placeholder}
    </span>
  )
}

/** A field that filters a list (plugins, hotkeys, a table's rows): one look everywhere. Escape clears it (and goes no
 *  further while it has text), the x too. */
export function FilterField({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={cn("relative block min-w-0 flex-1", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={2.25} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        spellCheck={false} autoComplete="off"
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.stopPropagation(); onChange("") } }}
        className="h-9 w-full rounded-[8px] border-[0.5px] border-border bg-card pr-8 pl-8 text-[16px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 md:h-7.5 md:text-[13px] [&::-webkit-search-cancel-button]:hidden" />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear" data-tip="Clear"
          className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground hover:text-foreground">
          <X className="size-3.5" strokeWidth={2.25} />
        </button>
      )}
    </label>
  )
}
