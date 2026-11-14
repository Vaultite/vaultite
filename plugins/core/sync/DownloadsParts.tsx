import { type ReactNode, useState } from "react"
import { ChevronRight, Trash2 } from "lucide-react"
import { menuFor, openFile, rawUrl, SwipeRow, type SwipeAction } from "@vaultite"
import type { Media, MediaKind } from "./phone.ts"
import { folderOf, KINDS, nameOf, size } from "./downloads.ts"

export function Storage({ used, cap, free, byKind }: { used: number; cap: number; free: number | null; byKind: { kind: MediaKind; name: string; tint: string; bytes: number }[] }) {
  const over = used > cap
  return (
    <section className="glass mb-4 rounded-card p-4" data-downloads-storage>
      <div className="flex items-baseline justify-between gap-3">
        <div className="num text-[28px] leading-[34px] font-semibold">{size(used)}</div>
        <div className="text-[15px] text-muted-foreground">of {size(cap)} cap</div>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-foreground/[0.08]" role="img" aria-label={`${size(used)} of ${size(cap)} used`}>
        {byKind.map((k) => k.bytes > 0 && <div key={k.kind} style={{ width: `${Math.min(100, (k.bytes / Math.max(cap, used)) * 100)}%`, background: k.tint }} className="h-full min-w-[3px] border-r border-card last:border-r-0" />)}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground max-md:text-[15px]">
        {byKind.filter((k) => k.bytes > 0).map((k) => (
          <span key={k.kind} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: k.tint }} />{k.name} {size(k.bytes)}</span>
        ))}
        <span className="ml-auto">{free === null ? "" : `${size(free)} free on this phone`}</span>
      </div>
      {over && <div className="mt-2 text-[13px] text-ink-(--red) max-md:text-[15px]">What you keep is more than the cap: raise the cap or keep less.</div>}
    </section>
  )
}

function Thumb({ path, kind }: { path: string; kind: (typeof KINDS)[number] }) {
  const [broken, setBroken] = useState(false), Icon = kind.icon
  if (kind.kind === "image" && !broken) return <img src={rawUrl(path)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="size-11 shrink-0 rounded-[8px] bg-foreground/[0.06] object-cover" />
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-[8px]" style={{ background: `color-mix(in srgb, ${kind.tint} 14%, transparent)`, color: kind.tint }}>
      <Icon className="size-5" strokeWidth={2} />
    </span>
  )
}

export function FileLine({ m, kind, remove }: { m: Media; kind: (typeof KINDS)[number]; remove: () => void }) {
  const swipe = (): SwipeAction[] => [{ label: "Remove", icon: Trash2, danger: true, removes: true, run: remove }]
  const menu = menuFor(() => [{ label: "Open", run: () => openFile(m.path) }, { label: "Remove from this phone", icon: Trash2, danger: true, run: remove }])
  return (
    <SwipeRow actions={swipe}>
      <button type="button" data-download={m.path} onClick={() => openFile(m.path)} onContextMenu={menu}
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 py-2 text-left active:bg-foreground/[0.04]">
        <Thumb path={m.path} kind={kind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-[20px] max-md:text-[17px] max-md:leading-[22px]">{nameOf(m.path)}</span>
          <span className="block truncate text-[13px] text-muted-foreground max-md:text-[15px] max-md:leading-[20px]">{folderOf(m.path)}</span>
        </span>
        <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums max-md:text-[15px]">{size(m.size)}</span>
        <ChevronRight className="-ml-1 size-4 shrink-0 text-tertiary" strokeWidth={2.5} />
      </button>
    </SwipeRow>
  )
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-1.5 px-1 text-[13px] font-semibold text-muted-foreground max-md:text-[15px]">{title}</h2>
      <div className="glass hairline rounded-card px-4">{children}</div>
    </section>
  )
}
