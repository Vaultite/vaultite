// A canvas web page card drawn like a link unfurl from /api/canvas/link; the host and address until that answers.
import { useState } from "react"
import { Globe } from "lucide-react"
import { cn, useLive } from "@vaultite"
import type { LinkPreview } from "./preview"

const hostOf = (url: string) => { try { return new URL(url).host.replace(/^www\./, "") } catch { return url } }
const isWeb = (url: string) => /^https?:\/\//i.test(url)

/** A picture from another site: lazy, sent no referrer, not draggable, gone if it fails to load. */
function Remote({ src, className, onFail }: { src: string; className: string; onFail?: () => void }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (failed === src) return null
  return <img src={src} alt="" draggable={false} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={className}
    onError={() => { setFailed(src); onFail?.() }} />
}

/** The page's address as a small link that opens in a new tab (the click doesn't reach the board). */
function Address({ url }: { url: string }) {
  return <a href={url} target="_blank" rel="noopener noreferrer" className="block shrink-0 truncate text-[11.5px] text-primary hover:underline"
    onClick={(e) => e.stopPropagation()}>{url}</a>
}

/** Text cut to `lines` lines with an ellipsis (0: not shown). */
const clamp = (lines: number) => ({ display: "-webkit-box", WebkitBoxOrient: "vertical" as const, WebkitLineClamp: lines, overflow: "hidden" })

export function LinkCard({ url, width, height }: { url: string; width: number; height: number }) {
  const { data } = useLive<LinkPreview>(isWeb(url) ? `canvas/link?url=${encodeURIComponent(url)}` : null)
  const [noImage, setNoImage] = useState<string | null>(null)
  const [noIcon, setNoIcon] = useState<string | null>(null)
  const host = hostOf(url)
  const p = data?.url === url.trim() && (data.title || data.description) ? data : null

  if (!p) {
    return (
      <div className="flex size-full flex-col justify-center gap-1 overflow-hidden rounded-[inherit] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-[14px] font-semibold"><Globe className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{host}</span></div>
        <Address url={url} />
      </div>
    )
  }

  const image = p.image && p.image !== noImage ? p.image : null
  const top = !!image && height >= 220 && width >= 200 // the image across the top, filling what the text leaves
  const side = !!image && !top && width >= 360 && height >= 96 // a thumbnail on the right
  const icon = p.icon && p.icon !== noIcon ? p.icon : null
  // Lines of description that fit: what's left of the card after its padding, site, title (two lines) and address.
  const lines = top ? (height >= 320 ? 2 : height >= 260 ? 1 : 0) : Math.max(0, Math.min(8, Math.floor((height - 24 - 18 - (p.title ? 40 : 0) - 18 - 12) / 17)))

  return (
    <div className="flex size-full flex-col overflow-hidden rounded-[inherit]">
      {top && image && (
        <div className="min-h-0 flex-1 overflow-hidden border-b border-border bg-muted">
          <Remote src={image} className="size-full object-cover" onFail={() => setNoImage(image)} />
        </div>
      )}
      <div className={cn("flex min-h-0 gap-3 px-4 py-3", top ? "shrink-0" : "flex-1")}>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex min-w-0 shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
            {icon ? <Remote src={icon} className="size-4 shrink-0 rounded-[3px] object-contain" onFail={() => setNoIcon(icon)} /> : <Globe className="size-3.5 shrink-0" />}
            <span className="truncate">{p.site || host}</span>
          </div>
          {p.title && <div className="shrink-0 text-[14px] leading-[1.35] font-semibold" style={clamp(2)}>{p.title}</div>}
          {p.description && lines > 0 && <div className="text-[12.5px] leading-[1.35] text-muted-foreground" style={clamp(lines)}>{p.description}</div>}
          <Address url={url} />
        </div>
        {side && image && (
          <div className="shrink-0 self-center overflow-hidden rounded-[6px] border border-border bg-muted" style={{ width: Math.min(120, height - 24), height: Math.min(120, height - 24) }}>
            <Remote src={image} className="size-full object-cover" onFail={() => setNoImage(image)} />
          </div>
        )}
      </div>
    </div>
  )
}
