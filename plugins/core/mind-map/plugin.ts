import fs from "node:fs"
import { OpError, Plugin, vaultPath } from "../../../core/plugins.ts"
import { readText } from "../../../core/vault.ts"
import { canvasOf, headingsIn, treeOf, treeText } from "./tree.ts"

export const plugin = new Plugin(import.meta.url)

plugin.block("mind-map", (ctx) => {
  const depth = Math.max(1, Math.min(9, Number(ctx.options.depth) || 9))
  const name = ctx.path.split("/").pop()!.replace(/\.md$/i, "")
  return treeText(treeOf(headingsIn(ctx.body, ctx.options.lists !== false), name), depth)
})

plugin.op({
  id: "mind-map.canvas",
  summary: "Turn a note's mind map (its headings and lists) into a canvas beside it: a card per branch, arrows between them.",
  help: `The canvas is a new file next to the note ("<note> mind map.canvas"), laid out like the map; editing it leaves the
note as it is. lists: false takes the headings only.

  vau mind-map.canvas "Notes/Launch plan.md"`,
  kind: "write",
  params: {
    path: { type: "string", format: "path", required: true, description: "the note" },
    lists: { type: "boolean", description: "its list items too (default true)" },
  },
  args: ["path"],
  run: async ({ path: given, lists }, ctx) => {
    const rel = vaultPath(String(given ?? ""), true, plugin.vault)
    if (!/\.md$/i.test(rel)) throw new OpError(`${rel} isn't a note`)
    const name = rel.split("/").pop()!.replace(/\.md$/i, "")
    const root = treeOf(headingsIn(readText(plugin.vault.abs(rel)), lists !== false), name)
    if (!root.children.length) throw new OpError(`${rel} has no headings or lists to map`)
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : ""
    let out = ""
    for (let n = 0; ; n++) { out = `${dir}${name} mind map${n ? ` ${n}` : ""}.canvas`; if (!fs.existsSync(plugin.vault.abs(out))) break }
    await ctx.api("POST", "file", { path: out, text: canvasOf(root, rel) })
    return { path: out }
  },
  text: (r: { path: string }) => `Made ${r.path}.`,
  did: ({ path }) => ({ action: "create", text: `Turned ${path}'s mind map into a canvas` }),
})

