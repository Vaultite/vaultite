// Agents in the Browser's pages (`vau browser ...`, browser_ tools; electron/browser/agent.ts answers and checks access),
// and the bookmarks and blocked elements notes (Bookmarks.md, Blocked elements.md): their lines in the store, their ops.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { OpError, Plugin, vaultPath, type OpCtx } from "../../../core/plugins.ts"
import { Kind } from "../../../core/vault.ts"
import { addBookmarks, readBookmarks, type Bookmark } from "./bookmarks.ts"
import { addRule, makeRule, readRules, removeRule, type ElementRule } from "./elements.ts"

export const plugin = new Plugin(import.meta.url)

type Tab = { tab: number; url: string; title: string; container: string | null; access: "none" | "read" | "act"; shown: boolean
  by: string | null; mine: boolean; paused?: boolean; asking?: string }
type Download = { name: string; state: string; path?: string }
type Page = { tab: number; url: string; title: string; downloads?: Download[] }

/** Ask the engine, its refusals as plain errors for the agent. */
async function ask<T>(name: string, ...args: unknown[]): Promise<T> {
  try { return (await plugin.desktop(name, ...args)) as T } catch (e) { throw new OpError((e as Error).message, 409) }
}
const by = (ctx: OpCtx, p: { terminal?: string; task?: string }) => ({ name: ctx.who.label, session: p.terminal || ctx.who.agent || "", task: p.task ?? "" })
const terminal = { type: "string" as const, env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL): your steps are kept together for replay" }
const task = { type: "string" as const, description: "your task in two or three words (flight search): your tabs are grouped as <you>/<task>, and tabs marks them yours" }
const tab = { type: "integer" as const, required: true, description: "the tab's number (browser tabs)" }
const got = (d: Download) => `Downloaded ${d.name}${d.path ? ` to ${d.path}` : ""}${d.state === "completed" ? "" : ` (${d.state})`}`
const where = (p: Page) => [`Tab ${p.tab}: ${p.title || "(untitled)"}`, p.url, ...(p.downloads ?? []).map(got)].join("\n")

