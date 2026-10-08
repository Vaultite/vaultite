// The core's operations (core/ops.ts), by area, each a function of the App; the bigger areas are in core/coreops/.
// A new op goes here when it's the core's (files, docs, settings, plugins, the window), else in its plugin.
import type { App } from "./app.ts"
import { bundleOps } from "./coreops/bundles.ts"
import { contextOps } from "./coreops/context.ts"
import { devOps } from "./coreops/dev.ts"
import { fileOps } from "./coreops/files.ts"
import { uploadOps } from "./coreops/uploads.ts"
import { itemOps } from "./coreops/items.ts"
import { installOps } from "./coreops/installs.ts"
import { newTabOps } from "./coreops/newtab.ts"
import { pageOps } from "./coreops/pages.ts"
import { panelOps } from "./coreops/panels.ts"
import { pluginList, pluginOps } from "./coreops/plugins.ts"
import { settingsOps } from "./coreops/settings.ts"
import { typeOps } from "./coreops/types.ts"
import { commandList } from "./appsource.ts"
import { propTypeOps } from "./coreops/proptypes.ts"
import { topic, topics } from "./docs.ts"
import { type Op, OpError } from "./ops.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** Every op of the core, in the order the catalog lists them (and `vau --help` its commands): where am I first. */
export function coreOps(app: App): Op[] {
  return [...contextOps(app), ...fileOps(app), ...typeOps(app), ...propTypeOps(app), ...uploadOps(app), ...pluginOps(app), ...installOps(app), ...bundleOps(app), ...panelOps(app), ...newTabOps(app), ...pageOps(app), ...settingsOps(app), ...itemOps(app),
    ...docsOps(app), ...uiOps(app), ...devOps(), ...opsOps(app)]
}

// ---------- ops: the catalog itself ----------

function opsOps(app: App): Op[] {
  return [{
    id: "ops.list",
    cli: "ops",
    summary: "List the operations: everything the API, vau and MCP can do with this vault (its plugins' too, while they're on).",
    help: "Give an area (`note`, `file`) or a word to narrow the list. `vau <id> --help` explains one.",
    kind: "read",
    params: { filter: { type: "string", description: "an area (note, file) or a word in the summary" } },
    args: ["filter"],
    run: ({ filter }) => {
      const q = String(filter ?? "").trim().toLowerCase()
      return app.catalog().filter((e) => !q || e.id.startsWith(`${q}.`) || e.id.includes(q) || e.summary.toLowerCase().includes(q))
        .map(({ id, plugin, summary, kind, cli, mcp }) => ({ id, plugin, summary, kind, cli, mcp }))
    },
    text: (rows: Any[]) => rows.length
      ? rows.map((r) => `- \`${r.id}\`${r.cli ? ` (vau ${r.cli})` : ""}: ${r.summary}`).join("\n") + "\n\n`vau <id> --help` explains one."
      : "No operation matches.",
  }]
}

// ---------- docs: the docs for AIs (core/docs.ts) ----------

function docsOps(app: App): Op[] {
  return [{
    id: "docs.list",
    summary: "List the docs topics: the vault in full, the app's settings, each plugin's file formats.",
    kind: "read",
    run: () => [{ id: "api", title: "Operations (the API)", plugin: null }, ...topics(app.plugins).map(({ id, title, plugin }) => ({ id, title, plugin }))],
    text: (rows: Any[]) => rows.map((t) => `- \`${t.id}\`: ${t.title}`).join("\n"),
  }, {
    id: "docs.read",
    cli: "docs",
    mcp: "docs",
    summary: "The docs, read when needed: a kind of file's format (read it before writing one), the app's settings, the API.",
    help: `Without a topic: the list. A topic is a plugin's id (its AGENTS.md, then its settings, blocks and operations)
or one of the app's (vault, app, vault-plugins, from-other-apps, api: every operation); a title's words work too.

  vau docs
  vau docs people
  vau docs "database views"`,
    kind: "read",
    params: { topic: { type: "string", description: "the topic's id (people, logs, app, api) or words of its title; leave out for the list" } },
    args: ["topic"],
    run: ({ topic: t }) => {
      if (!t) return { topics: [{ id: "api", title: "Operations (the API)" }, ...topics(app.plugins).map(({ id, title }) => ({ id, title }))] }
      if (t.trim().toLowerCase() === "api") return { id: "api", text: app.opsDoc() }
      try {
        const d = topic(app.plugins, t)
        return { id: d.id, text: d.text }
      } catch (e) {
        throw new OpError((e as Error).message, 404)
      }
    },
    text: (r: Any) => (r.topics ? r.topics.map((t: Any) => `- \`${t.id}\`: ${t.title}`).join("\n") : r.text),
  }]
}

// ---------- ui: the user's open window (core/live.ts) ----------

