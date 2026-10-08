// A Word document drawn with docx-preview in a shadow root, so its styles and the app's don't touch. The file is
// untrusted: embedded HTML isn't drawn and links never run (web links open like any other).
import { useEffect, useRef, useState } from "react"
import { Loading, openWebLink } from "@vaultite"

/** Pages are drawn at their size (in CSS pixels) and scaled to the box's width when it's narrower. */
const STYLE = `
  :host { display: block; }
  .docx-wrapper { background: transparent !important; padding: 8px 0 24px !important; align-items: center; }
  .docx-wrapper > section.docx { box-shadow: 0 0 0 0.5px var(--border), 0 2px 14px color-mix(in srgb, var(--foreground) 8%, transparent) !important; margin-bottom: 16px !important; }
`

export default function Docx({ url, embed }: { url: string; embed?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
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
      await renderAsync(bytes, body, body, {
        inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, renderAltChunks: false, renderComments: false,
        renderChanges: false, experimental: true, className: "docx",
      })
      if (!on) return
      for (const st of body.querySelectorAll("style")) st.textContent = bullets(st.textContent ?? "")
      for (const a of body.querySelectorAll("a[href]")) {
        const href = a.getAttribute("href") ?? ""
        if (!/^(https?:|mailto:|#)/i.test(href)) a.removeAttribute("href")
      }
      fit(el, body)
      setState("ok")
    })().catch((e) => { if (on) setState(String(e?.message ?? e)) })
    return () => { on = false }
  }, [url])
  // Narrower than its pages: scaled to fit.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => { const b = el.shadowRoot?.lastElementChild; if (b instanceof HTMLElement) fit(el, b) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Links: web ones open like the app's, the document's own scroll to their place, nothing else runs.
  const click = (e: React.MouseEvent) => {
    const a = (e.nativeEvent.composedPath().find((n) => n instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined)
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute("href") ?? ""
    if (/^https?:/i.test(href)) openWebLink(href, e.metaKey || e.ctrlKey)
    else if (/^mailto:/i.test(href)) window.open(href, "_blank", "noopener")
    else if (href.startsWith("#")) host.current?.shadowRoot?.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: "start" })
  }
  return (
    <div className={embed ? "max-h-[520px] overflow-auto" : undefined}>
      {state === "loading" && <Loading />}
      {state !== "loading" && state !== "ok" && <p className="p-4 text-[15px] text-muted-foreground">This document couldn't be read: {state}.</p>}
      <div ref={host} onClick={click} data-docx />
    </div>
  )
}

/** Word's bullets are Symbol and Wingdings letters (private-use code points, U+F0B7 for •), which only those fonts
 *  draw: as the Unicode bullets they stand for. */
const SYMBOLS: Record<string, string> = { "\uf0b7": "•", "\uf0a7": "▪", "\uf0d8": "➢", "\uf076": "❖", "\uf0fc": "✓", "\uf0a8": "□", "\uf06e": "■", "\uf075": "◆", "\uf0e0": "➔" }
const bullets = (css: string) => css.replace(/content:\s*"([^"]*)"/g, (all, text: string) =>
  /[\uf020-\uf0ff]/.test(text) ? `content: "${text.replace(/[\uf020-\uf0ff]/g, (c) => SYMBOLS[c] ?? "•")}"` : all)

/** Scale the pages to the host's width (never up). */
function fit(host: HTMLElement, body: HTMLElement) {
  const page = body.querySelector<HTMLElement>("section.docx")
  const wrapper = body.querySelector<HTMLElement>(".docx-wrapper")
  if (!page || !wrapper) return
  wrapper.style.zoom = ""
  const room = host.clientWidth, need = page.offsetWidth + 16
  if (room > 0 && need > room) wrapper.style.zoom = String(room / need)
}
