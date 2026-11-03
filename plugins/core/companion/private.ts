// Private notes: kept from the agents (the setting's folders, or `companion: private` in a note's properties). The
// server drops what comes from them; the app doesn't offer the agents there either.
import { pluginSettings } from "@vaultite"
import { viewOf } from "./live"
import { isPrivate } from "./text"

const settings = pluginSettings<{ private?: unknown }>("companion")

/** Whether `path` is private; `text`: its start (the frontmatter), else its open editor's. */
export function privateNote(path: string, text = viewOf(path)?.state.doc.sliceString(0, 4096) ?? "") {
  const folders = settings.get().private
  return isPrivate(path, text, Array.isArray(folders) ? folders.map(String) : [])
}
