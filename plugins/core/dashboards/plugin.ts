// Dashboards' server side: the header's subtitle for /api/render ("page-head"). Installing plugins' pages is the
// core's, pinning them Pinned's; `vau dashboard new` makes one.
import { OpError, Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"]

/** "Tuesday, 29 September 2026" */
function longDate(d = new Date()) {
  return `${DAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** A dashboard's subtitle under its title ("{date}" is today's date), for /api/render. */
plugin.provide("page-head", ({ type, fm }: { path: string; type: string | null; fm: Record<string, unknown> }) =>
  type === "dashboard" && typeof fm.subtitle === "string" && fm.subtitle ? fm.subtitle.replaceAll("{date}", longDate()) : null)

plugin.op({
  id: "dashboard.create",
  cli: "dashboard new",
  summary: "Make a new page (a dashboard file of blocks) and pin it.",
  help: `Writes <Name>.md (type: dashboard) where the user's own pages are (the folder Dashboards' settings show; not the
built-in .vaultite/pages; Dashboards/ by default) and pins it to the sidebar (with Pinned on; with Workspaces on, in the workspace the user's window is on). blocks puts those blocks in it
(names from vau blocks); add more by editing the file: each block is a fence, \`\`\`block-<name> with its options inside as
YAML. icon: a lucide name (sun, heart, wallet, chart-line...; icon.list has them); tint: a colour token (blue, green,
orange, purple, today, people...); subtitle: "{date}" is today's date.

  vau dashboard new Focus --icon target --tint orange --blocks routines,week-goals
  vau dashboard new Finance --icon wallet --tint green --subtitle "{date}"`,
  kind: "write",
  params: {
    name: { type: "string", required: true, description: "the page's name (its file's name)" },
    icon: { type: "string", description: "a lucide icon's name (target, wallet, heart)" },
    tint: { type: "string", description: "a colour token (blue, green, orange, purple, today, people)" },
    subtitle: { type: "string", description: "a line under its title; {date} is today's date" },
    blocks: { type: "array", items: { type: "string" }, description: "blocks to put in it, by name (vau blocks lists them)" },
    noPin: { type: "boolean", description: "don't pin it" },
  },
  args: ["name"],
  run: async ({ name: raw, icon, tint, subtitle, blocks, noPin }, ctx) => {
    const name = String(raw).trim()
    if (!name) throw new OpError("name is missing: the page's name")
    if (/[:/\\?*"<>|#^[\]]/.test(name)) throw new OpError("a page's name can't have : / \\ ? * \" < > | # ^ [ ]")
    const dir = plugin.vault.pagesHome() // (never the built-in pages' folder: read-only)
    const rel = `${dir ? `${dir}/` : ""}${name}.md`
    const fm = ["type: dashboard"]
    for (const [k, v] of [["icon", icon], ["tint", tint], ["subtitle", subtitle]] as const) {
      if (v) fm.push(`${k}: ${/^[\w -]+$/.test(v) && !/^\s|\s$/.test(v) ? v : JSON.stringify(v)}`)
    }
    const body = ((blocks ?? []) as string[]).map((b) => "```block-" + b.trim() + "\n```\n").join("\n")
    try {
      await ctx.api("POST", "file", { path: rel, text: `---\n${fm.join("\n")}\n---\n\n${body}` })
    } catch (e) {
      if (e instanceof OpError && e.status === 409) throw new OpError(`${rel} already exists: edit it (vau read / vau write), or pick another name`, 409)
      throw e
    }
    const icons: string[] = icon ? await ctx.op("icon.list") : []
    // Pinned where the user sees it (Pinned's page.pin: the window's workspace's list with Workspaces on); without
    // Pinned the page stays unpinned.
    const pinnedTo = noPin ? null : await ctx.op("page.pin", { path: rel }).then((r: { label: string }) => r.label, () => null)
    return { path: rel, pinned: pinnedTo !== null, ...(icon && icons.length && !icons.includes(icon) ? { unknownIcon: icon, icons } : {}) }
  },
  text: (r) => `Made ${r.path}${r.pinned ? " and pinned it" : ""}.` +
    (r.unknownIcon ? `\n(the app has no icon '${r.unknownIcon}' for pages; it shows the default. Icons: ${r.icons.join(", ")})` : "") +
    `\nAdd blocks by editing it; see them with: vau render "${r.path}"`,
})
