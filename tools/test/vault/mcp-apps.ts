import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, app, check, write } = $
  // MCP Apps (plugins/core/mcp/apps.ts, plugins/core/mcp-apps): cards as ui:// resources, tools linked to them, a
  // call's structuredContent for clients that take cards, and the in-app host's routes.
  const { handle } = await import("../../../plugins/core/mcp/protocol.ts")
  const { toolsOf } = await import("../../../plugins/core/mcp/catalog.ts")
  const { appsFrom, cspOf, takesUi, UI_MIME } = await import("../../../plugins/core/mcp/apps.ts")
  const { noteHtml } = await import("../../../plugins/core/mcp-apps/plugin.ts")
  const mcp = app.plugins.find((p) => p.id === "mcp")!
  const server = {
    version: "0.0.0",
    instructions: () => "",
    tools: () => toolsOf(app.catalog()),
    apps: () => appsFrom(mcp.allServices("mcp:apps")),
    appUrl: () => "https://alice.example.app",
    ctx: (client: Any) => ({ client, op: async (id: string, p: Any) => app.callOp(id, p, { ...client, client: "mcp" }) }),
  }
  const session: Any = { client: null }
  const rpc = (method: string, params?: unknown) => handle({ jsonrpc: "2.0", id: 1, method, params }, session, server) as Promise<Any>
  const UI = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [UI_MIME] } } }

  let r = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: UI, clientInfo: { name: "claude-ai" } })
  check("mcp apps: initialize offers resources and the ui extension, and hears the client takes cards",
    r.result.capabilities.resources && r.result.capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes[0] === UI_MIME && session.ui === true, r.result.capabilities)
  check("mcp apps: a client takes cards only when it says so", !takesUi({}) && !takesUi({ extensions: { "io.modelcontextprotocol/ui": {} } }) && takesUi(UI))
  const read = (await rpc("tools/list")).result.tools.find((t: Any) => t.name === "read")
  check("mcp apps: read names the note card in _meta.ui, and the flat key too", read._meta.ui.resourceUri === "ui://vaultite/note" && read._meta["ui/resourceUri"] === "ui://vaultite/note", read._meta)
  const listed = (await rpc("resources/list")).result.resources
  check("mcp apps: resources/list lists the cards, as mcp-app HTML", ["ui://vaultite/note", "ui://vaultite/tasks", "ui://vaultite/board"].every((u) => listed.some((x: Any) => x.uri === u && x.mimeType === UI_MIME)), listed)
  r = await rpc("resources/read", { uri: "ui://vaultite/tasks" })
  const html = r.result.contents[0].text as string
  check("mcp apps: resources/read gives a card's whole page, the bridge and styles in it", r.result.contents[0].mimeType === UI_MIME && html.startsWith("<!doctype html>")
    && html.includes("ui/initialize") && html.includes("--color-text-primary") && !html.includes("/*bridge.js*/") && !/src="https?:/.test(html), html.length)
  check("mcp apps: an unknown card is -32002", (await rpc("resources/read", { uri: "ui://nope" })).error?.code === -32002)

  write("Notes/Card.md", "---\ntitle: A card\n---\n\n# Hi\n\nSee [[Card]] and <img src=x onerror=alert(1)> ![](https://e.com/a.png) [x](javascript:alert(1))\n\n```block-tasks\n```\n")
  r = await rpc("tools/call", { name: "read", arguments: { path: "Notes/Card.md" } })
  const d = r.result.structuredContent
  check("mcp apps: read of a note gives its card's data and keeps its text", r.result.content[0].text.startsWith("Notes/Card.md") && d.title === "A card" && d.path === "Notes/Card.md"
    && d.open === "vaultite://open/Notes/Card.md" && d.web === "https://alice.example.app/#file/Notes%2FCard.md", d)
  check("mcp apps: the note's HTML is text, links run nothing, images and blocks aren't drawn", d.html.includes("&#60;img") && !d.html.includes("<img") && !d.html.includes("href=\"javascript")
    && d.html.includes('data-open="Notes/Card.md"') && !d.html.includes("block-tasks") && d.html.includes("<h1>Hi</h1>"), d.html)
  check("mcp apps: a link to nothing is its text", noteHtml("[[Nowhere]]", () => null).trim() === "<p>Nowhere</p>")
  session.ui = false
  r = await rpc("tools/call", { name: "read", arguments: { path: "Notes/Card.md" } })
  check("mcp apps: a client that takes no cards gets only the text", !r.result.structuredContent && r.result.content[0].text.startsWith("Notes/Card.md"))
  session.ui = undefined
  check("mcp apps: a session it doesn't know (a restart) still gets the data", !!(await rpc("tools/call", { name: "read", arguments: { path: "Notes/Card.md" } })).result.structuredContent)

  const csp = cspOf({ csp: { connectDomains: ["https://api.example.com"], resourceDomains: ["https://cdn.example.com", "bad; script-src *"] } })
  check("mcp apps: a card's CSP is what it declares and nothing more", csp.includes("connect-src https://api.example.com") && csp.includes("img-src data: https://cdn.example.com") && !csp.includes("bad")
    && cspOf().includes("connect-src 'none'") && cspOf().includes("frame-src 'none'") && !cspOf().includes("'self'"), csp)

  // The in-app host's routes: a block runs a tool that reads, a card calls any but `call`.
  let [s, b] = await api("POST", "mcp-apps/run", { tool: "read", arguments: { path: "Notes/Card.md" } })
  check("mcp apps host: a block's tool runs, with the card it names", s === 200 && b.uri === "ui://vaultite/note" && b.result.structuredContent?.title === "A card", [s, b.tool?._meta, b.result])
  ;[s, b] = await api("POST", "mcp-apps/run", { tool: "write_file", arguments: { path: "Notes/X.md", text: "x" } })
  check("mcp apps host: a block refuses a tool that writes", s >= 400 && String(b.error).includes("only tools that read"), [s, b])
  ;[s, b] = await api("POST", "mcp-apps/call", { name: "call", arguments: { id: "note.create", params: { title: "Sneaky" } } })
  check("mcp apps host: a card can't use call", b.isError === true && !$.exists("Notes/Sneaky.md"), b)
  ;[s, b] = await api("GET", "mcp-apps/resource?uri=ui://vaultite/board")
  check("mcp apps host: resources/read for a card", s === 200 && b.contents[0].uri === "ui://vaultite/board", s)
  write("Notes/Cards.md", "```block-mcp-app\ntool: read\narguments:\n  path: Notes/Card.md\n```\n")
  ;[s, b] = await api("GET", "render?path=Notes/Cards.md")
  check("mcp apps: the block reads as its tool's text for agents", JSON.stringify(b).includes("# Hi"), b)
}
