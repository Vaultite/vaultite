import { useEffect, useRef, useState } from "react"
import { SquareArrowOutUpRight } from "lucide-react"
import { openFile } from "@/core/files"
import { afterSheets, closeDetail } from "@/core/nav"
import { isDesktop } from "@/core/platform"
import type { Size } from "@/core/panzoom"
import { viewed } from "@/core/viewer"
import { SheetActions } from "@/components/DetailSheet"
import { ImageView, useFileInfo } from "@/components/FileViewers"
import { ZoomImage, ZoomView } from "@/components/ZoomView"

export default function Viewer({ id }: { id: string }) {
  return id.startsWith("~") ? <Kept id={id} /> : <OfFile path={id} />
}

function OfFile({ path }: { path: string }) {
  const [info, v, missing] = useFileInfo(path)
  return (
    <>
      <SheetActions>
        <button type="button" data-opens aria-label="Open in new tab" data-tip="Open in new tab" onClick={() => afterSheets(() => openFile(path, { newTab: true }))}
          className="grid size-11 cursor-pointer place-items-center text-muted-foreground transition-colors hover:text-foreground active:opacity-50">
          <SquareArrowOutUpRight className={isDesktop() ? "size-4" : "size-5"} strokeWidth={2.25} />
        </button>
      </SheetActions>
      {missing ? <p className="p-6 text-center text-[15px] text-muted-foreground">This image isn't in the vault any more.</p>
        : <ImageView path={path} info={info} v={v} page focus />}
    </>
  )
}

function Kept({ id }: { id: string }) {
  const [what] = useState(() => viewed(id))
  const [size, setSize] = useState<Size | null>(null)
  const [failed, setFailed] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!what) closeDetail() }, [what])
  useEffect(() => {
    if (!what || !("svg" in what)) return
    Object.assign(what.svg.style, { width: "100%", height: "100%", maxWidth: "none", display: "block" })
    host.current?.replaceChildren(what.svg)
  }, [what])
  if (!what) return null
  if ("svg" in what) return <ZoomView size={what.size} vector label={what.name} focus><div ref={host} className="mermaid-diagram size-full !p-0" /></ZoomView>
  if (failed) return <p className="p-6 text-center text-[15px] text-muted-foreground">This image couldn't be loaded.</p>
  return <ZoomImage src={what.url} label={what.name} vector={/^data:image\/svg|\.svg($|\?)/i.test(what.url)} size={size} onSize={setSize} onError={() => setFailed(true)} focus />
}
