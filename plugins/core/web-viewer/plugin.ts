import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { marked } from "marked"
import { z } from "zod"
import { OpError, Plugin, vaultPath, type OpCtx } from "../../../core/plugins.ts"
import { Kind, writeAtomic, type Vault } from "../../../core/vault.ts"
import { addBookmarks, addFolder, editBookmark, folderPath, readBookmarks, readFolders, removeBookmark, removeFolder, renameFolder, type Bookmark } from "./bookmarks.ts"
import { addRule, BLOCKED, makeRule, readRules, removeRule } from "./elements.ts"
import { siteName, styleFile, STYLES, template, type SiteStyle } from "./sitestyles.ts"
import { liveView } from "./liveroutes.ts"
import { grep, within } from "./find.ts"
import { approvals } from "./approvals.ts"
import { machineLogins } from "./machinelogins.ts"

export const plugin = new Plugin(import.meta.url)
liveView(plugin)
approvals(plugin)
machineLogins(plugin)

type Tab = { tab: number; url: string; title: string; container: string | null; access: "none" | "read" | "act"; shown: boolean
  by: string | null; mine: boolean; summary?: string; paused?: boolean; asking?: string }
type Download = { name: string; state: string; path?: string }
type Page = { tab: number; url: string; title: string; downloads?: Download[] }
type Acted = Page & { navigated: boolean; diff?: { page: boolean; lines: string[]; more: number }; opened?: { tab: number; url: string; title: string }[] }

const ask = <T>(name: string, ...args: unknown[]) => askWaiting<T>(0, name, ...args)
async function askWaiting<T>(ms: number, name: string, ...args: unknown[]): Promise<T> {
  try { return (await plugin.desktopWaiting(ms, name, ...args)) as T } catch (e) { throw new OpError(e instanceof Error ? e.message : String(e), 409) }
}
const by = async (ctx: OpCtx, p: { terminal?: string; task?: string; summary?: string }) => ({ name: ctx.who.label, session: p.terminal || ctx.who.agent || "",
  task: p.task ?? "", summary: p.summary ?? "", remote: !!(await ctx.refusal?.("the browser's pages on this machine")) })
const terminal = { type: "string" as const, env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL): your steps are kept together for replay" }
const task = { type: "string" as const, description: "your task in two or three words (flight search): your tabs are grouped as <you>/<task>, and tabs marks them yours" }
const tab = { type: "integer" as const, required: true, description: "the tab's number (browser tabs)" }
const got = (d: Download) => `Downloaded ${d.name}${d.path ? ` to ${d.path}` : ""}${d.state === "completed" ? "" : ` (${d.state})`}`
const DONE: Record<string, string> = { click: "Clicked", dblclick: "Double-clicked", hover: "Pointed at", fill: "Filled", type: "Typed in", paste: "Pasted into", press: "Pressed",
  check: "Checked", uncheck: "Unchecked", select: "Picked in", upload: "Uploaded into", scroll: "Scrolled" }
const where = (p: Page) => [`Tab ${p.tab}: ${p.title || "(untitled)"}`, p.url, ...(p.downloads ?? []).map(got)].join("\n")
function changed(r: Page & { diff?: Acted["diff"] }) {
  const d = r.diff
  if (!d) return ""
  const more = d.more ? `\n… ${d.more} more line${d.more === 1 ? "" : "s"}: browser snapshot ${r.tab}${d.page ? "" : " (--find to look for something)"}` : ""
  if (d.page) return d.lines.length ? `\n\nThe page's content (refs to act on; browser snapshot for all of it):\n${d.lines.join("\n")}${more}` : ""
  return d.lines.length ? `\n\nWhat changed (~ changed, + new, - gone):\n${d.lines.join("\n")}${more}` : "\n\nNothing changed on the page."
}
const pageDiff = { type: "string" as const, default: "summary", description: "the page's content answered, with refs: summary (its first 50 lines, skipping navigation, header and footer), none, or this many lines" }

