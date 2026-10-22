// Agents in the Browser's pages (`vau browser ...`, browser_ tools; electron/browser/agent.ts answers and checks access),
// Bookmarks.md and the plugin's files in .vaultite (blocked elements, site styles): what's in them in the store, their ops.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { OpError, Plugin, vaultPath, type OpCtx } from "../../../core/plugins.ts"
import { Kind, writeAtomic, type Vault } from "../../../core/vault.ts"
import { addBookmarks, readBookmarks, type Bookmark } from "./bookmarks.ts"
import { addRule, BLOCKED, makeRule, readRules, removeRule } from "./elements.ts"
import { siteName, styleFile, STYLES, template, type SiteStyle } from "./sitestyles.ts"
import { liveView } from "./liveroutes.ts"

export const plugin = new Plugin(import.meta.url)
// (the owner watching and driving tabs from the web app: routes, not ops)
liveView(plugin)

type Tab = { tab: number; url: string; title: string; container: string | null; access: "none" | "read" | "act"; shown: boolean
  by: string | null; mine: boolean; summary?: string; paused?: boolean; asking?: string }
type Download = { name: string; state: string; path?: string }
type Page = { tab: number; url: string; title: string; downloads?: Download[] }
/** What an act changed: lines gone (-) and new (+), or the new page's first lines when it went to another (`page`). */
type Acted = Page & { navigated: boolean; diff?: { page: boolean; lines: string[]; more: number } }

/** Ask the engine, its refusals as plain errors for the agent. */
async function ask<T>(name: string, ...args: unknown[]): Promise<T> {
  try { return (await plugin.desktop(name, ...args)) as T } catch (e) { throw new OpError((e as Error).message, 409) }
}
const by = (ctx: OpCtx, p: { terminal?: string; task?: string; summary?: string }) => ({ name: ctx.who.label, session: p.terminal || ctx.who.agent || "", task: p.task ?? "",
  summary: p.summary ?? "" })
const terminal = { type: "string" as const, env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL): your steps are kept together for replay" }
const task = { type: "string" as const, description: "your task in two or three words (flight search): your tabs are grouped as <you>/<task>, and tabs marks them yours" }
// (ops that only drive the desktop app's pages are lock: false: an act settling or a run's 30 s never hold the vault's
// writes; pdf's file.upload holds it for its own)
const tab = { type: "integer" as const, required: true, description: "the tab's number (browser tabs)" }
const got = (d: Download) => `Downloaded ${d.name}${d.path ? ` to ${d.path}` : ""}${d.state === "completed" ? "" : ` (${d.state})`}`
const DONE: Record<string, string> = { click: "Clicked", dblclick: "Double-clicked", hover: "Pointed at", fill: "Filled", type: "Typed in", press: "Pressed",
  check: "Checked", uncheck: "Unchecked", select: "Picked in", upload: "Uploaded into", scroll: "Scrolled" }
const where = (p: Page) => [`Tab ${p.tab}: ${p.title || "(untitled)"}`, p.url, ...(p.downloads ?? []).map(got)].join("\n")
function changed(r: Acted) {
  const d = r.diff
  if (!d) return ""
  const more = d.more ? `\n… ${d.more} more line${d.more === 1 ? "" : "s"}: browser snapshot ${r.tab}` : ""
  if (d.page) return `\n\nThe page now:\n${d.lines.join("\n")}${more}`
  return d.lines.length ? `\n\nWhat changed (- gone, + new):\n${d.lines.join("\n")}${more}` : "\n\nNothing changed on the page."
}

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
  run: (p, ctx) => ask<Tab[]>("agent:tabs", by(ctx, p)),
  text: (tabs: Tab[]) => tabs.length
    ? tabs.map((t) => `${t.tab}  [${[t.access, t.container, t.paused && "paused"].filter(Boolean).join(", ")}]  ${t.title || "(untitled)"}  ${t.url}  `
      + `(${t.mine ? "yours" : t.by ? `${t.by}'s` : "the user's"}${t.asking ? `; asked the user: ${t.asking}` : ""})${t.summary ? `\n    ${t.summary}` : ""}`).join("\n")
    : "No web pages open.",
})