plugin.op({
  id: "web-viewer.tabs",
  cli: "browser tabs",
  mcp: "browser_tabs",
  summary: "The web pages open in the desktop app's tabs: whose each is (yours, another agent's, the user's) and what agents may do there.",
  help: `Each tab's number, address, title, container and access (none, read, act: its container says), and who opened it:
an agent ("Claude Code/flight search", marked "yours" when it's you, by your task), else the user. Agents read pages in
containers set to Read or Act, and click and type only in ones set to Act; the user picks, per container, in the page's
bar. Open your own tab with browser open (in the container meant for agents); leave the user's tabs as you found them.
The browser is the desktop app's: from a server without one (the always-on one), the desktop app of a machine with this
vault (Machines) answers.

  vau browser tabs
  vau browser tabs --task "flight search"`,
  kind: "read",
  params: { task, terminal },
  run: (p, ctx) => ask<Tab[]>("agent:tabs", by(ctx, p)),
  text: (tabs: Tab[]) => tabs.length
    ? tabs.map((t) => `${t.tab}  [${[t.access, t.container, t.paused && "paused"].filter(Boolean).join(", ")}]  ${t.title || "(untitled)"}  ${t.url}  `
      + `(${t.mine ? "yours" : t.by ? `${t.by}'s` : "the user's"}${t.asking ? `; asked the user: ${t.asking}` : ""})`).join("\n")
    : "No web pages open.",
})

plugin.op({
  id: "web-viewer.open",
  cli: "browser open",
  mcp: "browser_open",
  summary: "Open a web page in a new tab of the desktop app, beside the user's work, for you to read and act in.",
  help: `It opens in the container meant for agents (or the one you name, if agents may act there), signed in to what the
user signed in to there, in a tab group of yours (<you>/<task>). The user sees it and what you do in it. Answers its tab
number. Close it when you're done with it, unless the user would want to see it.

  vau browser open https://example.com --task "order status"
  vau browser open https://github.com --container work`,
  kind: "write",
  params: {
    url: { type: "string", required: true, description: "an http(s) address" },
    container: { type: "string", description: "the container's id (left out: the one for agents)" },
    task,
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
  help: `Take one before acting, and again after the page changes: refs are only good for the snapshot they came from.

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
  summary: "Click, type, press a key, pick an option, upload a file or scroll in a tab, by a ref from its snapshot, with real input.",
  help: `Actions: click, dblclick, hover, fill (replaces what's there), type (adds to it), press (a key, on a ref or the page:
Enter, Tab, Escape, Meta+a...), check, uncheck, select (an option of a list, by its text), upload (files into a file
input: vault paths, or absolute paths on this machine), scroll (up or down, the page or a ref). Answers where the tab
is after, whether it went to another page, and what it downloaded (into the Downloads folder of the Mac whose browser
it is).

  vau browser act 3 click e12
  vau browser act 3 fill e5 --value "alice@example.com"
  vau browser act 3 press --key Enter
  vau browser act 3 upload e8 --files Attachments/cv.pdf
  vau browser act 3 scroll --direction down`,
  kind: "write",
  params: {
    tab,
    action: { type: "string", required: true, enum: ["click", "dblclick", "hover", "fill", "type", "press", "check", "uncheck", "select", "upload", "scroll"], description: "what to do" },
    ref: { type: "string", description: "the control, from the tab's last snapshot (e12)" },
    value: { type: "string", description: "the text to fill or type, or the option to select" },
    key: { type: "string", description: "the key to press (Enter, Tab, Meta+a)" },
    direction: { type: "string", enum: ["up", "down"], description: "which way to scroll" },
    files: { type: "array", items: { type: "string" }, description: "upload: the files, vault paths (Attachments/cv.pdf) or absolute paths on this machine" },
    terminal,
  },
  args: ["tab", "action", "ref"],
  run: async (p, ctx) => ask<Page & { navigated: boolean }>("agent:act", p.tab, { action: p.action, ref: p.ref, value: p.value, key: p.key, direction: p.direction,
    ...(p.action === "upload" ? { files: await filesFor(p.files, ctx) } : {}) }, by(ctx, p)),
  text: (r: Page & { navigated: boolean }) => `${r.navigated ? "Went to another page. " : ""}${where(r)}`,
  did: (p) => ({ action: "run", text: `${String(p.action)} in a browser tab${p.ref ? ` (${String(p.ref)})` : ""}` }),
})

plugin.op({
  id: "web-viewer.navigate",
  cli: "browser go",
  mcp: "browser_navigate",
  summary: "Send a tab to an address, or back, forward, or reload it.",
  help: `  vau browser go 3 https://example.com/settings
  vau browser go 3 back`,
  kind: "write",
  params: { tab, to: { type: "string", required: true, description: "an http(s) address, or back, forward, reload" }, terminal },
  args: ["tab", "to"],
  run: (p, ctx) => ask<Page>("agent:navigate", p.tab, p.to, by(ctx, p)),
  text: where,
  did: (p) => ({ action: "run", text: `Sent a browser tab to ${String(p.to)}` }),
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
  params: {
    tab,
    off: { type: "boolean", description: "bring it back to its tab" },
    window: { type: "boolean", description: "a window, not full screen" },
  },
  args: ["tab"],
  run: (p) => ask<Page>("agent:player", p.tab, !p.off, p.window ? false : plugin.settings().playerFullScreen !== false),
  text: (r: Page) => where(r),
  did: (p) => ({ action: "run", text: p.off ? "Brought a browser tab back from its player" : "Opened a browser tab as a player" }),
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
  params: { tab, expression: { type: "string", required: true, description: "a JavaScript expression (an async IIFE for statements)" }, terminal },
  args: ["tab", "expression"],
  run: (p, ctx) => ask<Page & { value: string }>("agent:evaluate", p.tab, p.expression, by(ctx, p)),
  text: (r: Page & { value: string }) => r.value,
  did: (p) => ({ action: "run", text: `Ran a script in browser tab ${String(p.tab)}` }),
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
      body: `${String(p.reason).slice(0, 300)} (${r.title || r.url})` })
    return r
  },
  text: (r: Page) => `Asked the user in tab ${r.tab} (its bar, and their Inbox). Wait for their Done: browser wait ${r.tab} --helped`,
  did: (p) => ({ action: "run", text: `Asked for help in a browser tab: ${String(p.reason).slice(0, 80)}` }),
})

// ---------- bookmarks ----------

plugin.kind(new Kind({
  type: "bookmarks", collection: "bookmarks", file: "Bookmarks.md",
  parse: (_fm, body) => [{ body, links: readBookmarks(body) }, []],
  render: (b) => [{}, typeof b.body === "string" ? b.body : ""],
}))

const note = () => plugin.vault.get("bookmarks", "bookmarks")
plugin.state(() => ({ bookmarks: (note()?.links as Bookmark[] | undefined) ?? [], blockedElements: rulesNote()?.rules ?? [] }))

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

plugin.kind(new Kind({
  type: "blocked-elements", collection: "blocked-elements", file: "Blocked elements.md",
  parse: (_fm, body) => [{ body, rules: readRules(body) }, []],
  render: (b) => [{}, typeof b.body === "string" ? b.body : ""],
}))

const rulesNote = () => plugin.vault.get("blocked-elements", "blocked-elements") as { id: string; body?: unknown; rules?: ElementRule[] } | null
const RULES_HELP = `Rules are standard hiding rules, a site, ## and a CSS selector (youtube.com##ytd-reel-shelf-renderer), as
in uBlock Origin and Brave; with no site, every site. They're kept in a note of the user's, Blocked elements.md (type:
blocked-elements), a heading per site, and the desktop app's web pages hide what they match as soon as it changes.`

/** The rule `p` names: whole, or a selector and its site. */
function ruleFrom(p: { rule?: unknown; site?: unknown }) {
  const r = makeRule(clean(p.rule, 2000), clean(p.site, 300) || undefined)
  if (!r) throw new OpError("give a rule like youtube.com##ytd-reel-shelf-renderer, or a CSS selector and --site")
  return r
}

plugin.op({
  id: "web-viewer.block",
  cli: "browser block",
  summary: "Hide part of a website in the desktop app's browser: a hiding rule added to the Blocked elements note.",
  help: `${RULES_HELP} Prefer selectors that last: a custom element's name, an id, a semantic attribute, not a generated class.

  vau browser block "youtube.com##ytd-reel-shelf-renderer"
  vau browser block "#related" --site youtube.com`,
  kind: "write",
  params: {
    rule: { type: "string", required: true, description: "a rule (site##selector), or a CSS selector with site" },
    site: { type: "string", description: "the site it hides on (youtube.com), when rule is a selector; none: every site" },
  },
  args: ["rule"],
  run: async (p) => {
    const r = ruleFrom(p), old = rulesNote()
    const { body, added } = addRule(typeof old?.body === "string" ? old.body : "", r)
    if (!added) return { rule: r.rule, path: old ? `${old.id}.md` : null, added: false }
    const saved = await plugin.vault.save("blocked-elements", { body }, old?.id ?? null)
    return { rule: r.rule, path: saved ? `${saved.id}.md` : null, added: true }
  },
  text: (r) => `${r.added ? "Hidden" : "Already hidden"}: ${r.rule}${r.path ? ` (${r.path})` : ""}`,
  did: (p) => ({ action: "edit", text: `Hid ${clean(p.rule, 120)} in web pages` }),
})

plugin.op({
  id: "web-viewer.unblock",
  cli: "browser unblock",
  summary: "Show again what a hiding rule of the Blocked elements note hid: the rule taken out of it.",
  help: `  vau browser unblock "youtube.com##ytd-reel-shelf-renderer"`,
  kind: "write",
  params: {
    rule: { type: "string", required: true, description: "the rule, as browser blocked lists it" },
    site: { type: "string", description: "its site, when rule is a selector" },
  },
  args: ["rule"],
  run: async (p) => {
    const r = ruleFrom(p), old = rulesNote()
    const { body, removed } = removeRule(typeof old?.body === "string" ? old.body : "", r.rule)
    if (!removed || !old) return { rule: r.rule, removed: false }
    await plugin.vault.save("blocked-elements", { body }, old.id)
    return { rule: r.rule, removed: true }
  },
  text: (r) => (r.removed ? `Shown again: ${r.rule}` : `Not in the list: ${r.rule}`),
  did: (p) => ({ action: "edit", text: `Showed ${clean(p.rule, 120)} again in web pages` }),
})

plugin.op({
  id: "web-viewer.blocked",
  cli: "browser blocked",
  summary: "The hiding rules of the Blocked elements note: what the user hid in web pages, for a site or all.",
  help: `${RULES_HELP}

  vau browser blocked
  vau browser blocked youtube.com`,
  kind: "read",
  params: { site: { type: "string", description: "only this site's (and every site's)" } },
  args: ["site"],
  run: (p) => {
    const site = clean(p.site, 300).toLowerCase().replace(/^www\./, "")
    const all = rulesNote()?.rules ?? []
    return { path: rulesNote() ? `${rulesNote()!.id}.md` : null, rules: all.filter((r) => !site || !r.site || site === r.site || site.endsWith(`.${r.site}`)).map((r) => r.rule) }
  },
  text: (r) => (r.rules.length ? `${r.rules.join("\n")}${r.path ? `\n\n(${r.path})` : ""}` : "Nothing hidden."),
})