plugin.op({
  id: "web-viewer.tabs",
  cli: "browser tabs",
  mcp: "browser_tabs",
  summary: "The web pages open in the desktop app's tabs: whose each is (yours, another agent's, the user's) and what agents may do there.",
  help: `Each tab's number, address, title, container and access (none, read, act: its container says), and who opened it:
an agent ("Claude Code/flight search", marked "yours" when it's you, by your task), else the user. Agents read pages in
containers set to Read or Act, and click and type only in ones set to Act; the user picks, per container, in the page's
bar. Open your own tab with browser open (in the container meant for agents); leave the user's tabs as you found them.
The browser is the desktop app's attached to this server; a server without one asks an always-on machine's (Machines).

  vau browser tabs
  vau browser tabs --task "flight search"`,
  kind: "read",
  params: { task, terminal },
  run: async (p, ctx) => ask<Tab[]>("agent:tabs", await by(ctx, p)),
  text: (tabs: Tab[]) => tabs.length
    ? tabs.map((t) => `${t.tab}  [${[t.access, t.container, t.paused && "paused"].filter(Boolean).join(", ")}]  ${t.title || "(untitled)"}  ${t.url}  `
      + `(${t.mine ? "yours" : t.by ? `${t.by}'s` : "the user's"}${t.asking ? `; asked the user: ${t.asking}` : ""})${t.summary ? `\n    ${t.summary}` : ""}`).join("\n")
    : "No web pages open.",
})

plugin.op({
  id: "web-viewer.open",
  cli: "browser open",
  mcp: "browser_open",
  summary: "Open a web page in the desktop app's browser, in the background (no tab of the user's), for you to read and act in.",
  help: `It opens in the container meant for agents (or the one you name, if agents may act there), signed in to what the
user signed in to there, in the background: the user watches it live in a corner of their window, and may open it as a
tab (in a tab group of yours, <you>/<task>). Answers its tab number and, once it has drawn, its content with refs to act
on (its first lines, past the navigation: often no snapshot is needed). summary says what you're doing, for the user watching agents at work ("Show agents in the browser") and
searching past runs. Close it when you're done with it, unless the user would want to see it.

  vau browser open https://example.com --task "order status" --summary "Checking where order 1042 is"
  vau browser open https://github.com --container work`,
  kind: "write",
  lock: false,
  params: {
    url: { type: "string", required: true, description: "an http(s) address" },
    container: { type: "string", description: "the container's id (left out: the one for agents)" },
    task,
    summary: { type: "string", description: "what you're doing there, in a sentence (Checking where order 1042 is)" },
    diff: pageDiff,
    terminal,
  },
  args: ["url"],
  run: async (p, ctx) => ask<Acted>("agent:open", p.url, p.container ?? null, await by(ctx, p), p.diff),
  text: (r: Acted) => `${where(r)}${changed(r)}`,
  did: (p) => ({ action: "run", text: `Opened ${String(p.url)} in the browser` }),
})

plugin.op({
  id: "web-viewer.close",
  cli: "browser close",
  mcp: "browser_close",
  summary: "Close a tab an agent opened (never the user's).",
  help: `  vau browser close 3`,
  kind: "write",
  lock: false,
  params: { tab },
  args: ["tab"],
  run: (p) => ask<{ tab: number }>("agent:close", p.tab),
  text: (r: { tab: number }) => `Closed tab ${r.tab}.`,
  did: (p) => ({ action: "run", text: `Closed browser tab ${String(p.tab)}` }),
})

plugin.op({
  id: "web-viewer.snapshot",
  cli: "browser snapshot",
  mcp: "browser_snapshot",
  summary: "A tab's page as an accessibility tree: its text, and its controls with refs (e12) to act on.",
  help: `open, go and act already answer what you need most of the time (a new page's content, what an act changed), and act
takes a control by its name (--name) as well as its ref: take a snapshot when those aren't enough. An element keeps its
ref while it's on the page (a new page gives new ones). find keeps the lines that have it (any case; /a regex/ too),
each with the lines it's inside: a control looked for without the whole tree.

  vau browser snapshot 3
  vau browser snapshot 3 --find "save"`,
  kind: "read",
  params: { tab, find: { type: "string", description: "only the lines with this (words, or /a regex/), with what they're inside" } },
  args: ["tab"],
  run: async (p) => {
    const r = await ask<Page & { snapshot: string }>("agent:snapshot", p.tab)
    return p.find ? { ...r, snapshot: within(r.snapshot, p.find), find: p.find } : r
  },
  text: (r: Page & { snapshot: string; find?: string }) => `${where(r)}\n\n${r.find && !r.snapshot ? `No line has "${r.find}".` : r.snapshot}`,
})

async function filesFor(given: unknown, ctx: OpCtx) {
  const list = (Array.isArray(given) ? given : [given]).map((f) => String(f ?? "").trim()).filter(Boolean)
  if (!list.length) throw new OpError("upload needs `files`: vault paths (Attachments/cv.pdf), or absolute paths on this machine")
  let size = 0
  return Promise.all(list.map(async (f) => {
    let file: string
    if (path.isAbsolute(f) || f.startsWith("~/")) {
      const why = await ctx.refusal?.("giving a page a file from this machine")
      if (why) throw new OpError(`${why}: give a file in the vault instead`, 403)
      file = f.startsWith("~/") ? path.join(os.homedir(), f.slice(2)) : f
    } else file = plugin.vault.abs(vaultPath(f))
    let data: Buffer
    try { data = fs.readFileSync(file) } catch { throw new OpError(`no file ${f}`, 404) }
    if ((size += data.length) > 50 << 20) throw new OpError("upload takes 50 MB at most")
    return { name: path.basename(file), data: data.toString("base64") }
  }))
}

plugin.op({
  id: "web-viewer.act",
  cli: "browser act",
  mcp: "browser_act",
  summary: "Click, type, fill a form, paste, press a key, pick an option, upload a file or scroll in a tab, by a control's ref or name, with real input; answers what changed.",
  help: `A control by its ref (from open, go, an act's answer or a snapshot) or by its name (--name "Save", --role button when
several share it: an exact name first, then one that has it). Actions: click, dblclick, hover, fill (replaces what's
there; with fields, a whole form at once, each field by ref or name: text typed, a list's option picked, a checkbox
checked by true or false), type (adds to it), paste (text into the control or what has focus, as a paste: --format
markdown or html keeps its formatting in editors like Google Docs, never the user's clipboard), press (a key, on a control
or the page: Enter, Tab, Escape, Meta+a...), check, uncheck, select (an option of a list, by its text), upload (files
into a file input: vault paths, or absolute paths on this machine), scroll (up or down, the page or a control). Answers
once the page settled: where the tab is, what it downloaded (into the Downloads folder of the Mac whose browser it is)
and what changed on the page since you last saw it (diff: summary, up to 30 lines; a number of lines; none: ~ a control
changed, + new, - gone), or the new page's content when it went to another. Act on that answer: it's the page as it is.

  vau browser act 3 click e12
  vau browser act 3 click --name "Save settings"
  vau browser act 3 fill e5 --value "alice@example.com"
  vau browser act 3 fill --fields '[{"name":"Email","value":"alice@example.com"},{"ref":"e7","value":"true"},{"name":"Size","value":"Large"}]'
  vau browser act 3 paste --format markdown --value - < plan.md
  vau browser act 3 press --key Enter --diff none
  vau browser act 3 upload e8 --files Attachments/cv.pdf
  vau browser act 3 scroll --direction down`,
  kind: "write",
  lock: false,
  params: {
    tab,
    action: { type: "string", required: true, enum: ["click", "dblclick", "hover", "fill", "type", "paste", "press", "check", "uncheck", "select", "upload", "scroll"], description: "what to do" },
    ref: { type: "string", description: "the control, by its ref (e12)" },
    name: { type: "string", description: "the control, by its name as the page shows it (instead of a ref)" },
    role: { type: "string", description: "with name: the control's role (button, link, textbox, combobox, checkbox...)" },
    value: { type: "string", description: "the text to fill, type or paste, or the option to select" },
    format: { type: "string", enum: ["text", "markdown", "html"], default: "text", description: "paste: what value is (markdown and html paste with their formatting)" },
    key: { type: "string", description: "the key to press (Enter, Tab, Meta+a)" },
    direction: { type: "string", enum: ["up", "down"], description: "which way to scroll" },
    files: { type: "array", items: { type: "string" }, description: "upload: the files, vault paths (Attachments/cv.pdf) or absolute paths on this machine" },
    fields: { type: "array", items: { type: "object", properties: { ref: { type: "string" }, name: { type: "string" }, value: { type: "string" } } },
      description: "fill: a whole form, each field's ref or name and its value (a checkbox's: true or false; a list's: its option)" },
    diff: { type: "string", default: "summary", description: "what changed, answered: summary (up to 30 lines), none, or at most this many lines" },
    terminal,
  },
  args: ["tab", "action", "ref"],
  run: async (p, ctx) => {
    if (p.fields && p.action !== "fill") throw new OpError("`fields` go with fill")
    if (p.format && p.format !== "text" && p.action !== "paste") throw new OpError("`format` goes with paste")
    const value = p.value
    const html = p.action !== "paste" || !value ? undefined : p.format === "html" ? value : p.format === "markdown" ? await marked.parse(value) : undefined
    return ask<Acted>("agent:act", p.tab, { action: p.action, ref: p.ref, name: p.name, role: p.role, value, html, key: p.key, direction: p.direction, fields: p.fields, diff: p.diff,
      ...(p.action === "upload" ? { files: await filesFor(p.files, ctx) } : {}) }, await by(ctx, p))
  },
  text: (r: Acted) => `${r.navigated ? "Went to another page. " : ""}${where(r)}${(r.opened ?? []).map((o) => `\nOpened tab ${o.tab}: ${o.title || "(untitled)"} ${o.url} (yours: act there by its number)`).join("")}${changed(r)}`,
  did: (p) => ({ action: "run", text: Array.isArray(p.fields) ? `Filled ${p.fields.length} fields in browser tab ${String(p.tab)}`
    : `${DONE[String(p.action)] ?? String(p.action)}${p.action === "press" && p.key ? ` ${String(p.key)}` : ""}${p.ref ? ` ${String(p.ref)}` : ""} in browser tab ${String(p.tab)}` }),
})

plugin.op({
  id: "web-viewer.navigate",
  cli: "browser go",
  mcp: "browser_navigate",
  summary: "Send a tab to an address, or back, forward, or reload it.",
  help: `Answers where it went and, once it has drawn, its content with refs (as open).

  vau browser go 3 https://example.com/settings
  vau browser go 3 back`,
  kind: "write",
  lock: false,
  params: { tab, to: { type: "string", description: "an http(s) address, or back, forward, reload" }, url: { type: "string", description: "an http(s) address (as to)" }, diff: pageDiff, terminal },
  args: ["tab", "to"],
  run: async (p, ctx) => {
    const to = p.to ?? p.url
    if (!to) throw new OpError("where to: an http(s) address, or back, forward, reload")
    return ask<Acted>("agent:navigate", p.tab, to, await by(ctx, p), p.diff)
  },
  text: (r: Acted) => `${where(r)}${changed(r)}`,
  did: (p) => ({ action: "run", text: `Sent browser tab ${String(p.tab)} to ${String(p.to ?? p.url)}` }),
})

plugin.op({
  id: "web-viewer.player",
  cli: "browser player",
  summary: "Open a tab's page as a player, a window of its own with its video filling it (to watch, or share in a call), or bring it back.",
  help: `The page moves on playing (not loaded again) into a window titled "Vaultite player" at its main video's aspect, the
video filling it (--full-screen, or the Browser's playerFullScreen setting: full screen on a Space of its own; --window: a
window), and plays on while it's hidden or in the background. --off brings it back to its tab, as closing the window does.
Any tab: it moves the page, nothing in it is read or done.

  vau browser player 3
  vau browser player 3 --off`,
  kind: "write",
  lock: false,
  params: {
    tab,
    off: { type: "boolean", description: "bring it back to its tab" },
    window: { type: "boolean", description: "a window, not full screen" },
    fullScreen: { type: "boolean", description: "full screen on a Space of its own" },
  },
  args: ["tab"],
  run: (p) => ask<Page>("agent:player", p.tab, !p.off, p.window ? false : p.fullScreen === true || plugin.settings().playerFullScreen === true),
  text: (r: Page) => where(r),
  did: (p) => ({ action: "run", text: p.off ? `Brought browser tab ${String(p.tab)} back from its player` : `Opened browser tab ${String(p.tab)} as a player` }),
})

plugin.op({
  id: "web-viewer.read",
  cli: "browser read",
  mcp: "browser_read",
  summary: "A tab's page as plain text: everything it shows, for reading (a snapshot is for acting); or only the lines with some words.",
  help: `main keeps the page's main part (no navigation, header or footer) when it marks one. find keeps the lines that have
it (any case; /a regex/ too), with a line around each, numbered: a long page searched without reading it all. A Google
doc reads as its Markdown, a sheet as the shown sheet's CSV and slides as their text (their exports, with the tab's
logins): what their canvas never shows whole.

  vau browser read 3
  vau browser read 3 --main
  vau browser read 3 --find "order number"`,
  kind: "read",
  params: { tab, main: { type: "boolean", description: "only the page's main part" }, find: { type: "string", description: "only the lines with this (words, or /a regex/)" } },
  args: ["tab"],
  run: async (p) => {
    const r = await ask<Page & { text: string; as?: string }>("agent:read", p.tab, !!p.main)
    return p.find ? { ...r, text: grep(r.text, p.find).text, find: p.find } : r
  },
  text: (r: Page & { text: string; find?: string; as?: string }) => `${where(r)}${r.as ? `\n(${{ md: "the doc as Markdown", csv: "the sheet as CSV", txt: "the slides' text" }[r.as] ?? r.as}, from its export)` : ""}\n\n${r.find && !r.text ? `Nothing has "${r.find}".` : r.text}`,
})

plugin.op({
  id: "web-viewer.screenshot",
  cli: "browser screenshot",
  mcp: "browser_screenshot",
  summary: "A picture of a tab's page as it's shown (PNG, at most 1280 wide), saved to a file whose path it answers; MCP clients get the picture.",
  help: `A tab in the background is drawn for it too, and stays hidden.

  vau browser screenshot 3`,
  kind: "read",
  params: { tab },
  args: ["tab"],
  run: async (p) => {
    const r = await ask<{ tab: number; png: string }>("agent:screenshot", p.tab)
    const dir = path.join(os.tmpdir(), "vaultite-browser")
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `tab-${r.tab}-${Date.now()}.png`)
    fs.writeFileSync(file, Buffer.from(r.png, "base64"))
    return { tab: r.tab, path: file }
  },
  text: (r: { path: string }) => r.path,
  image: (r: { path: string }) => ({ data: fs.readFileSync(r.path).toString("base64"), mimeType: "image/png" }),
})

