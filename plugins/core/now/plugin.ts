// Now: the user's Now note (Now.md, or the setting `path`): what they're on now, a few tracks with their next action,
// and what agents promised them. The kind `now` and the service `now:file`; agents keep it current by editing the file.
import { Plugin } from "../../../core/plugins.ts"
import { Kind } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

const path = plugin.settingFile("path", "Now.md")

plugin.kind(new Kind({
  type: "now", collection: "now", file: path,
  parse: (_fm, body) => [{ body }, []],
  render: (now) => [{}, now.body ?? ""],
}))

/** Where the Now note is (the setting's path, or the one file of type now wherever it moved), null while the user
 *  keeps none: nothing makes it for them. */
const file = () => {
  const now = plugin.vault.get("now", "now")
  return now ? `${now.id}.md` : null
}
plugin.provide("now:file", file)

plugin.state(() => ({ now: plugin.vault.get("now", "now") }))
