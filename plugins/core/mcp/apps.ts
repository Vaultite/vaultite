// MCP Apps: the io.modelcontextprotocol/ui extension, 2026-01-26.
import type { Tool } from "./protocol.ts"

export const UI_EXTENSION = "io.modelcontextprotocol/ui"
export const UI_MIME = "text/html;profile=mcp-app"

/** A card's _meta.ui (the spec's UIResourceMeta): what it may reach beyond itself, and whether the host draws its frame. */
export type UiMeta = {
  csp?: { connectDomains?: string[]; resourceDomains?: string[]; frameDomains?: string[]; baseUriDomains?: string[] }
  permissions?: { camera?: object; microphone?: object; geolocation?: object; clipboardWrite?: object }
  domain?: string
  prefersBorder?: boolean
}

/** A card's data: the call, the op's result and text, and the app's address on the internet when it has one. */
export type CardCall = { tool: string; args: Record<string, unknown>; result: unknown; text: string; app: string | null }

/** A card a plugin offers: `tools` draw with it; `also` are tools it calls whose answers it reads. */
export type McpApp = {
  /** ui://vaultite/note */
  uri: string
  name: string
  description?: string
  /** The whole page: self-contained HTML5. */
  html: () => string | Promise<string>
  meta?: UiMeta
  tools: string[]
  also?: string[]
  /** visibility of the tools only it calls: ["app"] hides one from the model. */
  visibility?: Record<string, ("model" | "app")[]>
  /** structuredContent for a call: by default the op's result when it's an object; undefined gives only the text. */
  data?: (c: CardCall) => unknown
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

export async function appsFrom(services: unknown[]): Promise<McpApp[]> {
  const out: McpApp[] = []
  for (const fn of services) {
    let got: unknown
    try { got = typeof fn === "function" ? await fn() : null } catch (e) { console.error("mcp:apps:", e); continue }
    for (const a of Array.isArray(got) ? got as McpApp[] : []) {
      if (isObj(a) && typeof a.uri === "string" && a.uri.startsWith("ui://") && typeof a.html === "function" && !out.some((x) => x.uri === a.uri)) out.push(a)
    }
  }
  return out
}

export const takesUi = (caps: unknown) => {
  const ext = isObj(caps) && isObj(caps.extensions) ? caps.extensions[UI_EXTENSION] : undefined
  return isObj(ext) && Array.isArray(ext.mimeTypes) && ext.mimeTypes.includes(UI_MIME)
}

/** The tools with their cards; the flat _meta key too, which hosts read before the spec settled. */
export function linked(tools: Tool[], apps: McpApp[]): Tool[] {
  if (!apps.length) return tools
  return tools.map((t) => {
    const draws = apps.find((a) => a.tools.includes(t.name)), reads = draws ?? apps.find((a) => a.also?.includes(t.name))
    if (!reads) return t
    const visibility = reads.visibility?.[t.name]
    const ui = { ...(draws ? { resourceUri: draws.uri } : {}), ...(visibility ? { visibility } : {}) }
    const meta = { ...t.meta, ...(Object.keys(ui).length ? { ui } : {}), ...(draws ? { "ui/resourceUri": draws.uri } : {}) }
    return { ...t, meta, app: reads }
  })
}

export const listed = (a: McpApp) => ({ uri: a.uri, name: a.name, ...(a.description ? { description: a.description } : {}), mimeType: UI_MIME,
  ...(a.meta ? { _meta: { ui: a.meta } } : {}) })

export async function contents(a: McpApp) {
  return { contents: [{ uri: a.uri, mimeType: UI_MIME, text: await a.html(), ...(a.meta ? { _meta: { ui: a.meta } } : {}) }] }
}

export async function cardData(a: McpApp, c: CardCall): Promise<Record<string, unknown> | undefined> {
  const d = a.data ? await a.data(c) : c.result
  return isObj(d) ? d : undefined
}

/** The spec's CSP for a card (Security Implications), without 'self': served by the app, 'self' would be its API. */
export function cspOf(meta?: UiMeta) {
  const c = meta?.csp ?? {}, list = (xs?: string[]) => (xs ?? []).filter((x) => /^[\w*.:/-]+$/.test(x)).join(" ")
  const res = list(c.resourceDomains)
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${res}`, `style-src 'unsafe-inline' ${res}`,
    `connect-src ${list(c.connectDomains) || "'none'"}`, `img-src data: ${res}`, `font-src data: ${res}`, `media-src data: ${res}`,
    `frame-src ${list(c.frameDomains) || "'none'"}`, "object-src 'none'", `base-uri ${list(c.baseUriDomains) || "'none'"}`,
    "form-action 'none'",
  ].map((s) => s.replace(/\s+/g, " ").trim()).join("; ")
}
