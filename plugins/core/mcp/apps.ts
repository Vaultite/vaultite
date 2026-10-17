// MCP Apps (the io.modelcontextprotocol/ui extension, 2026-01-26): cards plugins offer for tools (service "mcp:apps"),
// served as ui:// resources, linked from their tools' _meta.ui, drawn from a call's structuredContent.
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

/** What a card's data comes from: the call (tool, arguments), the op's result and text, and the app's address on the
 *  internet (Vaultite Cloud's), when it has one. */
export type CardCall = { tool: string; args: Record<string, unknown>; result: unknown; text: string; app: string | null }

/** A card a plugin offers. `tools` draw with it (their _meta.ui names it); `also` are tools it calls whose answers it
 *  reads, given its data without linking. */
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

/** The cards the plugins that are on offer (each "mcp:apps" service answers a list), ui:// ones only, first wins. */
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

/** Whether a client's initialize capabilities take MCP Apps' HTML. */
export const takesUi = (caps: unknown) => {
  const ext = isObj(caps) && isObj(caps.extensions) ? caps.extensions[UI_EXTENSION] : undefined
  return isObj(ext) && Array.isArray(ext.mimeTypes) && ext.mimeTypes.includes(UI_MIME)
}

/** The tools with their cards: a drawn one's _meta.ui names it (and the flat key hosts read before the spec settled),
 *  each knows the card that reads its answers. */
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

/** A card as resources/list names it. */
export const listed = (a: McpApp) => ({ uri: a.uri, name: a.name, ...(a.description ? { description: a.description } : {}), mimeType: UI_MIME,
  ...(a.meta ? { _meta: { ui: a.meta } } : {}) })

/** resources/read's answer for a card. */
export async function contents(a: McpApp) {
  return { contents: [{ uri: a.uri, mimeType: UI_MIME, text: await a.html(), ...(a.meta ? { _meta: { ui: a.meta } } : {}) }] }
}

/** A call's structuredContent from its card, or undefined. */
export async function cardData(a: McpApp, c: CardCall): Promise<Record<string, unknown> | undefined> {
  const d = a.data ? await a.data(c) : c.result
  return isObj(d) ? d : undefined
}

/** The spec's CSP for a card's page (Security Implications) from its declared domains, without 'self': served by the
 *  app, its 'self' would be the app's own API. */
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
