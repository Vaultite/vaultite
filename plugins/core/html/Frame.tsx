// An artifact in a sandboxed iframe, this side answering its bridge (reads, file list, storage, links, height, theme).
// A file it read changing tells it (`vau.on("change")`) or reloads it, so pages stay live.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { cn, getStore, isHidden, openFile, readFile, stem, tintNames, touches, useVaultChange } from "@vaultite"

// The app's colours an artifact can use, as --vau-<name> (so they follow the colour scheme), and plugins' tints
// (--vau-today...).
const TOKENS = [
  "background", "foreground", "card", "card-foreground", "muted", "muted-foreground", "border", "primary",
  "primary-foreground", "accent", "accent-foreground", "red", "orange", "yellow", "green", "teal", "blue", "indigo",
  "purple", "pink", "gray", "h1", "h2", "h3", "h4", "h5", "h6", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
  "font-sans", "radius",
]

const isDark = () => document.documentElement.classList.contains("dark")

function themeMessage() {
  const css = getComputedStyle(document.documentElement)
  const vars: Record<string, string> = {}
  for (const t of [...TOKENS, ...tintNames()]) {
    const v = css.getPropertyValue(`--${t}`).trim()
    if (v) vars[t] = v
  }
  return { vau: 1, type: "theme", dark: isDark(), scheme: document.documentElement.dataset.scheme ?? "default", vars }
}

const src = (path: string, embed: boolean, n: number) =>
  `v/${path.split("/").map(encodeURIComponent).join("/")}?theme=${isDark() ? "dark" : "light"}&scheme=${document.documentElement.dataset.scheme ?? "default"}${embed ? "&embed=1" : ""}${n ? `&r=${n}` : ""}`

