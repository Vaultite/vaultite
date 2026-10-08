// Plugins' newer page templates, offered rather than written over the user's pages (core/pages.ts): which pages have
// one, the difference, taking it, saying no to it. The page's bar uses the same ops.
import fs from "node:fs"
import type { App } from "../app.ts"
import { type Op, OpError, type Param } from "../ops.ts"
import { applied, DISMISSED, dismissal, updates } from "../pages.ts"
import { opcodes } from "../textedit.ts"
import { lines } from "./common.ts"

const PAGE: Param = { type: "string", required: true, description: "the page: its vault path (Dashboards/Health.md) or its name (Health)" }

/** Their copy against the template, line by line: `- ` only in theirs, `+ ` only in the template. */
export function diffText(mine: string, text: string) {
  const a = mine.replace(/\n$/, "").split("\n"), b = text.replace(/\n$/, "").split("\n")
  const out: string[] = []
  for (const [tag, i1, i2, j1, j2] of opcodes(a, b)) {
    if (tag === "equal") { for (let i = i1; i < i2; i++) out.push(`  ${a[i]}`); continue }
    for (let i = i1; i < i2; i++) out.push(`- ${a[i]}`)
    for (let j = j1; j < j2; j++) out.push(`+ ${b[j]}`)
  }
  return out.join("\n")
}

/** A page's update, by its path or name; a 404 naming the pages that have one. */
function find(app: App, q: string) {
  const p = String(q).trim().replace(/^\/+/, "")
  const direct = p.endsWith(".md") && fs.existsSync(app.vault.abs(p)) ? updates(app.vault, app.plugins, p) : []
  if (direct.length) return direct[0]
  const all = updates(app.vault, app.plugins)
  const name = (s: string) => s.toLowerCase().replace(/\.md$/i, "").split("/").pop()
  const hit = all.find((u) => u.path === p) ?? all.find((u) => name(u.path) === name(p))
  if (!hit) throw new OpError(`no update for '${q}'. ${all.length ? `Pages with one: ${all.map((u) => u.path).join(", ")}` : "No page has one."}`, 404)
  return hit
}

const row = (u: { path: string; plugin: string; edited: boolean }) => `${u.path} (${u.plugin})${u.edited ? ": you changed your copy" : ""}`

export function pageOps(app: App): Op[] {
  return [{
    id: "dashboard.updates",
    cli: "dashboard updates",
    summary: "The pages whose plugin has a newer version of them: the app never changes a page by itself.",
    help: `Lists the pages (plugins' dashboards) whose template changed since the vault's copy came from it, and whether the
user changed their copy since. Each is offered in the page's bar until updated or dismissed. path: only that page.

  vau dashboard updates
  vau dashboard diff Health
  vau dashboard update Health      (or: vau dashboard dismiss Health)`,
    kind: "read",
    params: { path: { type: "string", description: "only this page (a vault path)" } },
    run: ({ path }) => ({
      updates: updates(app.vault, app.plugins, path && fs.existsSync(app.vault.abs(String(path))) ? String(path) : undefined)
        .filter((u) => !path || u.path === path).map(({ path, template, plugin, edited }) => ({ path, template, plugin, edited })),
    }),
    text: (r) => lines(r.updates.map(row), "No page has an update."),
  }, {
    id: "dashboard.diff",
    cli: "dashboard diff",
    summary: "A page against its plugin's newer version: what updating it would change.",
    help: `Shows the page as the vault has it against its plugin's new template, line by line: "- " only in the page now,
"+ " only in the new version. When the user changed their copy, updating replaces those changes too: say so.

  vau dashboard diff Health`,
    kind: "read",
    params: { path: PAGE },
    args: ["path"],
    run: ({ path }) => {
      const u = find(app, path)
      return { path: u.path, template: u.template, plugin: u.plugin, edited: u.edited, mine: u.mine, text: u.text, diff: diffText(u.mine, u.text) }
    },
    text: (r) => `${r.path}, ${r.plugin}'s newer version${r.edited ? " (you changed your copy: updating replaces your changes)" : ""}.\n` +
      `- only in the page now, + only in the new version:\n\n${r.diff}`,
  }, {
    id: "dashboard.update",
    cli: "dashboard update",
    summary: "Make a page its plugin's newer version (the old one stays in file history).",
    help: `Replaces the page with its plugin's new template (an ordinary edit: file history keeps the page as it was, to
restore). Changes the user made to their copy go too: read vau dashboard diff first and ask when they made some.

  vau dashboard update Health`,
    kind: "destructive",
    params: { path: PAGE },
    args: ["path"],
    run: async ({ path }, ctx) => {
      const u = find(app, path)
      await ctx.api("PUT", "file", { path: u.path, text: u.text, base: u.mine })
      applied(app.vault, u)
      return { path: u.path, edited: u.edited }
    },
    text: (r) => `Updated ${r.path} to its plugin's version${r.edited ? " (your changes to it are in its file history)" : ""}.`,
  }, {
    id: "dashboard.dismiss",
    cli: "dashboard dismiss",
    summary: "Don't offer a page's update again (until its plugin's version changes again).",
    help: `Keeps the page as it is and stops offering this version of its template (in the page's bar and in vau
dashboard updates); a later version is offered again. Kept in .vaultite/pages.json.

  vau dashboard dismiss Health`,
    kind: "write",
    params: { path: PAGE },
    args: ["path"],
    run: ({ path }) => {
      const u = find(app, path)
      app.vault.patchConfig("pages", { [DISMISSED]: dismissal(app.vault, u) })
      return { path: u.path }
    },
    text: (r) => `Kept ${r.path} as it is; this version won't be offered again.`,
  }]
}
