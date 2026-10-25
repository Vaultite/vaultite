// An artifact in a sandboxed iframe, this side answering its bridge (reads, file list, storage, links, height, theme).
// A file it read changing tells it (`vau.on("change")`) or reloads it, so pages stay live.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { cn, confirmDialog, getStore, isHidden, notifyError, onLook, openFile, readFile, share, stem, tintNames, touches, useVaultChange } from "@vaultite"

// Every view of one artifact (here and in the app's other windows) hears the others' db and storage writes.
type Peer = (m: Record<string, unknown>) => void
const peers = new Map<string, Set<Peer>>()
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("vaultite-artifacts")
if (channel) channel.onmessage = (e) => peers.get(e.data?.path)?.forEach((f) => f(e.data.msg))
const tell = (path: string, msg: Record<string, unknown>, self: Peer) => {
  peers.get(path)?.forEach((f) => f !== self && f(msg))
  channel?.postMessage({ path, msg })
}
const postJson = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const failed = async (r: Response) => { try { return (await r.json()) ?? {} } catch { return {} } }

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
  // Asking Claude: declined once, it stays declined while this view is open; the calls running, by their ask.
  const declined = useRef(false)
  const asking = useRef(new Map<number, WebSocket>())
  useEffect(() => { declined.current = false }, [path])

  // The theme is read when the frame loads (no flash); later changes are sent to it.
  useEffect(() => { setUrl(src(path, !page, reloads)); setReady(false); reads.current.clear(); listening.current = false }, [path, page, reloads])
  const sendTheme = useCallback(() => frame.current?.contentWindow?.postMessage(themeMessage(), "*"), [])
  // The app's light or dark, scheme, theme, snippets and fonts: sent again when they change, once applied.
  useEffect(() => {
    let t = 0
    const off = onLook(() => { cancelAnimationFrame(t); t = requestAnimationFrame(sendTheme) })
    return () => { off(); cancelAnimationFrame(t) }
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
      const reply = (value?: unknown, error?: string, code?: string, more?: Record<string, unknown>) =>
        win.postMessage({ vau: 1, type: "reply", id: d.id, value, error, code, more }, "*")
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
      else if (d.type === "state" && d.data && typeof d.data === "object" && !outside && !share) {
        fetch("api/artifact/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, data: d.data }) })
          .catch(() => { /* offline: it's kept until the next save */ })
      } else if (d.type === "open") {
        // (a shared folder's page opens no address for its guest: it would carry what it read out)
        if (typeof d.url === "string" && /^(https?|mailto):/i.test(d.url)) { if (!share) window.open(d.url, "_blank", "noopener,noreferrer") }
        else if (typeof d.path === "string" && d.path && !isHidden(d.path) && !outside) openFile(d.path, { newTab: !page })
      } else if (d.type === "abort") asking.current.get(d.id)?.close()
      else if (d.type === "ask") {
        if (outside) return reply(undefined, "a page from outside the vault can't read the vault")
        // (a shared folder's page, for its guest: it asks the app nothing)
        if (share) return reply(undefined, "a shared folder's page reads nothing of the vault", "unavailable")
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
        } else if (d.op === "consent") {
          if (declined.current) return reply(false)
          const ok = await confirmDialog({
            title: `Let ${String(args.title || stem(path))} ask Claude?`,
            body: "It runs Claude Code on this machine, with your account and usage, and sends only what the page writes. It's asked once for this page.",
            confirm: "Allow", cancel: "Don't allow",
          })
          if (!ok) { declined.current = true; return reply(false) }
          const r = await postJson("api/artifact/allow", { path }).catch(() => null)
          if (!r?.ok) { notifyError(new Error((await (r ? failed(r) : {})).error ?? "offline"), "Couldn't allow it"); return reply(false) }
          reply(true)
        } else if (d.op === "sample") {
          const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${new URL("api/artifact/sample", location.href).pathname}`)
          let done = false
          asking.current.set(d.id, ws)
          ws.onopen = () => ws.send(JSON.stringify({ ...args, path }))
          ws.onmessage = (e) => {
            let m: Record<string, any>
            try { m = JSON.parse(String(e.data)) } catch { return }
            if (m.t === "text") win.postMessage({ vau: 1, type: "event", id: d.id, value: { delta: m.delta } }, "*")
            else if (m.t === "done") { done = true; reply({ text: m.text, truncated: m.truncated, model: m.model }) }
            else if (m.t === "error") { done = true; reply(undefined, m.message, m.code) }
          }
          ws.onclose = () => { asking.current.delete(d.id); if (!done) reply(undefined, "the call ended", "cancelled") }
        } else if (d.op === "db" || d.op === "storage") {
          const writes = Array.isArray(args.writes) ? args.writes : []
          const r = await postJson("api/artifact/data", { path, [d.op]: writes }).catch(() => null)
          if (!r?.ok) return reply(undefined, (await (r ? failed(r) : {})).error ?? "offline", "unavailable")
          tell(path, { type: d.op, writes }, forward)
          reply(true)
        } else if (d.op === "publish") {
          const r = await postJson("api/artifact/publish", { path, html: args.html, version: args.version }).catch(() => null)
          const body = r ? await failed(r) : {}
          if (r?.status === 409) { setReloads((n) => n + 1); return reply(undefined, body.error, "conflict", { live: body.live }) }
          if (!r?.ok) return reply(undefined, body.error ?? "offline", r?.status === 413 ? "too_large" : r?.status === 400 ? "invalid_content" : "upstream_error")
          reply({ version: body.version })
          self.current = Number(body.version)
          setTimeout(() => setReloads((n) => n + 1), 50)
        } else reply(undefined, `unknown request '${d.op}'`)
      }
    }
    const calls = asking.current
    const forward: Peer = (m) => frame.current?.contentWindow?.postMessage({ vau: 1, ...m }, "*")
    if (!peers.has(path)) peers.set(path, new Set())
    peers.get(path)!.add(forward)
    addEventListener("message", onMessage)
    return () => {
      removeEventListener("message", onMessage)
      peers.get(path)?.delete(forward)
      for (const ws of calls.values()) ws.close()
    }
  }, [path, page, sendTheme])

  // Live: when the server says files changed (core/live.ts), the ones it read are checked (their mtimes, so the app's
  // own no-op writes don't count): it's told, or reloaded. Its own file changing reloads it.
  const self = useRef<number | null | undefined>(undefined)
  const stat = async (paths: string[]): Promise<Record<string, number | null> | null> => {
    if (share) return null // (not a guest's to ask)
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
      // (a shared folder's guest's: scripts only, as the server's policy says too)
      sandbox={share ? "allow-scripts" : "allow-scripts allow-modals allow-downloads allow-pointer-lock allow-forms"}
      referrerPolicy="no-referrer" loading={page ? "eager" : "lazy"}
      className={cn("block w-full border-0 bg-transparent transition-opacity duration-150", ready ? "opacity-100" : "opacity-0", className)}
      style={{ height: fill ? "100%" : shown, colorScheme: isDark() ? "dark" : "light" }} />
  )
}
