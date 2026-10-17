// A host for MCP Apps' cards (2026-01-26) in the app: the tool's card in a sandboxed frame served by this plugin (its own
// CSP, an opaque origin), speaking the spec's JSON-RPC: theme, tool input and result, tools/call as the user, links, size.
import { useEffect, useRef, useState } from "react"
import { get, Loading, Markdown, onLook, openFile, post, useVaultChange } from "@vaultite"

type Result = { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }
type Run = { tool: { name: string }; uri: string | null; result: Result }

// The app's tokens as the spec's variables, so a card looks like the app (its colour scheme too).
const VARS: Record<string, string> = {
  "--color-background-primary": "background", "--color-background-secondary": "muted", "--color-background-tertiary": "accent",
  "--color-text-primary": "foreground", "--color-text-secondary": "muted-foreground", "--color-text-tertiary": "muted-foreground",
  "--color-text-info": "blue", "--color-text-danger": "red", "--color-text-success": "green", "--color-text-warning": "orange",
  "--color-border-primary": "border", "--color-border-secondary": "border", "--color-ring-primary": "ring", "--font-sans": "font-sans",
}
function hostContext(width: number) {
  const css = getComputedStyle(document.documentElement), dark = document.documentElement.classList.contains("dark")
  const variables: Record<string, string> = {}
  for (const [k, t] of Object.entries(VARS)) { const v = css.getPropertyValue(`--${t}`).trim(); if (v) variables[k] = v }
  return {
    theme: dark ? "dark" : "light", styles: { variables }, displayMode: "inline", availableDisplayModes: ["inline"],
    containerDimensions: { width }, locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: matchMedia("(pointer: coarse)").matches ? "mobile" : "web", userAgent: "vaultite",
    deviceCapabilities: { touch: matchMedia("(pointer: coarse)").matches, hover: matchMedia("(hover: hover)").matches },
  }
}

const textOf = (r: Result) => (r.content ?? []).map((c) => c.text ?? "").join("\n")

/** Where a card's link goes: a vault file opens here, web links in a new tab, nothing else. */
function openLink(url: string) {
  const app = /^vaultite:\/\/open\/(.+)$/.exec(url) ?? /#file\/([^?]+)$/.exec(url)
  if (app) { openFile(decodeURIComponent(app[1]).replace(/^\/+/, ""), { newTab: true }); return true }
  if (/^(https?|mailto):/i.test(url)) { window.open(url, "_blank", "noopener,noreferrer"); return true }
  return false
}

export function McpAppBlock({ tool, args, height }: { tool: string; args: Record<string, unknown>; height?: number }) {
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState("")
  const [h, setH] = useState(120)
  const frame = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const key = JSON.stringify([tool, args])

  const load = () => post<Run>("mcp-apps/run", { tool, arguments: args }).then((r) => { setRun(r); setError("") }, (e: Error) => setError(e.message))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { ready.current = false; setRun(null); void load() }, [key])
  // Live: the vault changing runs the tool again, and the card gets the new result.
  useVaultChange(() => { void load() })

  const uri = run?.uri
  const send = (m: object) => frame.current?.contentWindow?.postMessage({ jsonrpc: "2.0", ...m }, "*")
  const latest = useRef(run)
  latest.current = run
  useEffect(() => { if (ready.current && run) send({ method: "ui/notifications/tool-result", params: run.result }) }, [run])

  useEffect(() => {
    if (!uri) return
    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow
      if (!win || e.source !== win) return
      const m = e.data
      if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return
      const answer = (result: unknown) => m.id !== undefined && send({ id: m.id, result })
      const fail = (message: string) => m.id !== undefined && send({ id: m.id, error: { code: -32000, message } })
      switch (m.method) {
        case "ui/initialize":
          return answer({ protocolVersion: "2026-01-26", hostInfo: { name: "vaultite", version: "1" },
            hostCapabilities: { openLinks: {}, serverTools: {}, serverResources: {}, logging: {} },
            hostContext: { ...hostContext(frame.current?.clientWidth ?? 600), toolInfo: { tool: latest.current?.tool } } })
        case "ui/notifications/initialized":
          ready.current = true
          send({ method: "ui/notifications/tool-input", params: { arguments: args } })
          if (latest.current) send({ method: "ui/notifications/tool-result", params: latest.current.result })
          return
        case "ui/notifications/size-changed":
          if (typeof m.params?.height === "number") setH(Math.min(4000, Math.max(40, Math.ceil(m.params.height))))
          return
        case "tools/call":
          try { return answer(await post("mcp-apps/call", { name: m.params?.name, arguments: m.params?.arguments ?? {} })) } catch (x) { return fail((x as Error).message) }
        case "resources/read":
          try { return answer(await get(`mcp-apps/resource?uri=${encodeURIComponent(String(m.params?.uri ?? ""))}`)) } catch (x) { return fail((x as Error).message) }
        case "ui/open-link":
          return openLink(String(m.params?.url ?? "")) ? answer({}) : fail("Invalid URL")
        case "ui/request-display-mode":
          return answer({ mode: "inline" })
        // No chat here to send to or give context to: taken, and nothing more.
        case "ui/message": case "ui/update-model-context": case "ping":
          return answer({})
        default:
          if (m.id !== undefined && !m.method.startsWith("notifications/")) fail(`Method not found: ${m.method}`)
      }
    }
    addEventListener("message", onMessage)
    const off = onLook(() => { if (ready.current) send({ method: "ui/notifications/host-context-changed", params: hostContext(frame.current?.clientWidth ?? 600) }) })
    return () => {
      removeEventListener("message", onMessage); off()
      if (ready.current) send({ jsonrpc: "2.0", id: "teardown", method: "ui/resource-teardown", params: { reason: "closed" } })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, key])

  if (error) return <Loading error={error} />
  if (!run) return <Loading />
  // A tool without a card: its text, as an agent reads it.
  if (!uri) return <Markdown text={textOf(run.result)} />
  return (
    <iframe ref={frame} src={`mcp-app/card?uri=${encodeURIComponent(uri)}`} title={run.tool.name} sandbox="allow-scripts"
      referrerPolicy="no-referrer" className="block w-full border-0 bg-transparent" style={{ height: height ?? h }} />
  )
}
