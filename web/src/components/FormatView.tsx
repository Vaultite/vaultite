import { useEffect, useState, type ReactNode } from "react"
import { Catch } from "@/components/Guard"
import type { Store } from "@/core/data"
import { fileOf, readFile, stem } from "@/core/files"
import { isDesktop } from "@/core/platform"
import { useVaultChange } from "@/core/live"
import { formatFor } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { EmbedHead, rawUrl, useFill } from "@/components/FileViewers"
import { cn } from "@/lib/utils"
import { errorText } from "@/core/notify"
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
  const [text, setText] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (binary) return
    let on = true
    readFile(path).then((f) => on && setText(f.text)).catch(() => on && setText(null))
    return () => { on = false }
  }, [path, n, binary])
  useVaultChange(() => setN((x) => x + 1), [path])
  if (!format) return null
  const Icon = format.icon
  const draw = format.embed ?? format.render
  const box = ((format.layout ?? "box") === "box" || format.layout === "pane") && !(format.autoHeight && !height)
  const drawn = (binary || text !== null) && <FormatGuard>{draw({ store, path, text: text ?? "", ...(binary ? { url: rawUrl(path, { v: n }) } : {}), editable: false, place: "embed", onChange: () => {}, height, ...(sub ? { subpath: sub } : {}), ...(from ? { host: from } : {}) })}</FormatGuard>
  if (fill) return <div className="relative size-full overflow-auto" data-format-embed={path}>{drawn}</div>
  return (
    <div className="glass overflow-hidden rounded-[12px]" data-format-embed={path}>
      <EmbedHead path={path} icon={Icon} name={format.page ? fileOf(store, path)?.title ?? stem(path) : path.split("/").pop()!} />
      {box ? <div className="relative" style={{ height: height ?? 360 }}>{drawn || <Loading className="p-4" />}</div> : drawn || <div className="h-24 p-4"><Loading /></div>}
    </div>
  )
}

export const FormatGuard = ({ children }: { children: ReactNode }) => (
  <Catch fallback={(e) => <p className="p-4 text-[15px] text-muted-foreground">{errorText(e, "This file couldn't be drawn")} Source mode shows its text.</p>}>
    {children}
  </Catch>
)