export function ArtifactFrame({ path, page, height, fill, className }: {
  path: string
  /** The file itself, opened: at least as tall as the window below it. Otherwise it's shown inside another file. */
  page?: boolean
  /** A fixed height (an embed's `![[x.html|400]]`); otherwise the frame is as tall as what it draws. */
  height?: number
  /** As tall as its parent's box (a canvas card), whatever it draws. */
  fill?: boolean
  className?: string
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [reloads, setReloads] = useState(0)
  const [url, setUrl] = useState(() => src(path, !page, 0))
  const [h, setH] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [min, setMin] = useState(page ? 480 : 0)
  const reads = useRef(new Map<string, number | null>())
  const listening = useRef(false)
  const growth = useRef<number[]>([])

  // The theme is read when the frame loads (no flash); later changes are sent to it.
  useEffect(() => { setUrl(src(path, !page, reloads)); setReady(false); reads.current.clear(); listening.current = false }, [path, page, reloads])
  const sendTheme = useCallback(() => frame.current?.contentWindow?.postMessage(themeMessage(), "*"), [])
  // The app's light or dark (the .dark class) and its scheme (data-scheme) and fonts (style), on <html>: sent again
  // when they change, after the app has applied them.
  useEffect(() => {
    let t = 0
    const on = () => { cancelAnimationFrame(t); t = requestAnimationFrame(sendTheme) }
    const watch = new MutationObserver(on)
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-scheme", "style"] })
    return () => { watch.disconnect(); cancelAnimationFrame(t) }
  }, [sendTheme])

  // Opened as a page: at least down to the bottom of the window.
  useLayoutEffect(() => {
    if (!page) return
    const fit = () => {
      const top = frame.current?.getBoundingClientRect().top ?? 0
      setMin(Math.max(320, window.innerHeight - Math.max(0, top) - 16))
    }
    fit()
    addEventListener("resize", fit)
    return () => removeEventListener("resize", fit)
  }, [page])

  // Show it once it has drawn (the bridge says so), or after a moment anyway.
  useEffect(() => {
    if (ready) return
    const t = setTimeout(() => setReady(true), 1500)
    return () => clearTimeout(t)
  }, [ready, url])

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow
      if (!win || e.source !== win) return
      const d = e.data
      if (!d || d.vau !== 1) return
      const reply = (value?: unknown, error?: string) => win.postMessage({ vau: 1, type: "reply", id: d.id, value, error }, "*")
      // A page from outside the
      // vault (an absolute path) is anyone's: it gets nothing of the vault, keeps no storage, and opens only web links.
      const outside = path.startsWith("/")
      if (d.type === "ready") { setReady(true); sendTheme() }
      else if (d.type === "height" && typeof d.h === "number") {
        // A page that's always a bit taller than its frame (100vh plus a margin) would grow forever: stop it.
        const now = Date.now()
        growth.current = [...growth.current.filter((t) => now - t < 1000), now]
        setH((cur) => (cur !== null && d.h > cur && growth.current.length > 6 ? cur : d.h))
      } else if (d.type === "listening") listening.current = true
      else if (d.type === "state" && d.data && typeof d.data === "object" && !outside) {
        fetch("api/artifact/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, data: d.data }) })
          .catch(() => { /* offline: it's kept until the next save */ })
      } else if (d.type === "open") {
        if (typeof d.url === "string" && /^(https?|mailto):/i.test(d.url)) window.open(d.url, "_blank", "noopener,noreferrer")
        else if (typeof d.path === "string" && d.path && !isHidden(d.path) && !outside) openFile(d.path, { newTab: !page })
      } else if (d.type === "ask") {
        if (outside) return reply(undefined, "a page from outside the vault can't read the vault")
        const args = (d.args ?? {}) as Record<string, unknown>
        if (d.op === "read") {
          const p = String(args.path ?? "")
          if (!p || isHidden(p)) return reply(undefined, `can't read '${p}'`)
          try {
            const f = await readFile(p)
            reads.current.set(p, f.mtime)
            reply(f.text)
          } catch {
            reads.current.set(p, null)
            reply(undefined, `no file '${p}' in the vault`)
          }
        } else if (d.op === "files") {
          const pre = String(args.prefix ?? "")
          const s = getStore()
          const all = s ? [...s.files.files, ...s.files.others] : []
          reply(all.filter((f) => f.path.startsWith(pre) && !isHidden(f.path)).map((f) => ({ path: f.path, mtime: f.mtime, size: f.size })))
        } else reply(undefined, `unknown request '${d.op}'`)
      }
    }
    addEventListener("message", onMessage)
    return () => removeEventListener("message", onMessage)
  }, [path, page, sendTheme])

  // Live: when the server says files changed (core/live.ts), the ones it read are checked (their mtimes, so the app's
  // own no-op writes don't count): it's told, or reloaded. Its own file changing reloads it.
  const self = useRef<number | null | undefined>(undefined)
  const stat = async (paths: string[]): Promise<Record<string, number | null> | null> => {
    try {
      const r = await fetch("api/artifact/stat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths }) })
      return await r.json()
    } catch { return null }
  }
  useEffect(() => { self.current = undefined; stat([path]).then((now) => { if (now && self.current === undefined) self.current = now[path] ?? null }) }, [path])
  useVaultChange(async (paths) => {
    const mine = touches(paths, path)
    const read = [...reads.current.keys()].filter((p) => touches(paths, p))
    if (!mine && !read.length) return
    const now = await stat(mine ? [path, ...read] : read)
    if (!now) return
    if (mine && (now[path] ?? null) !== self.current) {
      const first = self.current === undefined
      self.current = now[path] ?? null
      if (!first) return setReloads((n) => n + 1)
    }
    const changed = read.filter((p) => reads.current.has(p) && (now[p] ?? null) !== reads.current.get(p))
    if (!changed.length) return
    for (const p of changed) reads.current.set(p, now[p] ?? null)
    if (listening.current) frame.current?.contentWindow?.postMessage({ vau: 1, type: "change", paths: changed }, "*")
    else setReloads((n) => n + 1)
  })

  const shown = height ?? Math.max(h ?? (page ? 0 : 160), min)
  return (
    <iframe ref={frame} src={url} title={stem(path)}
      sandbox="allow-scripts allow-modals allow-downloads allow-pointer-lock"
      referrerPolicy="no-referrer" loading={page ? "eager" : "lazy"}
      className={cn("block w-full border-0 bg-transparent transition-opacity duration-150", ready ? "opacity-100" : "opacity-0", className)}
      style={{ height: fill ? "100%" : shown, colorScheme: isDark() ? "dark" : "light" }} />
  )
}
