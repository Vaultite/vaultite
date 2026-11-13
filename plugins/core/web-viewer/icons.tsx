import { forwardRef } from "react"
import { Globe, type LucideIcon, type LucideProps } from "lucide-react"
import { cell, webPages } from "@vaultite"
import { hostOf } from "./address"
import { framedIcon } from "./framed"

const icons = cell(new Map<string, string>())
const setIcons = (f: (m: Map<string, string>) => void) => icons.update((m) => { const next = new Map(m); f(next); return next })
let wanted: Set<string> | null = null
function want(host: string) {
  if (!host || icons.get().has(host) || !webPages?.icons) return
  if (!wanted) {
    wanted = new Set()
    queueMicrotask(() => {
      const hosts = [...wanted!]
      wanted = null
      setIcons((m) => { for (const h of hosts) m.set(h, "") })
      void webPages!.icons!(hosts).then((r) => setIcons((m) => {
        for (const h of hosts) { const v = r?.[h]; if (typeof v === "string" && v.startsWith("data:image/") && !m.get(h)) m.set(h, v) }
      }), () => setIcons((m) => { for (const h of hosts) m.delete(h) }))
    })
  }
  wanted.add(host)
}

export function iconKey(url: string) {
  try {
    const u = new URL(url), host = u.host.replace(/^www\./, ""), seg = u.pathname.split("/")[1] ?? ""
    return seg ? `${host}/${seg}` : host
  } catch { return hostOf(url) }
}

export function iconCame(key: string, icon: string) {
  if (!key || typeof icon !== "string" || icons.get().get(key) === icon) return
  if (icon && !icon.startsWith("data:image/")) return
  setIcons((m) => { m.set(key, icon) })
}

function useIcon(keys: string[]) {
  for (const k of keys) want(k)
  const id = keys.join(" ")
  return icons.use((m) => { for (const k of id.split(" ")) { const v = m.get(k); if (v) return v } return "" }) || framedIcon(keys[keys.length - 1])
}

export function SiteIcon({ host, url, className }: { host?: string; url?: string; className?: string }) {
  const site = host ?? (url ? hostOf(url) : ""), own = url ? iconKey(url) : site
  const src = useIcon(own === site ? [site] : [own, site])
  return src
    ? <img src={src} alt="" draggable={false} className={`${className ?? ""} object-contain`}
        onError={() => setIcons((m) => { for (const k of [own, site]) if (m.get(k) === src) m.set(k, "") })} />
    : <Globe className={className} strokeWidth={1.75} />
}

const components = new Map<string, LucideIcon>()
export function siteIcon(url: string, color?: string): LucideIcon {
  const page = `https://${iconKey(url)}`, key = `${iconKey(url)} ${color ?? ""}`
  let c = components.get(key)
  if (!c) {
    c = forwardRef<SVGSVGElement, LucideProps>(({ className }, _ref) => color
      ? <span className={`${className ?? ""} relative inline-grid`} data-container-tint>
          <SiteIcon url={page} className="size-full" />
          <span data-container-line className="absolute inset-x-0 -bottom-[3px] h-[2px] rounded-full" style={{ background: color }} />
        </span>
      : <SiteIcon url={page} className={className} />)
    components.set(key, c)
  }
  return c
}

const spinners = new Map<string, LucideIcon>()
export function spinnerIcon(color?: string): LucideIcon {
  const key = color ?? ""
  let c = spinners.get(key)
  if (!c) {
    c = forwardRef<SVGSVGElement, LucideProps>(({ className }, _ref) => (
      <span className={`${className ?? ""} relative inline-grid text-muted-foreground`} data-web-loading>
        <svg viewBox="0 0 16 16" className="size-full motion-safe:animate-spin" fill="none" strokeWidth={2} strokeLinecap="round">
          <circle cx="8" cy="8" r="6" stroke="currentColor" opacity={0.25} />
          <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" />
        </svg>
        {color && <span data-container-line className="absolute inset-x-0 -bottom-[3px] h-[2px] rounded-full" style={{ background: color }} />}
      </span>
    ))
    spinners.set(key, c)
  }
  return c
}
