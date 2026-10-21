// Agents in the Browser's pages (`vau browser ...`, answered by electron/browser/agent.ts, which checks access), and the
// bookmarks and blocked elements notes (Bookmarks.md, Blocked elements.md): their lines in the store, and their ops.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { OpError, Plugin, type OpCtx } from "../../../core/plugins.ts"
import { Kind } from "../../../core/vault.ts"
import { addBookmarks, readBookmarks, type Bookmark } from "./bookmarks.ts"
import { addRule, makeRule, readRules, removeRule, type ElementRule } from "./elements.ts"

export const plugin = new Plugin(import.meta.url)

type Tab = { tab: number; url: string; title: string; container: string | null; access: "none" | "read" | "act"; shown: boolean; paused?: boolean }
type Page = { tab: number; url: string; title: string }

/** Ask the engine, its refusals as plain errors for the agent. */
async function ask<T>(name: string, ...args: unknown[]): Promise<T> {
  try { return (await plugin.desktop(name, ...args)) as T } catch (e) { throw new OpError((e as Error).message, 409) }
}
const by = (ctx: OpCtx, terminal?: string) => ({ name: ctx.who.label, session: terminal || ctx.who.agent || "" })
const terminal = { type: "string" as const, env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL): your steps are kept together for replay" }
const tab = { type: "integer" as const, required: true, description: "the tab's number (browser tabs)" }
const where = (p: Page) => `Tab ${p.tab}: ${p.title || "(untitled)"}\n${p.url}`

plugin.op({
  id: "web-viewer.tabs",
  cli: "browser tabs",
  summary: "The web pages open in the desktop app's tabs, and what agents may do in each (none, read, act: its container says).",
  help: `Each tab's number, address, title, container and access. Agents read pages in containers set to Read or Act, and
click and type only in ones set to Act; the user picks, per container, in the page's bar. Open your own tab with
browser open: it opens beside the user's, in the container meant for agents.

  vau browser tabs`,
  kind: "read",
  run: () => ask<Tab[]>("agent:tabs"),
  text: (tabs: Tab[]) => tabs.length
    ? tabs.map((t) => `${t.tab}  [${t.access}${t.container ? `, ${t.container}` : ""}${t.paused ? ", paused" : ""}]  ${t.title || "(untitled)"}  ${t.url}`).join("\n")
    : "No web pages open.",
})

plugin.op({
  id: "web-viewer.open",
  cli: "browser open",
  summary: "Open a web page in a new tab of the desktop app, beside the user's work, for you to read and act in.",
  help: `It opens in the container meant for agents (or the one you name, if agents may act there), signed in to what the
user signed in to there. The user sees it and what you do in it. Answers its tab number.

  vau browser open https://example.com
  vau browser open https://github.com --container work`,
  kind: "write",
  params: {
    url: { type: "string", required: true, description: "an http(s) address" },
    container: { type: "string", description: "the container's id (left out: the one for agents)" },
    terminal,
  },
  args: ["url"],
  run: (p, ctx) => ask<Page>("agent:open", p.url, p.container ?? null, by(ctx, p.terminal)),
  text: where,
  did: (p) => ({ action: "run", text: `Opened ${String(p.url)} in the browser` }),
})

plugin.op({
  id: "web-viewer.snapshot",
  cli: "browser snapshot",
  summary: "A tab's page as an accessibility tree: its text, and its controls with refs (e12) to act on.",
  help: `Take one before acting, and again after the page changes: refs are only good for the snapshot they came from.

  vau browser snapshot 3`,
  kind: "read",
  params: { tab },
  args: ["tab"],
  run: (p) => ask<Page & { snapshot: string }>("agent:snapshot", p.tab),
  text: (r: Page & { snapshot: string }) => `${where(r)}\n\n${r.snapshot}`,
})

plugin.op({
  id: "web-viewer.act",
  cli: "browser act",
  summary: "Click, type, press a key, pick an option or scroll in a tab, by a ref from its snapshot, with real input.",
  help: `Actions: click, dblclick, hover, fill (replaces what's there), type (adds to it), press (a key, on a ref or the page:
Enter, Tab, Escape, Meta+a...), check, uncheck, select (an option of a list, by its text), scroll (up or down, the page
or a ref). Answers where the tab is after, and whether it went to another page.

  vau browser act 3 click e12
  vau browser act 3 fill e5 --value "alice@example.com"
  vau browser act 3 press --key Enter
  vau browser act 3 scroll --direction down`,
  kind: "write",
  params: {
    tab,
    action: { type: "string", required: true, enum: ["click", "dblclick", "hover", "fill", "type", "press", "check", "uncheck", "select", "scroll"], description: "what to do" },
    ref: { type: "string", description: "the control, from the tab's last snapshot (e12)" },
    value: { type: "string", description: "the text to fill or type, or the option to select" },
    key: { type: "string", description: "the key to press (Enter, Tab, Meta+a)" },
    direction: { type: "string", enum: ["up", "down"], description: "which way to scroll" },
    terminal,
  },
  args: ["tab", "action", "ref"],
  run: (p, ctx) => ask<Page & { navigated: boolean }>("agent:act", p.tab, { action: p.action, ref: p.ref, value: p.value, key: p.key, direction: p.direction }, by(ctx, p.terminal)),
  text: (r: Page & { navigated: boolean }) => `${r.navigated ? "Went to another page. " : ""}${where(r)}`,
  did: (p) => ({ action: "run", text: `${String(p.action)} in a browser tab${p.ref ? ` (${String(p.ref)})` : ""}` }),
})

plugin.op({
  id: "web-viewer.navigate",
  cli: "browser go",
  summary: "Send a tab to an address, or back, forward, or reload it.",
  help: `  vau browser go 3 https://example.com/settings
  vau browser go 3 back`,
  kind: "write",
  params: { tab, to: { type: "string", required: true, description: "an http(s) address, or back, forward, reload" }, terminal },
  args: ["tab", "to"],
  run: (p, ctx) => ask<Page>("agent:navigate", p.tab, p.to, by(ctx, p.terminal)),
  text: where,
  did: (p) => ({ action: "run", text: `Sent a browser tab to ${String(p.to)}` }),
})

plugin.op({
  id: "web-viewer.read",
  cli: "browser read",
  summary: "A tab's page as plain text: everything it shows, for reading (a snapshot is for acting).",
  help: `  vau browser read 3`,
  kind: "read",
  params: { tab },
  args: ["tab"],
  run: (p) => ask<Page & { text: string }>("agent:read", p.tab),
  text: (r: Page & { text: string }) => `${where(r)}\n\n${r.text}`,
})

plugin.op({
  id: "web-viewer.screenshot",
  cli: "browser screenshot",
  summary: "A picture of a tab's page as it's shown (PNG), saved to a file whose path it answers.",
  help: `The tab has to be on screen (agents' tabs open beside the user's).

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
})

plugin.op({
  id: "web-viewer.wait",
  cli: "browser wait",
  summary: "Wait until a tab's page shows some text, or is at an address, and is done loading.",
  help: `  vau browser wait 3 --text "Order placed"
  vau browser wait 3 --url /dashboard --timeout 20`,
  kind: "read",
  params: {
    tab,
    text: { type: "string", description: "text the page shows" },
    url: { type: "string", description: "part of the address it's at" },
    timeout: { type: "integer", minimum: 1, maximum: 60, default: 10, description: "seconds, at most" },
  },
  args: ["tab"],
  run: (p) => ask<Page>("agent:wait", p.tab, { text: p.text, url: p.url }, p.timeout * 1000),
  text: where,
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
