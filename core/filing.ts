import type { Home } from "./fileprops.ts"
import type { Vault } from "./vault.ts"
import { strings } from "./values.ts"

export function filing(vault: Vault): { attachments: string; excluded: string[]; samples: string[]; homes: Home[] } {
  const files = vault.configWithDefaults("files"), own = vault.config("folders")
  const at = typeof files.attachmentFolder === "string" ? files.attachmentFolder.trim() : ""
  const homes: Home[] = vault.kinds.filter((k) => !k.file && k.plugin).map((k) => ({
    key: k.collection, type: k.type, plugin: k.plugin!, label: k.spec.label ?? k.collection.charAt(0).toUpperCase() + k.collection.slice(1),
    folder: vault.home(k.collection) ?? k.folder ?? "", set: typeof own[k.collection] === "string",
  }))
  homes.push({ key: "dashboards", type: "dashboard", plugin: "dashboards", label: "Dashboards", folder: vault.pagesHome(), set: typeof own.dashboards === "string" })
  return { attachments: at || "Attachments", excluded: strings(files.excluded), samples: vault.samples(), homes }
}
