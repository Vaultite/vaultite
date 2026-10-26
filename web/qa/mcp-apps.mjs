// MCP Apps: each card drawn by a minimal host speaking the spec, then in a note (```block-mcp-app); tasks and board only
// with Tasks and Kanban on. WRITES fixtures (QA/): throwaway server only.
//   node web/qa/mcp-apps.mjs <base url> <vault path>
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { qa, SHOTS, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const temp = (p) => [realpathSync("/tmp"), realpathSync(tmpdir())].some((t) => realpathSync(p).startsWith(t + "/"))
if (!temp(VAULT)) { console.error("mcp-apps: the vault must be a throwaway one in a temporary folder"); process.exit(2) }
mkdirSync(`${VAULT}/QA`, { recursive: true })
writeFileSync(`${VAULT}/QA/MCP note.md`, "---\ntitle: The MCP note\n---\n\n# Hello\n\nA [[MCP tasks]] link, <script>window.x=1</script> and **bold**.\n")
writeFileSync(`${VAULT}/QA/MCP tasks.md`, "- [ ] Water the plants 📅 2026-01-01\n- [ ] Call Alice Park\n")
writeFileSync(`${VAULT}/QA/MCP board.md`, "---\nkanban-plugin: board\n---\n\n## To do\n\n- [ ] Write the FAQ\n- [ ] Pricing page\n\n## Done\n\n**Complete**\n")

let sid = ""
async function rpc(method, params) {
  const r = await fetch(`${B}api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", ...(sid ? { "Mcp-Session-Id": sid } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })
  sid ||= r.headers.get("mcp-session-id") ?? ""
  return (await r.json()).result
}
const init = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }, clientInfo: { name: "qa-host" } })
check("server offers the ui extension", init?.capabilities?.extensions?.["io.modelcontextprotocol/ui"] !== undefined, init?.capabilities)
const tools = (await rpc("tools/list", {})).tools
const uriOf = (name) => tools.find((t) => t.name === name)?._meta?.ui?.resourceUri

// The host: the card's HTML in a sandboxed frame (an opaque origin), its messages answered as the spec says.
const HOST = `<!doctype html><html><body style="margin:0;background:#101010"><iframe id="f" sandbox="allow-scripts" style="width:560px;height:100px;border:0"></iframe><script>
const f = document.getElementById("f"), log = window.log = []
window.start = (html, args, result) => {
  addEventListener("message", async (e) => {
    if (e.source !== f.contentWindow) return
    const m = e.data; log.push(m.method || "answer")
    const send = (x) => f.contentWindow.postMessage({ jsonrpc: "2.0", ...x }, "*")
    if (m.method === "ui/initialize") send({ id: m.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "qa" }, hostCapabilities: { openLinks: {}, serverTools: {} },
      hostContext: { theme: "dark", styles: { variables: { "--color-text-primary": "rgb(250, 1, 2)", "--font-sans": "Georgia" } }, displayMode: "inline", containerDimensions: { width: 560, maxHeight: 900 } } } })
    else if (m.method === "ui/notifications/initialized") { send({ method: "ui/notifications/tool-input", params: { arguments: args } }); send({ method: "ui/notifications/tool-result", params: result }) }
    else if (m.method === "ui/notifications/size-changed") { f.style.height = m.params.height + "px"; window.sized = m.params }
    else if (m.method === "tools/call") send({ id: m.id, result: await window.callTool(m.params) })
    else if (m.method === "ui/open-link") { window.opened = m.params.url; send({ id: m.id, result: {} }) }
  })
  f.srcdoc = html
}
</script></body></html>`

async function card(name, args) {
  const uri = uriOf(name)
  if (!check(`${name} names its card in _meta.ui (and the flat key)`, !!uri && tools.find((t) => t.name === name)._meta["ui/resourceUri"] === uri, tools.find((t) => t.name === name)?._meta)) return null
  const html = (await rpc("resources/read", { uri })).contents[0].text
  const result = await rpc("tools/call", { name, arguments: args })
  const page = watch(await (await browser.newContext({ viewport: { width: 640, height: 900 } })).newPage(), { label: name, console: true })
  await page.exposeFunction("callTool", (p) => rpc("tools/call", p))
  await page.setContent(HOST)
  await page.evaluate(([h, a, r]) => window.start(h, a, r), [html, args, result])
  const frame = await until(async () => page.frames().find((x) => x !== page.mainFrame()), 5000)
  await until(() => page.evaluate(() => !!window.sized), 5000)
  const log = await page.evaluate(() => window.log)
  check(`${name}: initializes, then initialized, then sizes`, log[0] === "ui/initialize" && log.includes("ui/notifications/initialized") && log.includes("ui/notifications/size-changed"), log)
  const look = await frame.evaluate(() => ({ color: getComputedStyle(document.body).color, font: getComputedStyle(document.body).fontFamily, theme: document.documentElement.dataset.theme }))
  check(`${name}: takes the host's theme and variables`, look.color === "rgb(250, 1, 2)" && look.font.includes("Georgia") && look.theme === "dark", look)
  const h = await page.evaluate(() => window.sized.height)
  check(`${name}: tells its height`, h > 40 && h < 900, h)
  return { page, frame }
}