plugin.op({
  id: "web-viewer.wait",
  cli: "browser wait",
  mcp: "browser_wait",
  summary: "Wait until a tab's page shows some text, is at an address, has downloaded a file, or the user did what you asked.",
  help: `Each waits for the page to be done loading too. download: the tab's last download finished (answers its path, in
the Downloads folder of the Mac whose browser it is). helped: the user said Done to what you asked with browser ask.

  vau browser wait 3 --text "Order placed"
  vau browser wait 3 --url /dashboard --timeout 20
  vau browser wait 3 --download
  vau browser wait 3 --helped --timeout 600`,
  kind: "read",
  params: {
    tab,
    text: { type: "string", description: "text the page shows" },
    url: { type: "string", description: "part of the address it's at" },
    download: { type: "boolean", description: "the tab's last download finished" },
    helped: { type: "boolean", description: "the user said Done to what you asked (browser ask)" },
    timeout: { type: "integer", minimum: 1, maximum: 600, default: 10, description: "seconds, at most (60 at most but for helped, 600)" },
  },
  args: ["tab"],
  run: async (p) => {
    const ms = p.timeout * 1000
    const r = await askWaiting<Page & { download?: Download }>(ms, "agent:wait", p.tab, { text: p.text, url: p.url, download: !!p.download, helped: !!p.helped }, ms)
    if (p.helped) await plugin.ask("inbox:drop", null, "browser", `help-${p.tab}`)
    return r
  },
  text: (r: Page & { download?: Download }) => `${where(r)}${r.download ? `\n${got(r.download)}` : ""}`,
})

