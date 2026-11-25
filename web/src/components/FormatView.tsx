import { useState, type ReactNode } from "react"
import { Catch } from "@/components/Guard"
import type { Store } from "@/core/data"
import { fileOf, readFile, stem } from "@/core/files"
import { isDesktop } from "@/core/platform"
import { useVaultChange } from "@/core/live"
import { useRead } from "@/core/reading"
import { formatFor } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { EmbedHead, rawUrl, useFill } from "@/components/FileViewers"
import { cn } from "@/lib/utils"
import { errorText } from "@/core/notify"
import { viewStill } from "@/core/viewer"
import { Loading } from "@/components/kit"

export function FormatBox({ place, children }: { place: "page" | "sheet"; children: ReactNode }) {
  const fill = place === "page" && isDesktop()
  const [ref, h] = useFill(fill)
  return (
    <div ref={ref} className={cn("relative overflow-hidden rounded-[10px] border-[0.5px] border-border", !fill && "h-[70vh]")}
      style={h ? { height: h } : undefined} data-format-box>
      <FormatGuard>{children}</FormatGuard>
    </div>
  )
}

export function FormatEmbed({ store, path, height, fill, sub, from }: { store: Store; path: string; height?: number; fill?: boolean; sub?: string; from?: string }) {
  const { disabled } = usePrefs()
  const format = formatFor(path, disabled)?.format
  const binary = !!format?.binary
  const [n, setN] = useState(0)
  const read = useRead(binary ? null : () => readFile(path).then((f) => f.text), [path, n, binary])
  const text = binary ? null : read.value ?? null
  useVaultChange(() => setN((x) => x + 1), [path])
  const waiting = <Loading className="p-4" error={read.error !== undefined && errorText(read.error, "Couldn't show this file")} />
  if (!format) return null
  const Icon = format.icon
  const draw = format.embed ?? format.render
  const box = ((format.layout ?? "box") === "box" || format.layout === "pane") && !(format.autoHeight && !height)
  const drawn = (binary || text !== null) && <FormatGuard>{draw({ store, path, text: text ?? "", ...(binary ? { url: rawUrl(path, { v: n }) } : {}), editable: false, place: "embed", onChange: () => {}, height, ...(sub ? { subpath: sub } : {}), ...(from ? { host: from } : {}) })}</FormatGuard>
  if (fill) return <div className="relative size-full overflow-auto" data-format-embed={path}>{drawn}</div>
  return (
    <div className="glass overflow-hidden rounded-[12px]" data-format-embed={path} onClick={(e) => viewStill(e.target, e.currentTarget)}>
      <EmbedHead path={path} icon={Icon} name={format.page ? fileOf(store, path)?.title ?? stem(path) : path.split("/").pop()!} />
      {box ? <div className="relative" style={{ height: height ?? 360 }}>{drawn || waiting}</div> : drawn || <div className="h-24">{waiting}</div>}
    </div>
  )
}

export const FormatGuard = ({ children }: { children: ReactNode }) => (
  <Catch fallback={(e) => <p className="p-4 text-[15px] text-muted-foreground">{errorText(e, "This file couldn't be drawn")} Source mode shows its text.</p>}>
    {children}
  </Catch>
)
