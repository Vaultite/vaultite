import { useCallback, useEffect, useRef, useState } from "react"
import { linkClick, Loading, openWebLink, usePageZoom } from "@vaultite"
import { disarmLinks, DRAWN, linkOf } from "./untrusted"

const STYLE = `
  :host { display: block; }
  .docx-wrapper { background: transparent !important; padding: 8px 0 24px !important; align-items: center; }
  .docx-wrapper > section.docx { box-shadow: 0 0 0 0.5px var(--border), 0 2px 14px color-mix(in srgb, var(--foreground) 8%, transparent) !important; margin-bottom: 16px !important; }
`

function useFitPages(keys: boolean) {
  const host = useRef<HTMLDivElement>(null), pages = useRef<HTMLDivElement>(null), zoom = useRef(1)
  const refit = useCallback(() => { const el = host.current, b = el?.shadowRoot?.lastElementChild; if (el && b instanceof HTMLElement) fit(el, b, zoom.current) }, [])
  usePageZoom(pages, (z) => { zoom.current = z; refit() }, keys)
  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(refit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [refit])
  return { host, pages, refit }
}

export default function Docx({ url, embed }: { url: string; embed?: boolean }) {
  const { host, pages, refit } = useFitPages(!embed)
  const [state, setState] = useState<"loading" | "ok" | string>("loading")
  useEffect(() => {
    const el = host.current
    if (!el) return
    let on = true
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" })
    root.replaceChildren()
    const style = document.createElement("style")
    style.textContent = STYLE
    const body = document.createElement("div")
    root.append(style, body)
    setState("loading")
    ;(async () => {
      const [{ renderAsync }, bytes] = await Promise.all([
        import("docx-preview"),
        fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText)))),
      ])
      if (!on) return
      await renderAsync(bytes, body, body, DRAWN)
      if (!on) return
      for (const st of body.querySelectorAll("style")) st.textContent = bullets(st.textContent ?? "")
      disarmLinks(body)
      refit()
      setState("ok")
    })().catch((e) => { if (on) setState(String(e?.message ?? e)) })
    return () => { on = false }
  }, [url, host, refit])
  const click = (e: React.MouseEvent) => {
    const a = e.nativeEvent.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement)
    if (!a) return
    e.preventDefault()
    const link = linkOf(a.getAttribute("href") ?? "")
    if (link?.to === "web") openWebLink(link.href, linkClick(e))
    else if (link?.to === "mail") window.open(link.href, "_blank", "noopener")
    else if (link?.to === "place") host.current?.shadowRoot?.getElementById(decodeURIComponent(link.id))?.scrollIntoView({ block: "start" })
  }
  return (
    <div ref={pages} className={embed ? "max-h-[520px] overflow-auto" : "overflow-x-auto"}>
      {state === "loading" && <Loading />}
      {state !== "loading" && state !== "ok" && <p className="p-4 text-[15px] text-muted-foreground">This document couldn't be read: {state}.</p>}
      <div ref={host} onClick={click} data-docx className="select-text" />
    </div>
  )
}

// Word's bullets are Symbol and Wingdings private-use code points (U+F0B7 for •) that only those fonts draw
const SYMBOLS: Record<string, string> = { "\uf0b7": "•", "\uf0a7": "▪", "\uf0d8": "➢", "\uf076": "❖", "\uf0fc": "✓", "\uf0a8": "□", "\uf06e": "■", "\uf075": "◆", "\uf0e0": "➔" }
const bullets = (css: string) => css.replace(/content:\s*"([^"]*)"/g, (all, text: string) =>
  /[\uf020-\uf0ff]/.test(text) ? `content: "${text.replace(/[\uf020-\uf0ff]/g, (c) => SYMBOLS[c] ?? "•")}"` : all)

function fit(host: HTMLElement, body: HTMLElement, zoom: number) {
  const page = body.querySelector<HTMLElement>("section.docx")
  const wrapper = body.querySelector<HTMLElement>(".docx-wrapper")
  if (!page || !wrapper) return
  wrapper.style.zoom = ""
  const room = host.clientWidth, need = page.offsetWidth + 16
  if (room <= 0) return
  const k = Math.min(1, room / need) * zoom
  wrapper.style.zoom = k === 1 ? "" : String(k)
  wrapper.style.width = k * need > room ? "max-content" : ""
}