plugin.op({
  id: "web-viewer.evaluate",
  cli: "browser evaluate",
  mcp: "browser_evaluate",
  summary: "Run a JavaScript expression in a tab, in a world of its own (the page's DOM, never its scripts): its value as JSON.",
  help: `For reading what a snapshot doesn't show well (a table's cells, every link's address). It sees the DOM, not the
page's own scripts or their variables, nor they it; a promise is awaited (30 s at most). It needs Act, since it can change
the page; act's real input is still the way to click and type.

  vau browser evaluate 3 "[...document.querySelectorAll('h2')].map((h) => h.textContent)"`,
  kind: "write",
  lock: false,
  params: { tab, expression: { type: "string", required: true, description: "a JavaScript expression (an async IIFE for statements)" }, terminal },
  args: ["tab", "expression"],
  run: async (p, ctx) => ask<Page & { value: string }>("agent:evaluate", p.tab, p.expression, await by(ctx, p)),
  text: (r: Page & { value: string }) => r.value,
  did: (p) => ({ action: "run", text: `Ran a script in browser tab ${String(p.tab)}` }),
})

plugin.op({
  id: "web-viewer.run",
  cli: "browser run",
  mcp: "browser_run",
  summary: "Run a script of browser steps in a tab in one call (snapshot, act, fill, read, wait, go): a whole flow, its answer its return value.",
  help: `The script is an async function's body, run in a sandbox of its own (no network, no files, not the page's world), 30 s at
most, needing Act like act. Its calls work on the tab: snapshot() (the tree), ref(name, role?) (the first control with
that name, from a fresh tree: its ref or null), act(action, ref?, value?) or act({ action, ref, value, key, diff }) (as
browser act; no diff unless asked), fill({ e5: "Alice", e7: true }), read() (the page's text), wait({ text, url,
download, timeout }), go(url | "back" | "forward" | "reload"), sleep(ms), console.log(...), and args (--args, as JSON).
act takes a control by name too: act({ action: "click", name: "Save" }). Each step is kept for replay
like any other. Answers what it logged and what it returned, as JSON.

  vau browser run 3 'await fill({ [await ref("Name")]: "Alice" }); await act("click", await ref("Send", "button"));
    await wait({ text: "Hello" }); return (await read()).split("\\n")[0]'
  vau browser run 3 - < flow.js
  vau browser run 3 --args '{"q":"invoice"}' - < search.js`,
  kind: "write",
  lock: false,
  params: { tab, script: { type: "string", required: true, stdin: true, description: "the script: an async function's body (await, return)" },
    args: { type: "object", description: "what the script gets as args (JSON): one script for several inputs" }, terminal },
  args: ["tab", "script"],
  run: async (p, ctx) => ask<Page & { value: string; logs: string[] }>("agent:run", p.tab, p.script, await by(ctx, p), p.args ?? null),
  text: (r: Page & { value: string; logs: string[] }) => [...r.logs, r.value === "null" && r.logs.length ? "" : r.value].filter(Boolean).join("\n"),
  did: (p) => ({ action: "run", text: `Ran a script of steps in browser tab ${String(p.tab)}` }),
})

plugin.op({
  id: "web-viewer.pdf",
  cli: "browser pdf",
  mcp: "browser_pdf",
  summary: "Save a tab's page as a PDF into the vault (the attachments folder), named for its title; with note, embedded in it.",
  help: `As the page prints, its backgrounds too. A tab in the background works too.

  vau browser pdf 3
  vau browser pdf 3 --name "Order 1042" --note "Notes/Orders.md"`,
  kind: "write",
  lock: false,
  params: {
    tab,
    name: { type: "string", description: "the file's name (default the page's title)" },
    folder: { type: "string", description: "the vault folder to save it in; the attachments folder by default" },
    note: { type: "string", format: "path", description: "a note to embed it in, at its end" },
    terminal,
  },
  args: ["tab"],
  run: async (p, ctx) => {
    const r = await ask<Page & { pdf: string }>("agent:pdf", p.tab, await by(ctx, p))
    const name = `${String(p.name ?? "").trim() || r.title.trim() || new URL(r.url).hostname}`.replace(/\.pdf$/i, "").slice(0, 120)
    const saved = await plugin.runOp("file.upload", { data: r.pdf, name: `${name}.pdf`, folder: p.folder, note: p.note }, ctx.who)
    return { tab: r.tab, url: r.url, ...UPLOADED.parse(saved.result) }
  },
  text: (r: { path: string; note?: string | null }) => `Saved ${r.path}${r.note ? `, embedded in ${r.note}` : ""}.`,
  did: (p) => ({ action: "edit", text: `Saved browser tab ${String(p.tab)} as a PDF` }),
})

