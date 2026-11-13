import { Plugin } from "../../../core/plugins.ts"
import { Kind } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

const path = plugin.settingFile("path", "Now.md")

plugin.kind(new Kind({
  type: "now", collection: "now", file: path,
  parse: (_fm, body) => [{ body }, []],
  render: (now) => [{}, now.body ?? ""],
}))

const file = () => {
  const now = plugin.vault.get("now", "now")
  return now ? `${now.id}.md` : null
}
plugin.provide("now:file", file)

plugin.state(() => ({ now: plugin.vault.get("now", "now") }))
