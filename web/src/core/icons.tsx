import { forwardRef } from "react"
import type { LucideIcon, LucideProps } from "lucide-react"
import { signal } from "@/core/signal"

let lucide: Record<string, LucideIcon> | null = null
let loading: Promise<Record<string, LucideIcon>> | null = null
const subs = signal()

function loadLucide() {
  return (loading ??= import("lucide-react/dist/esm/icons/index.mjs").then((m) => {
    lucide = m as unknown as Record<string, LucideIcon>
    subs.notify()
    return lucide
  }))
}
const useLucide = () => subs.use(() => lucide)

const pascal = (name: string) => {
  const c = name.replace(/^([A-Z])|[\s-_]+(\w)/g, (_m, p1: string, p2: string) => (p2 ? p2.toUpperCase() : p1.toLowerCase()))
  return c.charAt(0).toUpperCase() + c.slice(1)
}

export const isEmoji = (s: string) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s) && [...s].length <= 10 && !/[\p{L}\p{N}]{2}/u.test(s)

const made = new Map<string, LucideIcon>()

export function anyIcon(name: string): LucideIcon | null {
  const had = made.get(name)
  if (had) return had
  let icon: LucideIcon
  if (isEmoji(name)) {
    icon = forwardRef<SVGSVGElement, LucideProps>(({ size = 24, color: _c, strokeWidth: _s, absoluteStrokeWidth: _a, ...rest }, ref) => (
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...rest}>
        <text x="12" y="13" textAnchor="middle" dominantBaseline="central" fontSize="20">{name}</text>
      </svg>
    )) as LucideIcon
  } else {
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) return null
    void loadLucide()
    icon = forwardRef<SVGSVGElement, LucideProps>((props, ref) => {
      const Icon = useLucide()?.[pascal(name)]
      const { size = 24, className } = props
      return Icon ? <Icon ref={ref} {...props} /> : <svg ref={ref} width={size} height={size} className={className} aria-hidden="true" />
    }) as LucideIcon
  }
  made.set(name, icon)
  return icon
}

/** A brand's mark (Lucide has none: GitHub, Claude) drawn like a lucide icon: one filled path in 24x24, so strokeWidth is
 *  ignored. A plugin makes its icon with it inside a function, `((p) => <BrandIcon d={PATH} {...p} />) as LucideIcon`. */
export function BrandIcon({ d, fillRule, size = 24, strokeWidth: _s, absoluteStrokeWidth: _a, ...rest }: LucideProps & { d: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
      <path d={d} fillRule={fillRule} />
    </svg>
  )
}

/** GitHub's mark: a project's repository, a plugin's on GitHub. */
export const GitHubIcon = ((p) => <BrandIcon d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" {...p} />) as LucideIcon

const marks = new Map<string, LucideIcon>()
export function markIcon(data: string): LucideIcon {
  let icon = marks.get(data)
  if (!icon) {
    const mask = `url("${data}") center / contain no-repeat`
    icon = forwardRef<SVGSVGElement, LucideProps>(({ size = 24, className, style }, ref) => (
      <svg ref={ref} width={size} height={size} className={className} aria-hidden="true"
        style={{ ...style, background: "currentColor", mask, WebkitMask: mask }} />
    )) as LucideIcon
    marks.set(data, icon)
  }
  return icon
}

export const loadIconTags = () => import("./lucide-tags.json").then((m) => m.default as Record<string, string[]>)