function uiOps(app: App): Op[] {
  /** A window's answer, or what to do when there's none open. */
  const noWindow = (e: unknown) => {
    if (e instanceof OpError && e.status === 409) throw new OpError("no app window is open on this server: open the app (browser or desktop) first", 409)
    throw e
  }
  return [{
    id: "ui.windows",
    summary: "Which app windows are open on this server, and the workspace they show.",
    kind: "read",
    run: (_p, ctx) => ctx.ui(null),
  }, {
    id: "ui.open",
    cli: "open",
    mcp: "open",
    summary: "Open a file (or a view) in the user's app window, optionally in a split.",
    help: `Shows something in the app the user has open: a file in a tab, a view ("view:terminal/<id>", "view:graph") or a
web address in a web tab.
Only the window the user was in last acts. split right|down opens it in a pane beside or below; newTab keeps the
current tab. On a phone it opens in the sheet. For something the user should look at now (a file you wrote).

  vau open Dashboards/Today.md
  vau open "People/Alice Park.md" --split right
  vau open Notes/Idea.md --new-tab
  vau open https://example.com`,
    kind: "write",
    params: {
      path: { type: "string", format: "path", required: true, description: "the vault path (Notes/Idea.md, or as the user says it: Today), a view (view:graph) or a web address" },
      split: { type: "string", enum: ["right", "down"], description: "open it in a pane beside (right) or below (down) the current one" },
      newTab: { type: "boolean", description: "in a new tab, keeping the current one" },
    },
    args: ["path"],
    run: ({ path, split, newTab }, ctx) => ctx.ui({ action: "open", path, split: split ?? null, newTab: !!newTab }).catch(noWindow),
    text: (_r, p) => `Opened ${p.path}${p.split ? ` in a split ${p.split}` : ""}.`,
  }, {
    id: "ui.command",
    cli: "command",
    summary: "Run a command from the app's palette in the user's window (by id).",
    help: `Runs a palette command in the window the user was in last, as if they picked it. Ids: vau commands. A
command that isn't available right then (it needs an open file) runs nothing, and says so.

  vau command sidebar:toggle
  vau command terminal:open
  vau command theme:dark`,
    kind: "write",
    params: { id: { type: "string", required: true, description: "the command's id (sidebar:toggle)" } },
    args: ["id"],
    run: ({ id }, ctx) => ctx.ui({ action: "command", id }).catch(noWindow),
    text: (_r, p) => `Sent ${p.id}.`,
  }, {
    id: "ui.commands",
    cli: "commands",
    summary: "The palette's commands, by id (for vau command): the user's window's, with which can run now, else the app's.",
    help: `With an app window open, the commands it has right now (a file's and a view's too) and whether each can run
there now; with none, the ones in the app's source. filter keeps ids and names with a word.

  vau commands
  vau commands sidebar
  vau commands --available`,
    kind: "read",
    params: {
      filter: { type: "string", description: "a word in the command's id or name" },
      available: { type: "boolean", description: "only the commands that can run in the window now" },
    },
    args: ["filter"],
    run: async ({ filter, available }, ctx) => {
      let from = "window", rows: Any[]
      try {
        rows = await ctx.ui({ action: "commands", timeout: 3 }) as Any[]
      } catch (e) {
        if (!(e instanceof OpError) || ![409, 503, 504].includes(e.status)) throw e
        from = "source"
        rows = commandList(pluginList(app).filter((p) => p.tier === "vault")).map((c) => ({ id: c.id, name: c.name, keys: c.keys, available: null }))
      }
      const q = String(filter ?? "").trim().toLowerCase()
      const commands = rows.filter((c) => (!q || c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) && (!available || c.available !== false))
        .sort((a, b) => a.id.localeCompare(b.id))
      return { from, commands }
    },
    text: (r: Any) => (r.commands.length ? r.commands.map((c: Any) => `${c.id.padEnd(28)} ${c.name}${c.available === false ? "  (not now)" : ""}`).join("\n") : "No command matches.") +
      (r.from === "source" ? "\n(from the app's source: no app window is open)" : ""),
  }, {
    id: "ui.notify",
    cli: "notify",
    summary: "Tell the user something happened: a toast in their window, kept in their inbox.",
    help: `Tells the user something finished or changed ("Imported 12 meals", "Wrote the weekly review"), not every step.
With the Inbox plugin on (the default) it's an event in their inbox: a toast in every open window, a system
notification while the desktop app is in the background, and kept for later when no window is open. Without it, a
toast in the window the user was in last. actionOpen adds one button that opens a vault file or view (actionLabel
names it; "Open" by default; the inbox's toast always says Open). error shows it as an error (a red icon).

  vau notify "Imported 12 meals from Hevy"
  vau notify "Wrote your weekly review" --action-open "Notes/Weekly review.md"
  vau notify "The GitHub refresh failed: rate limited" --error`,
    kind: "write",
    params: {
      text: { type: "string", required: true, description: "what happened, one line" },
      actionOpen: { type: "string", format: "path", description: "a vault file, view or web address its button opens" },
      actionLabel: { type: "string", description: "the button's label (Open by default)" },
      error: { type: "boolean", description: "shown as an error" },
      terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal it's about (its id; vau fills it in when it runs in one)" },
    },
    args: ["text"],
    // The Inbox keeps it (every window toasts it); with the Inbox off, the window the user was in last shows it.
    run: async ({ text, actionOpen, actionLabel, error, terminal }, ctx) => {
      if (actionLabel && !actionOpen) throw new OpError("actionLabel needs actionOpen (what the button opens)")
      const source = ctx.who.source === "cli" || ctx.who.source === "api" ? "vau" : ctx.who.source
      try {
        const ev = await ctx.api("POST", "inbox/events", { source, kind: error ? "error" : "info", title: text,
          ...(actionOpen ? { link: actionOpen } : {}), ...(terminal ? { terminal } : {}) })
        return { inbox: true, event: ev }
      } catch (e) {
        if (!(e instanceof OpError) || e.status !== 404) throw e
      }
      const button = actionOpen ? { label: actionLabel ?? "Open", open: actionOpen } : null
      return { inbox: false, window: await ctx.ui({ action: "notify", text, kind: error ? "error" : null, button }).catch(noWindow) }
    },
    text: (r, p) => `Shown: ${p.text}${p.actionOpen ? ` [${r.inbox ? "Open" : p.actionLabel ?? "Open"}: ${p.actionOpen}]` : ""}${r.inbox ? " (kept in the inbox)" : ""}`,
  }, {
    id: "ui.choose",
    cli: "choose",
    mcp: "choose",
    summary: "Ask the user to pick one of a list, in their window's palette, and wait for it: what they picked, or nothing.",
    help: `Shows the items in the palette of the window the user was in last (desktop, browser or phone), searchable like
the quick switcher, and waits until they pick one (Enter or a click) or dismiss it (Esc), at most timeout seconds. For a
choice that's the user's to make (which note, which of three plans), not a yes or no. Items are lines (piped in, like
dmenu) or a list of strings or {id, label, detail, icon} (icon: a Lucide name); prompt is the question, drawn above
the list. other lets them type something that isn't listed (with no items, it asks for text). The answer is the pick
({index, id, label}; id is the label when not given), the text typed, or nothing when dismissed; vau prints the pick's
id, or nothing.

  ls Notes | vau choose --prompt "Which note to merge into?"
  vau choose --items '["Keep both","Merge","Skip"]' --prompt "Alice Park is in two files"
  printf 'Low\\nMedium\\nHigh\\n' | vau choose --current Medium --other`,
    kind: "read",
    params: {
      items: { type: "array", stdin: true, commas: false, required: true, description: "what to pick from: lines of text, or a list of strings or {id, label, detail, icon}" },
      prompt: { type: "string", description: "the question, shown above the list" },
      current: { type: "string", description: "the item selected at first, by id or label (the current value)" },
      other: { type: "boolean", description: "what's typed can be picked too, when it isn't listed" },
      timeout: { type: "integer", minimum: 5, maximum: 600, default: 300, description: "seconds to wait for the user's pick" },
    },
    run: async ({ items, prompt, current, other, timeout }, ctx) => {
      const list = chooseItems(items as unknown[])
      if (!list.length && !other) throw new OpError("items is empty: nothing to pick from (with other, it asks for text)")
      const at = current === undefined ? -1 : list.findIndex((it) => it.id === current || it.label === current)
      const r = await ctx.ui({ action: "choose", prompt: prompt ?? null, timeout, other: !!other, current: at < 0 ? null : at,
        items: list.map(({ label, detail, icon }) => ({ label, detail, icon })) }).catch(noWindow).catch((e: unknown) => {
        if (e instanceof OpError && e.status === 504) throw new OpError(`the user picked nothing within ${timeout} s`, 504)
        throw e
      }) as { index?: unknown; typed?: unknown } | null
      if (typeof r?.typed === "string" && other) return { picked: null, typed: r.typed }
      const i = typeof r?.index === "number" ? r.index : -1
      return { picked: list[i] ? { index: i, ...list[i] } : null, typed: null }
    },
    text: (r: Any) => r.picked?.id ?? r.typed ?? "",
  }]
}

type ChoiceItem = { id: string; label: string; detail?: string; icon?: string }
/** ui.choose's items as given (lines, strings, objects), each with a label and an id (its label when not given). */
export function chooseItems(items: unknown[]): ChoiceItem[] {
  const text = (v: unknown, most: number) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, most) : "")
  return items.flatMap((e): ChoiceItem[] => {
    if (typeof e === "string") return e.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => ({ id: l, label: l.slice(0, 300) }))
    if (typeof e === "number") return [{ id: String(e), label: String(e) }]
    if (!e || typeof e !== "object") return []
    const o = e as Record<string, unknown>
    const label = text(o.label ?? o.id, 300)
    if (!label) throw new OpError("each item needs a label (or an id)")
    const detail = text(o.detail, 120), icon = text(o.icon, 60)
    return [{ id: text(o.id, 300) || label, label, ...(detail ? { detail } : {}), ...(icon ? { icon } : {}) }]
  }).slice(0, 5000)
}
