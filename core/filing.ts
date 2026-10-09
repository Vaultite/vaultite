// Where things go, one answer for the app, the API and the settings: the attachment folder, the excluded files and
// each kind's folder, from the vault's settings (another app's under them: Vault.configWithDefaults).
import type { Home } from "./fileprops.ts"
import { pagesHome } from "./pages.ts"
import type { Vault } from "./vault.ts"

/** Where things go, as the settings show and the app follows them: the attachment folder (Obsidian's way of writing
 *  it), the excluded files (both files.json's, else another app's) and each kind's folder (Vault.home). */
export function filing(vault: Vault): { attachments: string; excluded: string[]; homes: Home[] } {
  const files = vault.configWithDefaults("files"), own = vault.config("folders")
  const at = typeof files.attachmentFolder === "string" ? files.attachmentFolder.trim() : ""
  const homes: Home[] = vault.kinds.filter((k) => !k.file && k.plugin).map((k) => ({
    key: k.collection, type: k.type, plugin: k.plugin!, label: k.spec.label ?? k.collection.charAt(0).toUpperCase() + k.collection.slice(1),
    folder: vault.home(k.collection) ?? k.folder ?? "", set: typeof own[k.collection] === "string",
  }))
  homes.push({ key: "dashboards", type: "dashboard", plugin: "dashboards", label: "Dashboards", folder: pagesHome(vault), set: typeof own.dashboards === "string" })
  return { attachments: at || "Attachments", excluded: Array.isArray(files.excluded) ? files.excluded.filter((f): f is string => typeof f === "string") : [], homes }
}