plugin.op({
  id: "web-viewer.download",
  cli: "browser download",
  mcp: "browser_download",
  summary: "Download a file (a PDF, an invoice, an export) as a tab's page would, with its logins, into the vault (the attachments folder).",
  help: `The address is a link's (from read, evaluate or a snapshot) or relative to the page. It's fetched with the tab's
logins and its address as referrer, so what you could open there downloads, without clicking through a viewer.

  vau browser download 3 https://dash.example.com/invoices/1042.pdf
  vau browser download 3 /export.csv --name "Orders October" --folder Finance`,
  kind: "write",
  lock: false,
  params: {
    tab,
    url: { type: "string", required: true, description: "the file's address (or one relative to the page)" },
    name: { type: "string", description: "the file's name (default its own)" },
    folder: { type: "string", description: "the vault folder to save it in; the attachments folder by default" },
    note: { type: "string", format: "path", description: "a note to embed it in, at its end" },
    terminal,
  },
  args: ["tab", "url"],
  run: async (p, ctx) => {
    const r = await ask<{ tab: number; url: string; name: string; type: string; data: string }>("agent:download", p.tab, p.url, await by(ctx, p))
    const ext = path.extname(r.name)
    const name = String(p.name ?? "").trim() ? `${String(p.name).trim().replace(new RegExp(`${ext.replace(".", "\\.")}$`, "i"), "")}${ext}` : r.name
    const saved = await plugin.runOp("file.upload", { data: r.data, name: name.slice(0, 160), folder: p.folder, note: p.note }, ctx.who)
    return { tab: r.tab, url: r.url, type: r.type, bytes: Buffer.from(r.data, "base64").length, ...UPLOADED.parse(saved.result) }
  },
  text: (r: { path: string; note?: string | null; bytes: number; type: string }) => `Saved ${r.path} (${Math.max(1, Math.round(r.bytes / 1024))} KB${r.type ? `, ${r.type.split(";")[0]}` : ""})${r.note ? `, embedded in ${r.note}` : ""}.`,
  did: (p) => ({ action: "edit", text: `Downloaded ${String(p.url)} from browser tab ${String(p.tab)}` }),
})

plugin.op({
  id: "web-viewer.ask",
  cli: "browser ask",
  mcp: "browser_ask_user",
  summary: "Ask the user to do something in a tab you can't (sign in, a captcha, a passkey): shown on it, and in their Inbox.",
  help: `The page opens as a tab, in front, with what you asked and a Done button in a card at its foot, and the user hears
of it (the Inbox, their phone). Then wait for their Done with browser wait --helped (a minute at a time), or for what the page shows once
they did it (--text, --url). Never ask for their password: they type it themselves, or you log in with browser login.

  vau browser ask 3 "Sign in to your bank, then click Done"
  vau browser wait 3 --helped --timeout 600`,
  kind: "write",
  params: { tab, reason: { type: "string", required: true, description: "what to do, in a sentence (Sign in to GitHub)" }, terminal },
  args: ["tab", "reason"],
  run: async (p, ctx) => {
    const r = await ask<Page>("agent:help", p.tab, p.reason, await by(ctx, p))
    const on = await plugin.ask<string | null>("machines:browser", null)
    await plugin.ask("inbox:event", null, { source: "browser", kind: "waiting", key: `help-${p.tab}`, title: `${ctx.who.label} needs you in the browser`,
      body: `${String(p.reason).slice(0, 300)} (${r.title || r.url})`, link: `view:web-live/${r.tab}${on ? `@${on}` : ""}` })
    return r
  },
  text: (r: Page) => `Asked the user in tab ${r.tab} (on the tab, and their Inbox). Wait for their Done: browser wait ${r.tab} --helped`,
  did: (p) => ({ action: "run", text: `Asked for help in browser tab ${String(p.tab)}: ${String(p.reason).slice(0, 80)}` }),
})


const SHOWN = z.object({ id: z.string().optional(), title: z.string(), username: z.string() })
type Shown = z.infer<typeof SHOWN>
type Login = Page & { status: "filled" | "choose" | "approval" | "waiting"; site: string; entry?: Shown; entries?: Shown[]; filled?: string[]
  submitted?: boolean; approved?: string; navigated?: boolean; grant?: string; ask?: string; approve?: string | null }
const APPROVAL_WAIT = 60_000
const UPLOADED = z.looseObject({ path: z.string(), note: z.string().nullable().optional() })
const as = (e: Shown) => (e.username ? `${e.title} (${e.username})` : e.title)

const USE = z.object({ t: z.number(), entry: SHOWN, site: z.string(), agent: z.string(), task: z.string().optional(), status: z.string(),
  approved: z.string().optional(), machine: z.string().optional() })
type Use = z.infer<typeof USE>
const USES = "login-uses"
const loginUses = (): Use[] => z.array(USE).catch([]).parse(plugin.kept(USES))
function loginUsed(u: Omit<Use, "t" | "machine">) {
  plugin.keep(USES, [{ ...u, t: Date.now(), machine: os.hostname().replace(/\.local$/, "") }, ...loginUses()].slice(0, 500), { shared: true })
}
plugin.route("GET", "web-viewer/login-uses", async (req) => { await plugin.ownerOnly(req, "Agents' logins"); return { uses: loginUses() } }, { sync: false })

