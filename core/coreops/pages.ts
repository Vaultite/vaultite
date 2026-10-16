// Plugins' pages (core/pages.ts): each plugin writes its own once when it's turned on; this writes them again.
import type { App } from "../app.ts"
import { type Op, OpError } from "../ops.ts"
import { restorePages } from "../pages.ts"
import { enabled } from "../plugins.ts"

export function pageOps(app: App): Op[] {
  return [{
    id: "dashboard.restore",
    cli: "dashboard restore",
    summary: "Write the pages of the plugins that are on that the pages folder has no file for (one deleted comes back).",
    help: `A plugin writes its pages (Today, People...) once, when it's turned on, into the user's pages folder (the folder
Dashboards' settings show, Dashboards/ by default) as the user's files. This writes those that folder has no file of
that name for (not pinned), and moves what named the read-only copies older versions kept in .vaultite/pages/ (pins,
links, the new tab's page) to the user's files, the old folder going. Running it again changes nothing.

  vau dashboard restore
  vau dashboard restore --plugin today`,
    kind: "write",
    params: { plugin: { type: "string", description: "only this plugin's pages (its id or name; it must be on)" } },
    run: ({ plugin }) => {
      let only: string | undefined
      if (plugin) {
        const q = String(plugin).trim().toLowerCase()
        const p = app.plugins.find((x) => x.id === q) ?? app.plugins.find((x) => String(x.manifest.name ?? "").toLowerCase() === q)
        if (!p) throw new OpError(`no plugin '${plugin}'`, 404)
        if (!enabled(app.vault, app.plugins).has(p.id)) throw new OpError(`${p.manifest.name ?? p.id} is off: turn it on (vau plugin on ${p.id}), which writes its pages`)
        only = p.id
      }
      return restorePages(app.vault, app.plugins, only)
    },
    text: (r) => [r.made.length ? `Wrote ${r.made.join(", ")}.` : "Every page is there already.",
      ...(r.moved.length ? [`The old copies in .vaultite/pages are gone: pins and links to them go to ${r.moved.map(([, to]: string[]) => to).join(", ")}.`] : [])].join("\n"),
  }]
}
