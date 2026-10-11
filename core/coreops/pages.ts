// Plugins' pages are built in (core/pages.ts): copying one into the vault makes it the user's.
import type { App } from "../app.ts"
import { inPagesDir } from "../fileprops.ts"
import { type Op, OpError } from "../ops.ts"
import { copyPage } from "../pages.ts"

export function pageOps(app: App): Op[] {
  return [{
    id: "dashboard.copy",
    cli: "dashboard copy",
    summary: "Copy a plugin's built-in page into the vault, to change it: from then on it's the user's file.",
    help: `Plugins' pages are built in (.vaultite/pages/): read-only, and they update with their plugin. Copying one makes
it a file of the user's, in folder (else where their pages are, Dashboards/ by default); its pins and links follow the
copy, and the built-in one goes. The copy no longer updates with its plugin.

  vau dashboard copy .vaultite/pages/Dashboards/Today.md
  vau dashboard copy Today --folder Personal/Dashboards`,
    kind: "write",
    params: {
      path: { type: "string", required: true, description: "the built-in page: its path (.vaultite/pages/Dashboards/Today.md) or name (Today)" },
      folder: { type: "string", description: "the vault folder to copy it into (else where the user's pages are)" },
    },
    args: ["path"],
    run: ({ path, folder }) => {
      const q = String(path).trim().replace(/^\/+/, "")
      const page = inPagesDir(q) ? q : [...app.vault.entries.keys()].find((r) => inPagesDir(r) && r.split("/").pop()!.toLowerCase() === `${q.replace(/\.md$/i, "")}.md`.toLowerCase())
      if (!page) throw new OpError(`no built-in page '${path}'`, 404)
      return { from: page, path: copyPage(app.vault, page, folder ? String(folder) : null) }
    },
    text: (r) => `Copied ${r.from} to ${r.path}: it's yours now (pins and links follow it).`,
  }]
}