plugin.op({
  id: "web-viewer.login",
  cli: "browser login",
  mcp: "browser_login",
  summary: "Log in to a tab's site with the user's passwords for agents: the app fills the username, password or one-time code itself, and you hear only whether it did.",
  help: `The passwords are the user's KeePass file for agents, set up on the Mac whose browser it is; you never get one: what
it answers has no value, and what it filled can't be read back (snapshot and read hide it, evaluate, screenshot and pdf
refuse while the page shows it). It fills what the page asks for: a username and password, a username alone (a
username-first sign-in), or a one-time code (run it again on the page asking for one); --submit presses Enter after. Only
an entry for the page's own site fills (its address; www. too, and every subdomain only for an entry saying *.site).
Several for the site: it lists their titles and usernames, and --entry picks one. An entry the user didn't tag
agent-free needs their yes, given with their passkey (they hear of it on their phone and in the Inbox; it lasts 15
minutes for that entry): it waits a minute, then says it's waiting; tell them, and run it again with the same arguments
once they said yes. You can't approve it yourself. After browser evaluate ran in
the site's pages, load the page again (browser go <tab> reload) before logging in. No entry: ask the user (browser ask).

  vau browser login 3 --submit
  vau browser login 3 --entry alice@example.com --submit`,
  kind: "write",
  lock: false,
  params: {
    tab,
    entry: { type: "string", description: "which entry, by its title or username, when the site has several" },
    submit: { type: "boolean", description: "press Enter once it's filled" },
    task,
    terminal,
  },
  args: ["tab"],
  run: async (p, ctx) => {
    const who = await by(ctx, p), asked = { entry: p.entry ?? "", submit: p.submit === true }
    const drop = (r: Login) => { if (r.ask) plugin.service("inbox:drop")?.("browser", `login-${r.ask}`) }
    const used = (r: Login, status: string) => { if (r.entry) loginUsed({ entry: r.entry, site: r.site, agent: ctx.who.label, task: p.task, status, approved: r.approved }) }
    const r = await ask<Login>("agent:login", p.tab, asked, who)
    if (r.status !== "approval") { if (r.status === "filled") { drop(r); used(r, "filled") } return r }
    if (!r.approve) {
      throw new OpError(`${as(r.entry!)} needs the user's yes with a passkey, and none is set up on the Mac whose browser this is: they add one (Passwords for agents, in an Agents container's menu) or tag the entry agent-free`, 409)
    }
    await plugin.ask("inbox:event", null, { source: "browser", kind: "waiting", key: `login-${r.ask}`, title: `${ctx.who.label} asks to log in to ${r.site}`,
      body: `As ${as(r.entry!)}, from the passwords for agents, in browser tab ${p.tab}${p.task ? ` (${p.task})` : ""}. Approve it with your passkey (it never sees the password): ${r.approve}`,
      link: r.approve })
    const state = await askWaiting<string>(APPROVAL_WAIT, "agent:login-wait", r.grant, APPROVAL_WAIT)
    if (state === "waiting") { used(r, "waiting for the user"); return { tab: r.tab, url: r.url, title: r.title, status: "waiting" as const, site: r.site, entry: r.entry } }
    drop(r)
    if (state === "denied") used(r, "denied")
    if (state === "denied") throw new OpError(`the user said no to logging in to ${r.site} as ${as(r.entry!)}: don't try again`, 403)
    if (state !== "approved") throw new OpError("the request for the user's yes is gone: run it again to ask again", 409)
    const done = await ask<Login>("agent:login", p.tab, asked, who)
    if (done.status === "filled") { drop(done); used(done, "filled") }
    return done
  },
  text: (r: Login) => r.status === "choose"
    ? `${r.site} has ${r.entries!.length} entries: ${r.entries!.map(as).join(", ")}. Pick one with --entry (its title or username).`
    : r.status === "waiting"
      ? `Waiting for the user's yes to log in to ${r.site} as ${as(r.entry!)}: they were asked on their phone and in the Inbox, and approve with their passkey. Tell them, and run this again with the same arguments once they said yes.`
      : `Filled the ${r.filled!.join(" and ")} for ${r.site} (${as(r.entry!)})${r.submitted ? " and submitted" : ""}.${r.navigated ? " Went to another page." : ""}\n${where(r)}`,
  did: (p) => ({ action: "run", text: `Logged in with the passwords for agents in browser tab ${String(p.tab)}${p.entry ? ` (${clean(p.entry, 80)})` : ""}` }),
})


plugin.kind(new Kind({
  type: "bookmarks", collection: "bookmarks", file: "Bookmarks.md",
  parse: (_fm, body) => [{ body, links: readBookmarks(body), folders: readFolders(body) }, []],
  render: (b) => [{}, typeof b.body === "string" ? b.body : ""],
}))

type BookmarksNote = { id?: string; body?: string; links?: Bookmark[]; folders?: string[] }
const note = (): BookmarksNote | null => plugin.vault.get("bookmarks", "bookmarks")
plugin.state(() => ({ bookmarks: note()?.links ?? [], bookmarkFolders: note()?.folders ?? [], bookmarksNote: note() ? `${note()!.id}.md` : null, blockedElements: readRules(blockedText(plugin.vault)), siteStyles: siteStyles(plugin.vault) }))

const clean = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")

plugin.op({
  id: "bookmarks.add",
  cli: "bookmark",
  summary: "Bookmark web pages: links added to the bookmarks note (Bookmarks.md) under their folder's heading.",
  help: `Bookmarks are a note of the user's, Bookmarks.md (type: bookmarks): a heading per folder (## Reading, ### Later
under it), a "- [title](url)" line per bookmark. The Browser's address bar suggests them. An address already there
isn't added again; a folder that isn't there yet gets its heading. links adds many at once.

  vau bookmark https://example.com/a --title "An article" --folder Reading
  vau bookmark https://example.com/b --folder "Reading/Later"`,
  kind: "write",
  params: {
    url: { type: "string", description: "the page's address (http or https)" },
    title: { type: "string", description: "its title (default its site)" },
    folder: { type: "string", description: "its folder, a path with / between levels (\"Reading/Later\"; default the top)" },
    links: { type: "array", description: "several at once, instead of url", items: { type: "object", properties: {
      url: { type: "string" }, title: { type: "string" }, folder: { type: "string" } } } },
  },
  args: ["url"],
  run: async (p) => {
    const given = Array.isArray(p.links) ? p.links : p.url ? [{ url: p.url, title: p.title, folder: p.folder }] : []
    const links: Bookmark[] = given.slice(0, 50_000).map((l) => ({ url: clean(l?.url, 4000), title: clean(l?.title, 300), folder: clean(l?.folder, 300) }))
    if (!links.length) throw new OpError("give a `url`, or `links`")
    const bad = links.find((l) => !/^https?:\/\/\S+$/i.test(l.url))
    if (bad) throw new OpError(`not a web address: ${bad.url || "(empty)"}`)
    const old = note()
    const { body, added } = addBookmarks(old?.body ?? "", links)
    if (!added) return { path: old ? `${old.id}.md` : null, added: 0, already: links.length }
    const saved = await plugin.vault.save("bookmarks", { body }, old?.id ?? null)
    return { path: saved ? `${saved.id}.md` : null, added, already: links.length - added }
  },
  text: (r) => (r.added ? `Added ${r.added} bookmark${r.added === 1 ? "" : "s"} to ${r.path}${r.already ? ` (${r.already} already there)` : ""}.`
    : `Already bookmarked${r.path ? ` in ${r.path}` : ""}.`),
  did: (p) => ({ action: "edit", text: Array.isArray(p.links) ? `Bookmarked ${p.links.length} pages` : `Bookmarked ${clean(p.url, 120)}` }),
})

async function changeNote(change: (body: string) => { body: string; did: boolean }) {
  const old = note()
  if (!old) return { path: null, changed: false }
  const r = change(old.body ?? "")
  if (r.did) await plugin.vault.save("bookmarks", { body: r.body }, old.id)
  return { path: `${old.id}.md`, changed: r.did }
}
const urlOf = (p: { url?: string }) => {
  const url = clean(p.url, 4000)
  if (!/^https?:\/\/\S+$/i.test(url)) throw new OpError(`not a web address: ${url || "(empty)"}`)
  return url
}