plugin.op({
  id: "web-viewer.open",
  cli: "browser open",
  mcp: "browser_open",
  summary: "Open a web page in a new tab of the desktop app, beside the user's work, for you to read and act in.",
  help: `It opens in the container meant for agents (or the one you name, if agents may act there), signed in to what the
user signed in to there, in a tab group of yours (<you>/<task>). The user sees it and what you do in it. Answers its tab
number. summary says what you're doing, for the user watching agents at work ("Show agents in the browser") and
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
    terminal,
  },
  args: ["url"],
  run: (p, ctx) => ask<Page>("agent:open", p.url, p.container ?? null, by(ctx, p)),
  text: where,
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
  help: `Take one before acting. An element keeps its ref while it's on the page (a new page gives new ones), and act answers
what changed, so you rarely need another.

  vau browser snapshot 3`,
  kind: "read",
  params: { tab },
  args: ["tab"],
  run: (p) => ask<Page & { snapshot: string }>("agent:snapshot", p.tab),
  text: (r: Page & { snapshot: string }) => `${where(r)}\n\n${r.snapshot}`,
})

/** Files for a page's file input, read here: the vault's by path, this machine's by absolute path (its owner only). */
async function filesFor(given: unknown, ctx: OpCtx) {
  const list = (Array.isArray(given) ? given : [given]).map((f) => String(f ?? "").trim()).filter(Boolean)
  if (!list.length) throw new OpError("upload needs files: vault paths (Attachments/cv.pdf), or absolute paths on this machine")
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
  summary: "Click, type, fill a form, press a key, pick an option, upload a file or scroll in a tab, by refs from its snapshot, with real input; answers what changed.",
  help: `Actions: click, dblclick, hover, fill (replaces what's there; with fields, a whole form at once: text typed, a list's
option picked, a checkbox checked by true or false), type (adds to it), press (a key, on a ref or the page: Enter, Tab,
Escape, Meta+a...), check, uncheck, select (an option of a list, by its text), upload (files into a file input: vault
paths, or absolute paths on this machine), scroll (up or down, the page or a ref). Answers once the page settled: where
the tab is, what it downloaded (into the Downloads folder of the Mac whose browser it is) and what changed on the page
since you last saw it (diff: summary, up to 30 lines; a number of lines; none), or the new page's first lines when it
went to another.

  vau browser act 3 click e12
  vau browser act 3 fill e5 --value "alice@example.com"
  vau browser act 3 fill --fields '[{"ref":"e5","value":"Alice"},{"ref":"e7","value":"true"},{"ref":"e9","value":"Large"}]'
  vau browser act 3 press --key Enter --diff none
  vau browser act 3 upload e8 --files Attachments/cv.pdf
  vau browser act 3 scroll --direction down`,
  kind: "write",
  lock: false,
  params: {
    tab,
    action: { type: "string", required: true, enum: ["click", "dblclick", "hover", "fill", "type", "press", "check", "uncheck", "select", "upload", "scroll"], description: "what to do" },
    ref: { type: "string", description: "the control, from the tab's last snapshot (e12)" },
    value: { type: "string", description: "the text to fill or type, or the option to select" },
    key: { type: "string", description: "the key to press (Enter, Tab, Meta+a)" },
    direction: { type: "string", enum: ["up", "down"], description: "which way to scroll" },
    files: { type: "array", items: { type: "string" }, description: "upload: the files, vault paths (Attachments/cv.pdf) or absolute paths on this machine" },
    fields: { type: "array", items: { type: "object", properties: { ref: { type: "string" }, value: { type: "string" } }, required: ["ref"] },
      description: "fill: a whole form, each field's ref and value (a checkbox's: true or false; a list's: its option)" },
    diff: { type: "string", default: "summary", description: "what changed, answered: summary (up to 30 lines), none, or at most this many lines" },
    terminal,
  },
  args: ["tab", "action", "ref"],
  run: async (p, ctx) => {
    if (p.fields && p.action !== "fill") throw new OpError("fields go with fill")
    return ask<Acted>("agent:act", p.tab, { action: p.action, ref: p.ref, value: p.value, key: p.key, direction: p.direction, fields: p.fields, diff: p.diff,
      ...(p.action === "upload" ? { files: await filesFor(p.files, ctx) } : {}) }, by(ctx, p))
  },
  text: (r: Acted) => `${r.navigated ? "Went to another page. " : ""}${where(r)}${changed(r)}`,
  // (each names its tab, "browser tab 3": the live view lists a tab's steps from Activity by it)
  did: (p) => ({ action: "run", text: Array.isArray(p.fields) ? `Filled ${p.fields.length} fields in browser tab ${String(p.tab)}`
    : `${DONE[String(p.action)] ?? String(p.action)}${p.action === "press" && p.key ? ` ${String(p.key)}` : ""}${p.ref ? ` ${String(p.ref)}` : ""} in browser tab ${String(p.tab)}` }),
})

plugin.op({
  id: "web-viewer.navigate",
  cli: "browser go",
  mcp: "browser_navigate",
  summary: "Send a tab to an address, or back, forward, or reload it.",
  help: `  vau browser go 3 https://example.com/settings
  vau browser go 3 back`,
  kind: "write",
  lock: false,
  params: { tab, to: { type: "string", required: true, description: "an http(s) address, or back, forward, reload" }, terminal },
  args: ["tab", "to"],
  run: (p, ctx) => ask<Page>("agent:navigate", p.tab, p.to, by(ctx, p)),
  text: where,
  did: (p) => ({ action: "run", text: `Sent browser tab ${String(p.tab)} to ${String(p.to)}` }),
})

/** The lines of `text` that have `find` (any case; /a regex/ too), a line around each, numbered. */
export function grep(text: string, find: string, max = 50) {
  let re: RegExp
  const m = /^\/(.+)\/([a-z]*)$/.exec(find)
  try { re = m ? new RegExp(m[1], m[2].includes("i") ? m[2] : `${m[2]}i`) : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }
  catch { throw new OpError(`not a regex: ${find}`) }
  const lines = text.split("\n"), keep = new Set<number>(), hits: number[] = []
  lines.forEach((l, i) => { if (hits.length < max && re.test(l)) { hits.push(i); for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < lines.length) keep.add(j) } })
  const out: string[] = []
  let last = -2
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i > last + 1 && out.length) out.push("--")
    out.push(`${i + 1}${hits.includes(i) ? ":" : "-"} ${lines[i].slice(0, 500)}`)
    last = i
  }
  return { hits: hits.length, text: out.join("\n") }
}

plugin.op({
  id: "web-viewer.player",
  cli: "browser player",
  summary: "Open a tab's page as a player, a window of its own with its video filling it (to watch, or share in a call), or bring it back.",
  help: `The page moves on playing (not loaded again) into a window titled "Vaultite player", its main video filling it, full
screen on a Space of its own (the Browser's playerFullScreen setting; --window: a window), and plays on while it's hidden
or in the background. --off brings it back to its tab, as Esc in it does. Any tab: it moves the page, nothing in it is
read or done.

  vau browser player 3
  vau browser player 3 --off`,
  kind: "write",
  lock: false,
  params: {
    tab,
    off: { type: "boolean", description: "bring it back to its tab" },
    window: { type: "boolean", description: "a window, not full screen" },
  },
  args: ["tab"],
  run: (p) => ask<Page>("agent:player", p.tab, !p.off, p.window ? false : plugin.settings().playerFullScreen !== false),
  text: (r: Page) => where(r),
  did: (p) => ({ action: "run", text: p.off ? `Brought browser tab ${String(p.tab)} back from its player` : `Opened browser tab ${String(p.tab)} as a player` }),
})

plugin.op({
  id: "web-viewer.read",
  cli: "browser read",
  mcp: "browser_read",
  summary: "A tab's page as plain text: everything it shows, for reading (a snapshot is for acting); or only the lines with some words.",
  help: `find keeps the lines that have it (any case; /a regex/ too), with a line around each, numbered: a long page
searched without reading it all.

  vau browser read 3
  vau browser read 3 --find "order number"`,
  kind: "read",
  params: { tab, find: { type: "string", description: "only the lines with this (words, or /a regex/)" } },
  args: ["tab"],
  run: async (p) => {
    const r = await ask<Page & { text: string }>("agent:read", p.tab)
    return p.find ? { ...r, text: grep(r.text, p.find).text, find: p.find } : r
  },
  text: (r: Page & { text: string; find?: string }) => `${where(r)}\n\n${r.find && !r.text ? `Nothing has "${r.find}".` : r.text}`,
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
  vau browser wait 3 --helped --timeout 60`,
  kind: "read",
  params: {
    tab,
    text: { type: "string", description: "text the page shows" },
    url: { type: "string", description: "part of the address it's at" },
    download: { type: "boolean", description: "the tab's last download finished" },
    helped: { type: "boolean", description: "the user said Done to what you asked (browser ask)" },
    timeout: { type: "integer", minimum: 1, maximum: 60, default: 10, description: "seconds, at most" },
  },
  args: ["tab"],
  run: async (p) => {
    const r = await ask<Page & { download?: Download }>("agent:wait", p.tab, { text: p.text, url: p.url, download: !!p.download, helped: !!p.helped }, p.timeout * 1000)
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
  run: (p, ctx) => ask<Page & { value: string }>("agent:evaluate", p.tab, p.expression, by(ctx, p)),
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
download, timeout }), go(url | "back" | "forward" | "reload"), sleep(ms), console.log(...). Each step is kept for replay
like any other. Answers what it logged and what it returned, as JSON.

  vau browser run 3 'await fill({ [await ref("Name")]: "Alice" }); await act("click", await ref("Send", "button"));
    await wait({ text: "Hello" }); return (await read()).split("\\n")[0]'
  vau browser run 3 - < flow.js`,
  kind: "write",
  lock: false,
  params: { tab, script: { type: "string", required: true, stdin: true, description: "the script: an async function's body (await, return)" }, terminal },
  args: ["tab", "script"],
  run: (p, ctx) => ask<Page & { value: string; logs: string[] }>("agent:run", p.tab, p.script, by(ctx, p)),
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
    const r = await ask<Page & { pdf: string }>("agent:pdf", p.tab, by(ctx, p))
    const name = `${String(p.name ?? "").trim() || r.title.trim() || new URL(r.url).hostname}`.replace(/\.pdf$/i, "").slice(0, 120)
    const saved = await plugin.runOp("file.upload", { data: r.pdf, name: `${name}.pdf`, folder: p.folder, note: p.note }, ctx.who)
    return { tab: r.tab, url: r.url, ...saved.result as { path: string; note: string | null } }
  },
  text: (r: { path: string; note: string | null }) => `Saved ${r.path}${r.note ? `, embedded in ${r.note}` : ""}.`,
  did: (p) => ({ action: "edit", text: `Saved browser tab ${String(p.tab)} as a PDF` }),
})

plugin.op({
  id: "web-viewer.ask",
  cli: "browser ask",
  mcp: "browser_ask_user",
  summary: "Ask the user to do something in a tab you can't (sign in, a captcha, a passkey): shown in its bar, and in their Inbox.",
  help: `The tab comes to the front with what you asked in its bar and a Done button, and the user hears of it (the Inbox,
their phone). Then wait for their Done with browser wait --helped (a minute at a time), or for what the page shows once
they did it (--text, --url). Never ask for their password: they type it themselves.

  vau browser ask 3 "Sign in to your bank, then click Done"
  vau browser wait 3 --helped --timeout 60`,
  kind: "write",
  params: { tab, reason: { type: "string", required: true, description: "what to do, in a sentence (Sign in to GitHub)" }, terminal },
  args: ["tab", "reason"],
  run: async (p, ctx) => {
    const r = await ask<Page>("agent:help", p.tab, p.reason, by(ctx, p))
    await plugin.ask("inbox:event", null, { source: "browser", kind: "waiting", key: `help-${p.tab}`, title: `${ctx.who.label} needs you in the browser`,
      body: `${String(p.reason).slice(0, 300)} (${r.title || r.url})`, link: `view:web-live/${r.tab}` })
    return r
  },
  text: (r: Page) => `Asked the user in tab ${r.tab} (its bar, and their Inbox). Wait for their Done: browser wait ${r.tab} --helped`,
  did: (p) => ({ action: "run", text: `Asked for help in browser tab ${String(p.tab)}: ${String(p.reason).slice(0, 80)}` }),
})

// ---------- bookmarks ----------

plugin.kind(new Kind({
  type: "bookmarks", collection: "bookmarks", file: "Bookmarks.md",
  parse: (_fm, body) => [{ body, links: readBookmarks(body) }, []],
  render: (b) => [{}, typeof b.body === "string" ? b.body : ""],
}))

const note = () => plugin.vault.get("bookmarks", "bookmarks")
plugin.state(() => ({ bookmarks: (note()?.links as Bookmark[] | undefined) ?? [], blockedElements: readRules(blockedText(plugin.vault)), siteStyles: siteStyles(plugin.vault) }))

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
    const given = Array.isArray(p.links) ? p.links as Record<string, unknown>[] : p.url ? [{ url: p.url, title: p.title, folder: p.folder }] : []
    const links: Bookmark[] = given.slice(0, 50_000).map((l) => ({ url: clean(l?.url, 4000), title: clean(l?.title, 300), folder: clean(l?.folder, 300) }))
    if (!links.length) throw new OpError("give a url, or links")
    const bad = links.find((l) => !/^https?:\/\/\S+$/i.test(l.url))
    if (bad) throw new OpError(`not a web address: ${bad.url || "(empty)"}`)
    const old = note()
    const { body, added } = addBookmarks(typeof old?.body === "string" ? old.body : "", links)
    if (!added) return { path: old ? `${old.id}.md` : null, added: 0, already: links.length }
    const saved = await plugin.vault.save("bookmarks", { body }, old?.id ?? null)
    return { path: saved ? `${saved.id}.md` : null, added, already: links.length - added }
  },
  text: (r) => (r.added ? `Added ${r.added} bookmark${r.added === 1 ? "" : "s"} to ${r.path}${r.already ? ` (${r.already} already there)` : ""}.`
    : `Already bookmarked${r.path ? ` in ${r.path}` : ""}.`),
  did: (p) => ({ action: "edit", text: Array.isArray(p.links) ? `Bookmarked ${p.links.length} pages` : `Bookmarked ${clean(p.url, 120)}` }),
})

// ---------- blocked elements ----------

/** A file of the plugin's in .vaultite, its text ("" when there's none). */
const textOf = (v: Vault, rel: string) => { try { return fs.readFileSync(v.abs(rel), "utf8") } catch { return "" } }
const blockedText = (v: Vault) => textOf(v, BLOCKED)
const RULES_HELP = `Rules are standard hiding rules, a site, ## and a CSS selector (youtube.com##ytd-reel-shelf-renderer), as
in uBlock Origin and Brave; with no site, every site. They're kept in ${BLOCKED}, a heading per site, and the desktop
app's web pages hide what they match as soon as it changes.`

/** The rule `p` names: whole, or a selector and its site. */
function ruleFrom(p: { rule?: unknown; site?: unknown }) {
  const r = makeRule(clean(p.rule, 2000), clean(p.site, 300) || undefined)
  if (!r) throw new OpError("give a rule like youtube.com##ytd-reel-shelf-renderer, or a CSS selector and --site")
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

// ---------- site styles ----------

/** Every site's style, by its file in STYLES (youtube.com.css). */
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
--vault-font-code, --vault-radius, --vault-color-scheme (light or dark). Use them rather than colours of your own, so the
site follows the vault's scheme. Prefer selectors that last (a custom element's name, an id, a semantic attribute). The
user turns a site's style off in the page's Shields menu (setting unstyled).

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
    if (!site) throw new OpError("give a site like youtube.com")
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
  text: (r) => "sites" in r ? (r.sites.length ? r.sites.join("\n") : "No site has a style.")
    : r.removed !== undefined ? (r.removed ? `Removed ${r.site}'s style.` : `${r.site} has no style.`)
    : r.written ? `Wrote ${r.site}'s style (${r.path}): its pages show it now.`
    : r.css !== null ? `${r.path}\n\n${r.css}` : `${r.site} has no style yet. A new one starts as:\n\n${r.template}`,
  did: (p) => (p.remove === true ? { action: "edit", text: `Removed ${clean(p.site, 120)}'s style in web pages` }
    : typeof p.css === "string" ? { action: "edit", text: `Styled ${clean(p.site, 120)} in web pages` }
    : { text: p.site ? `Read ${clean(p.site, 120)}'s style` : "Listed the sites with a style" }),
})
