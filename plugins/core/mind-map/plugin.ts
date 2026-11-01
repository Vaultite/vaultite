// Mind map's block as text: the note's headings as a nested list (what an agent reads where the app draws the map).
import { Plugin } from "../../../core/plugins.ts"
import { headingsIn, treeOf, treeText } from "./tree.ts"

export const plugin = new Plugin(import.meta.url)

plugin.block("mind-map", (ctx) => {
  const depth = Math.max(1, Math.min(6, Number(ctx.options.depth) || 6))
  const name = ctx.path.split("/").pop()!.replace(/\.md$/i, "")
  return treeText(treeOf(headingsIn(ctx.body), name), depth)
})