plugin.op({
  id: "bookmarks.edit",
  cli: "bookmark edit",
  summary: "Rename a bookmark, or move it to another folder (its line goes under that folder's heading) or before another.",
  help: `before puts it just before that bookmark (in the folder it goes to), as dragging it in the bookmarks bar does;
"" puts it last.

  vau bookmark edit https://example.com/a --folder Reading --before https://example.com/b`,
  kind: "write",
  params: {
    url: { type: "string", description: "the bookmark's address" },
    title: { type: "string", description: "its new title" },
    folder: { type: "string", description: "its new folder, a path with / between levels (\"\": the top)" },
    before: { type: "string", description: "the bookmark it goes just before, in its folder (\"\": last)" },
  },
  args: ["url"],
  run: async (p) => {
    const url = urlOf(p)
    if (typeof p.title !== "string" && typeof p.folder !== "string" && typeof p.before !== "string") throw new OpError("give a `title`, a `folder` or `before`")
    const change = { ...(typeof p.title === "string" ? { title: clean(p.title, 300) } : {}), ...(typeof p.folder === "string" ? { folder: clean(p.folder, 300) } : {}),
      ...(typeof p.before === "string" ? { before: clean(p.before, 4000) } : {}) }
    if (!readBookmarks(note()?.body ?? "").some((b) => b.url === url)) throw new OpError(`${url} isn't bookmarked`)
    return changeNote((body) => { const r = editBookmark(body, url, change); return { body: r.body, did: r.changed } })
  },
  text: (r) => (r.changed ? `Changed the bookmark in ${r.path}.` : "The bookmark was already so."),
  did: (p) => ({ action: "edit", text: `Changed the bookmark of ${clean(p.url, 120)}` }),
})

plugin.op({
  id: "bookmarks.remove",
  cli: "bookmark remove",
  summary: "Remove a bookmark: its line goes from the bookmarks note (its folder stays).",
  kind: "write",
  params: { url: { type: "string", description: "the bookmark's address" } },
  args: ["url"],
  run: async (p) => {
    const url = urlOf(p)
    return changeNote((body) => { const r = removeBookmark(body, url); return { body: r.body, did: r.removed > 0 } })
  },
  text: (r) => (r.changed ? `Removed the bookmark from ${r.path}.` : "It wasn't bookmarked."),
  did: (p) => ({ action: "edit", text: `Removed the bookmark of ${clean(p.url, 120)}` }),
})

plugin.op({
  id: "bookmarks.folder",
  cli: "bookmark folder",
  summary: "Make a bookmarks folder (its heading in Bookmarks.md), rename one, or remove one with what's in it.",
  help: `A folder is a heading of the bookmarks note; an empty one is a heading with nothing under it yet.

  vau bookmark folder "Reading/Later"                 # made, with Reading when it's missing
  vau bookmark folder Reading --rename Articles
  vau bookmark folder Reading --remove                # its bookmarks and folders too`,
  kind: "write",
  params: {
    folder: { type: "string", description: "the folder, a path with / between levels (\"Reading/Later\")" },
    rename: { type: "string", description: "its new name (its last level's)" },
    remove: { type: "boolean", description: "remove it, and everything in it" },
  },
  args: ["folder"],
  run: async (p) => {
    const folder = folderPath(clean(p.folder, 300))
    if (!folder) throw new OpError("give a `folder`")
    const old = note(), body = old?.body ?? ""
    const there = readFolders(body).some((f) => f.toLowerCase() === folder.toLowerCase())
    if ((p.remove || typeof p.rename === "string") && !there) throw new OpError(`there's no bookmarks folder ${folder}`)
    if (p.remove) {
      let removed = 0
      const r = await changeNote((b) => { const x = removeFolder(b, folder); removed = x.removed; return { body: x.body, did: x.found } })
      return { ...r, folder, removed, did: "removed" as const }
    }
    if (typeof p.rename === "string") {
      const name = clean(p.rename, 200)
      if (!name) throw new OpError("give the folder a name")
      const r = renameFolder(body, folder, name)
      if (r.taken) throw new OpError(`there's a folder named ${name} there already`)
      return { ...(await changeNote(() => ({ body: r.body, did: r.changed }))), folder, did: "renamed" as const, name }
    }
    const r = addFolder(body, folder)
    if (!r.added) return { path: old ? `${old.id}.md` : null, changed: false, folder, did: "made" as const }
    const saved = await plugin.vault.save("bookmarks", { body: r.body }, old?.id ?? null)
    return { path: saved ? `${saved.id}.md` : null, changed: true, folder, did: "made" as const }
  },
  text: (r) => (r.did === "removed" ? `Removed the folder ${r.folder}${r.removed ? ` and its ${r.removed} bookmark${r.removed === 1 ? "" : "s"}` : ""} from ${r.path}.`
    : r.did === "renamed" ? (r.changed ? `Renamed the folder ${r.folder} to ${r.name} in ${r.path}.` : "The folder was already so named.")
    : r.changed ? `Made the folder ${r.folder} in ${r.path}.` : `There's a folder ${r.folder} already${r.path ? ` in ${r.path}` : ""}.`),
  did: (p) => ({ action: "edit", text: p.remove ? `Removed the bookmarks folder ${clean(p.folder, 120)}` : typeof p.rename === "string"
    ? `Renamed the bookmarks folder ${clean(p.folder, 120)}` : `Made the bookmarks folder ${clean(p.folder, 120)}` }),
})


const textOf = (v: Vault, rel: string) => { try { return fs.readFileSync(v.abs(rel), "utf8") } catch { return "" } }
const blockedText = (v: Vault) => textOf(v, BLOCKED)
const RULES_HELP = `Rules are standard hiding rules, a site, ## and a CSS selector (youtube.com##ytd-reel-shelf-renderer), as
in uBlock Origin and Brave; with no site, every site. They're kept in ${BLOCKED}, a heading per site, and the desktop
app's web pages hide what they match as soon as it changes.`

function ruleFrom(p: { rule?: unknown; site?: unknown }) {
  const r = makeRule(clean(p.rule, 2000), clean(p.site, 300) || undefined)
  if (!r) throw new OpError("give a rule like youtube.com##ytd-reel-shelf-renderer, or a CSS selector and `site`")
  return r
}

plugin.op({
  id: "web-viewer.block",
  cli: "browser block",
  summary: "Hide part of a website in the desktop app's browser: a hiding rule added to the blocked elements list.",
  help: `${RULES_HELP} Prefer selectors that last: a custom element's name, an id, a semantic attribute, not a generated class.

  vau browser block "youtube.com##ytd-reel-shelf-renderer"
  vau browser block "#related" --site youtube.com`,
  kind: "write",
  params: {
    rule: { type: "string", required: true, description: "a rule (site##selector), or a CSS selector with site" },
    site: { type: "string", description: "the site it hides on (youtube.com), when rule is a selector; none: every site" },
  },
  args: ["rule"],
  run: (p, ctx) => {
    const r = ruleFrom(p)
    const { body, added } = addRule(blockedText(ctx.vault), r)
    if (added) writeAtomic(ctx.vault.abs(BLOCKED), body)
    return { rule: r.rule, path: BLOCKED, added }
  },
  text: (r) => `${r.added ? "Hidden" : "Already hidden"}: ${r.rule} (${r.path})`,
  did: (p) => ({ action: "edit", text: `Hid ${clean(p.rule, 120)} in web pages` }),
})

