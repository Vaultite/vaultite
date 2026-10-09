// Plugins' pages are built in (core/pages.ts): copying one into the vault to make it the user's, and the one-time offer
// to remove copies of them a vault has from before that the user never changed.
import fs from "node:fs"
import type { App } from "../app.ts"
import { inPagesDir } from "../fileprops.ts"
import { type Op, OpError } from "../ops.ts"
import { copyPage, uncopy, unedited } from "../pages.ts"
import { lines } from "./common.ts"

/** pages.json: the user answered the offer to remove unedited copies. */
const OFFERED = "copiesOffered"

/** What the offer leaves behind once answered: the copies the app last installed and their versions. */
function forgetOld(app: App) {
  for (const p of [".vaultite/generated/Dashboards", ".vaultite/generated/versions.json"]) fs.rmSync(app.vault.abs(p), { recursive: true, force: true })
  app.vault.patchConfig("pages", { [OFFERED]: true, dismissedUpdates: null })
}

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
  }, {
    id: "dashboard.copies",
    cli: "dashboard copies",
    summary: "Pages in the vault that are unchanged copies of a plugin's page (from before pages were built in).",
    help: `A vault from before plugins' pages were built in has them as copies among its files. The ones the user never
changed can go (vau dashboard uncopy): the built-in page comes back in each one's place, pins and links following, and
updates with its plugin. offered: the app has asked the user once already.

  vau dashboard copies`,
    kind: "read",
    run: () => ({ offered: app.vault.config("pages")[OFFERED] === true, copies: unedited(app.vault, app.plugins) }),
    text: (r) => lines(r.copies.map((c: { path: string; plugin: string }) => `${c.path} (${c.plugin})`), "No unchanged copies.") +
      (r.offered ? "\n(the user was asked about them already)" : ""),
  }, {
    id: "dashboard.uncopy",
    cli: "dashboard uncopy",
    summary: "Remove unchanged copies of plugins' pages (to the trash): the built-in pages come back in their place.",
    help: `Moves the copies vau dashboard copies lists (or only paths) to the trash; each one's built-in page comes back,
its pins and links following. keep: remove none, only record that the user said no (the app asks once). Ask first.

  vau dashboard uncopy
  vau dashboard uncopy --paths '["Dashboards/Today.md"]'
  vau dashboard uncopy --keep`,
    kind: "write",
    params: {
      paths: { type: "array", items: { type: "string" }, description: "only these copies" },
      keep: { type: "boolean", description: "remove none: the user keeps them" },
    },
    run: ({ paths, keep }) => {
      const removed = keep ? [] : uncopy(app.vault, app.plugins, Array.isArray(paths) ? paths.map(String) : undefined)
      if (!paths || keep) forgetOld(app)
      return { removed: removed.map((r) => r.path) }
    },
    text: (r) => (r.removed.length ? `Moved to the trash: ${r.removed.join(", ")}. Their built-in pages are back.` : "Kept them."),
  }]
}
