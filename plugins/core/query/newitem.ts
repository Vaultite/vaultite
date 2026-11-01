// A new file for a base's view, as Obsidian's New makes one: in the folder its filters ask for, with the properties and
// tags they test for, so it shows in the view. No Node.
import { obj, viewsOf, type BaseConfig } from "./bases.ts"
import { treeOf, type Group } from "./filters.ts"

export type NewItem = { folder: string | null; props: Record<string, unknown> }

/** What a file needs to match view `at`: what every file must be (the conditions all the filters' `and`s hold; an `or`
 *  or a `not` says nothing for sure) that a new file can be made to be. */
export function newItem(cfg: BaseConfig, at: number): NewItem {
  const out: NewItem = { folder: null, props: {} }
  const tags: string[] = []
  const walk = (g: Group) => {
    if (g.kind !== "and") return
    for (const it of g.items) {
      if (it.t === "group") { walk(it); continue }
      if (it.t !== "cond") continue
      if (it.prop === "file") {
        if (it.op === "inFolder" && it.value.trim() && out.folder === null) out.folder = it.value.trim().replace(/^\/+|\/+$/g, "")
        else if (it.op === "hasTag" && it.value.trim()) tags.push(it.value.trim().replace(/^#/, ""))
        continue
      }
      if (it.op !== "==" || /^(file|formula)\./.test(it.prop)) continue
      const key = it.prop.replace(/^note\./, "")
      // (text written in quotes is text, a bare 3 or true a number or yes / no; anything else (this, today()) isn't known)
      const quoted = /["']\s*$/.test(it.src?.trim() ?? "")
      const v = it.value.trim()
      if (quoted) out.props[key] = it.value
      else if (/^-?\d+(\.\d+)?$/.test(v)) out.props[key] = Number(v)
      else if (/^(true|false)$/.test(v)) out.props[key] = v === "true"
    }
  }
  walk(treeOf(cfg.filters))
  walk(treeOf((obj(viewsOf(cfg)[at]) ?? {}).filters))
  if (tags.length) out.props.tags = [...new Set(tags)]
  return out
}
