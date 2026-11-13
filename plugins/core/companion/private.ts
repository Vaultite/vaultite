import { pluginSettings } from "@vaultite"
import { viewOf } from "./live"
import { isPrivate } from "./text"

const settings = pluginSettings<{ private?: unknown }>("companion")

export function privateNote(path: string, text = viewOf(path)?.state.doc.sliceString(0, 4096) ?? "") {
  const folders = settings.get().private
  return isPrivate(path, text, Array.isArray(folders) ? folders.map(String) : [])
}