// The note: drawn (its own HTML as text), its title, Open in Vaultite.
{
  const c = await card("read", { path: "QA/MCP note.md" })
  if (c) {
    const t = await c.frame.evaluate(() => ({ title: document.querySelector(".title")?.textContent, h1: document.querySelector(".body h1")?.textContent,
      script: document.querySelector(".body script") === null && window.x === undefined && document.body.textContent.includes("<script>"), link: document.querySelector("a[data-open]")?.dataset.open }))
    check("note card: drawn with its title, its HTML shown as text, a link to the file it names", t.title === "The MCP note" && t.h1 === "Hello" && t.script && t.link === "QA/MCP tasks.md", t)
    await c.frame.click("#open")
    await until(() => c.page.evaluate(() => window.opened), 3000)
    check("note card: Open in Vaultite asks the host to open the note", String(await c.page.evaluate(() => window.opened)).endsWith("QA/MCP%20note.md"), await c.page.evaluate(() => window.opened))
  }
}

// Tasks: ticking calls tasks_complete through the host, and the file says so; ticking again opens it.
if (tools.some((t) => t.name === "tasks_list")) {
  const c = await card("tasks_list", { query: "not done\npath includes QA/MCP tasks" })
  if (c) {
    check("tasks card: lists the tasks", (await c.frame.locator("li").count()) === 2)
    await c.frame.locator("li", { hasText: "Water the plants" }).locator("input").click()
    await until(() => readFileSync(`${VAULT}/QA/MCP tasks.md`, "utf8").includes("- [x] Water the plants"), 5000)
    check("tasks card: a tick is tasks_complete, written to the note", /- \[x\] Water the plants.*✅/.test(readFileSync(`${VAULT}/QA/MCP tasks.md`, "utf8")))
    await wait(300)
    await c.frame.locator("li", { hasText: "Water the plants" }).locator("input").click()
    await until(() => readFileSync(`${VAULT}/QA/MCP tasks.md`, "utf8").includes("- [ ] Water the plants"), 5000)
    check("tasks card: ticked again, it's open again", readFileSync(`${VAULT}/QA/MCP tasks.md`, "utf8").startsWith("- [ ] Water the plants"))
  }
} else console.log("skip tasks card: Tasks is off")

// The board: a card moved with its arrow is kanban_move, and the board redraws.
if (tools.some((t) => t.name === "kanban_read")) {
  const c = await card("kanban_read", { path: "QA/MCP board.md" })
  if (c) {
    check("board card: its lanes and cards", (await c.frame.locator(".lane").count()) === 2 && (await c.frame.locator(".card").count()) === 2)
    await c.frame.locator(".card", { hasText: "Pricing page" }).hover()
    await c.frame.locator(".card", { hasText: "Pricing page" }).locator("button[data-to='1']").click()
    await until(() => c.frame.evaluate(() => document.querySelectorAll(".lane")[1]?.textContent.includes("Pricing page")), 5000)
    check("board card: moved to Done, written and drawn", /## Done[\s\S]*- \[x\] Pricing page/.test(readFileSync(`${VAULT}/QA/MCP board.md`, "utf8")))
  }
} else console.log("skip board card: Kanban is off")

// In the app: a note with the block draws the card, sized to it, themed as the app.
{
  writeFileSync(`${VAULT}/QA/MCP block.md`, "# Cards\n\n```block-mcp-app\ntool: read\narguments:\n  path: QA/MCP note.md\n```\n")
  const page = watch(await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(), { label: "app" })
  await page.goto(`${B}#file/${encodeURIComponent("QA/MCP block.md")}`)
  const frame = await until(() => page.frames().find((x) => x.url().includes("/mcp-app/card")), 15000)
  check("in a note: the block draws the card in a frame", !!frame)
  if (frame) {
    await until(() => frame.evaluate(() => document.querySelector(".title")?.textContent === "The MCP note"), 8000)
    check("in a note: the card got the tool's result", await frame.evaluate(() => document.querySelector(".title")?.textContent) === "The MCP note")
    const h = await until(async () => { const v = await page.evaluate(() => document.querySelector("iframe[src*='mcp-app/card']")?.getBoundingClientRect().height); return v > 120 && v }, 5000)
    check("in a note: the frame is the card's height", h > 120 && h < 900, h)
    const fg = await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-text-primary"))
    check("in a note: the card has the app's colours", !!fg && !fg.startsWith("light-dark"), fg)
    const reach = await frame.evaluate(() => fetch("/api/state").then(() => "open", () => "blocked"))
    check("in a note: the card can't reach the app's API", reach === "blocked", reach)
    await frame.click("#open")
    await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("MCP note")), 5000)
    check("in a note: Open in Vaultite opens the note in the app", decodeURIComponent(await page.evaluate(() => location.hash)).includes("QA/MCP note.md"))
  }
  // A card's tools/call in the app: a tick runs tasks_complete as the user.
  if (tools.some((t) => t.name === "tasks_list")) {
    writeFileSync(`${VAULT}/QA/MCP tasks block.md`, "# Today\n\n```block-mcp-app\ntool: tasks_list\narguments:\n  query: |\n    not done\n    path includes QA/MCP tasks\n```\n")
    await page.goto("about:blank")
    await page.goto(`${B}#file/${encodeURIComponent("QA/MCP tasks block.md")}`)
    const f = await until(() => page.frames().find((x) => x.url().includes("/mcp-app/card")), 15000)
    await until(() => f?.evaluate(() => document.querySelectorAll("li").length === 2), 8000)
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: `${SHOTS}mcp-apps-tasks.png` })
    await f.locator("li", { hasText: "Call Alice Park" }).locator("input").click()
    await until(() => readFileSync(`${VAULT}/QA/MCP tasks.md`, "utf8").includes("- [x] Call Alice Park"), 5000)
    check("in a note: a card's tick is tasks_complete, as the user", readFileSync(`${VAULT}/QA/MCP tasks.md`, "utf8").includes("- [x] Call Alice Park"))
  }
}

await done()
