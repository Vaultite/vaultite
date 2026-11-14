import type { CslItem } from "../csl.ts"
import { entryToCsl } from "./bibtex-csl.ts"
import type { ParseResult } from "./item.ts"
import { inheritAll } from "./bibtex-inherit.ts"
import { lexBibtex, lineAt } from "./bibtex-lexer.ts"
import { makeKey } from "./keys.ts"

const NOT_ITEMS = new Set(["xdata", "set"])

export function parseBibtex(text: string): ParseResult {
  const { entries, problems } = lexBibtex(text)
  inheritAll(entries, problems)
  const items: CslItem[] = [], taken = new Set<string>()
  for (const e of entries) {
    if (NOT_ITEMS.has(e.type)) continue
    if (e.key && taken.has(e.key)) {
      problems.push(`"${e.key}" appears twice: kept the first, skipped the one at line ${lineAt(text, e.at)}`)
      continue
    }
    const item = entryToCsl(e)
    if (!e.key) {
      item.id = makeKey(item, taken)
      problems.push(`An entry at line ${lineAt(text, e.at)} has no key: named it "${item.id}"`)
    }
    taken.add(item.id)
    items.push(item)
  }
  return { items, problems }
}
