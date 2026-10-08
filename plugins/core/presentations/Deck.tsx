// A .pptx drawn read-only like PowerPoint (pptx-renderer, its own chunk), far slides not kept drawn. The file is
// untrusted: the renderer escapes text, filters link protocols and limits what the zip may unpack.
import { useEffect, useRef, useState } from "react"
import { Loading, openWebLink } from "@vaultite"

export default function Deck({ url, embed }: { url: string; embed?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"loading" | "ok" | string>("loading")
  const [count, setCount] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const stop = new AbortController()
    let viewer: { destroy: () => void; slideCount: number } | null = null
    setState("loading")
    ;(async () => {
      const [{ PptxViewer, RECOMMENDED_ZIP_LIMITS }, bytes] = await Promise.all([
        import("@aiden0z/pptx-renderer"),
        fetch(url, { signal: stop.signal }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText)))),
      ])
      if (stop.signal.aborted) return
      // (scrolled by the pane, or by the embed's own box)
      const scroller = embed ? el.parentElement! : el.closest<HTMLElement>("[data-pane]") ?? undefined
      viewer = await PptxViewer.open(bytes, el, {
        zipLimits: RECOMMENDED_ZIP_LIMITS, fitMode: "contain", lazyMedia: true, lazySlides: true, pdfjs: false,
        scrollContainer: scroller, renderMode: "list", signal: stop.signal,
        listOptions: { windowed: true, initialSlides: 3, batchSize: 3 },
      })
      if (stop.signal.aborted) { viewer.destroy(); return }
      setCount(viewer.slideCount)
      setState("ok")
    })().catch((e) => { if (!stop.signal.aborted) setState(String(e?.message ?? e)) })
    return () => { stop.abort(); viewer?.destroy() }
  }, [url, embed])
  // Links: web ones open like the app's; nothing else runs.
  const click = (e: React.MouseEvent) => {
    const a = (e.target as Element).closest?.("a[href]")
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute("href") ?? ""
    if (/^https?:/i.test(href)) openWebLink(href, e.metaKey || e.ctrlKey)
  }
  return (
    <div className={embed ? "max-h-[520px] overflow-auto" : undefined} data-deck={count || undefined}>
      {state === "loading" && <Loading />}
      {state !== "loading" && state !== "ok" && <p className="p-4 text-[15px] text-muted-foreground">This deck couldn't be read: {state}.</p>}
      <div ref={box} onClick={click} className="[&_.pptx-slide]:shadow-sm" />
    </div>
  )
}