plugin.op({
  id: "web-viewer.unblock",
  cli: "browser unblock",
  summary: "Show again what a hiding rule of the blocked elements list hid: the rule taken out of it.",
  help: `  vau browser unblock "youtube.com##ytd-reel-shelf-renderer"`,
  kind: "write",
  params: {
    rule: { type: "string", required: true, description: "the rule, as browser blocked lists it" },
    site: { type: "string", description: "its site, when rule is a selector" },
  },
  args: ["rule"],
  run: (p, ctx) => {
    const r = ruleFrom(p)
    const { body, removed } = removeRule(blockedText(ctx.vault), r.rule)
    if (removed) writeAtomic(ctx.vault.abs(BLOCKED), body)
    return { rule: r.rule, removed }
  },
  text: (r) => (r.removed ? `Shown again: ${r.rule}` : `Not in the list: ${r.rule}`),
  did: (p) => ({ action: "edit", text: `Showed ${clean(p.rule, 120)} again in web pages` }),
})

plugin.op({
  id: "web-viewer.blocked",
  cli: "browser blocked",
  summary: "The hiding rules of the blocked elements list: what the user hid in web pages, for a site or all.",
  help: `${RULES_HELP}

  vau browser blocked
  vau browser blocked youtube.com`,
  kind: "read",
  params: { site: { type: "string", description: "only this site's (and every site's)" } },
  args: ["site"],
  run: (p, ctx) => {
    const site = clean(p.site, 300).toLowerCase().replace(/^www\./, "")
    return { path: BLOCKED, rules: readRules(blockedText(ctx.vault)).filter((r) => !site || !r.site || site === r.site || site.endsWith(`.${r.site}`)).map((r) => r.rule) }
  },
  text: (r) => (r.rules.length ? `${r.rules.join("\n")}\n\n(${r.path})` : "Nothing hidden."),
})


function siteStyles(v: Vault): SiteStyle[] {
  let names: string[] = []
  try { names = fs.readdirSync(v.abs(STYLES)) } catch { return [] }
  return names.filter((n) => n.endsWith(".css") && siteName(n.slice(0, -4)) === n.slice(0, -4)).sort()
    .map((n) => ({ site: n.slice(0, -4), path: `${STYLES}/${n}`, css: textOf(v, `${STYLES}/${n}`) }))
}

plugin.op({
  id: "web-viewer.style",
  cli: "browser style",
  summary: "A website's own CSS in the desktop app's browser, in the vault's look: read, write or remove a site's style.",
  help: `Each site's style is a CSS file, ${STYLES}/<site>.css, added to its pages (its subdomains' too) as soon as it's
saved; each declaration wins over the site's own, so no !important. The vault's look is there as variables, kept up to
date as it changes: --vault-background, --vault-foreground, --vault-card, --vault-muted, --vault-muted-foreground,
--vault-primary, --vault-accent, --vault-border (and the rest of the app's colours), --vault-font-ui, --vault-font-text,
--vault-font-code, --vault-radius, --vault-color-scheme (light or dark), --vault-paper-filter (a filter for what's drawn on
a canvas, white paper and black text onto the card and foreground in the dark, none in the light). Use them rather than colours of your own, so the
site follows the vault's scheme. Prefer selectors that last (a custom element's name, an id, a semantic attribute). The
user turns a site's style off in the page's Shields menu (setting unstyled).

A page's dark mode: while the app is dark, a light page is darkened by Chromium's auto dark mode, which can leave a
mid-light box (#ccc) light under text it made light. A style that makes the page dark itself replaces that: put it in
@media (prefers-color-scheme: dark) to leave the light look alone, the page's background and boxes onto
--vault-background and --vault-card, its text --vault-foreground, links --vault-primary. Read the page's colours first
(vau browser evaluate <tab> with getComputedStyle), then check them again once written: it applies at once, no reload.

  vau browser style                          (the sites that have one)
  vau browser style youtube.com              (its CSS and file)
  vau browser style youtube.com --css "$(cat youtube.css)"
  vau browser style youtube.com --remove`,
  kind: "write",
  params: {
    site: { type: "string", description: "the site (youtube.com); none: the sites that have a style" },
    css: { type: "string", description: "its whole CSS, replacing what it had" },
    remove: { type: "boolean", description: "remove its style (the file goes to the trash)" },
  },
  args: ["site"],
  run: (p, ctx) => {
    const v = ctx.vault
    if (!clean(p.site, 300)) return { sites: siteStyles(v).map((s) => s.site) }
    const site = siteName(clean(p.site, 300))
    if (!site) throw new OpError("give a `site` like youtube.com")
    const rel = styleFile(site), had = fs.existsSync(v.abs(rel))
    if (p.remove === true) {
      if (had) v.toTrash(rel)
      return { site, path: rel, removed: had }
    }
    if (typeof p.css === "string") {
      if (p.css.length > 500_000) throw new OpError("that's more CSS than a site's style takes (500 KB)")
      writeAtomic(v.abs(rel), p.css.endsWith("\n") ? p.css : `${p.css}\n`)
      return { site, path: rel, written: true }
    }
    return { site, path: rel, css: had ? textOf(v, rel) : null, template: had ? undefined : template(site) }
  },
  text: (r) => r.sites ? (r.sites.length ? r.sites.join("\n") : "No site has a style.")
    : r.removed !== undefined ? (r.removed ? `Removed ${r.site}'s style.` : `${r.site} has no style.`)
    : r.written ? `Wrote ${r.site}'s style (${r.path}): its pages show it now.`
    : r.css !== null ? `${r.path}\n\n${r.css}` : `${r.site} has no style yet. A new one starts as:\n\n${r.template}`,
  did: (p) => (p.remove === true ? { action: "edit", text: `Removed ${clean(p.site, 120)}'s style in web pages` }
    : typeof p.css === "string" ? { action: "edit", text: `Styled ${clean(p.site, 120)} in web pages` }
    : { text: p.site ? `Read ${clean(p.site, 120)}'s style` : "Listed the sites with a style" }),
})
