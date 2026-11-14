import { parseAllDocuments } from "yaml"
import { z } from "zod"
import type { CslItem } from "../csl.ts"
import type { ParseResult } from "./item.ts"
import { CslFields, CslJson, readCslItem } from "./normalize.ts"

const List = z.union([
  z.array(CslJson),
  z.looseObject({ items: z.array(CslJson) }).transform((o) => o.items),
  z.looseObject({ references: z.array(CslJson) }).transform((o) => o.references),
])

function itemsOf(data: CslJson, what: string): ParseResult {
  const list = List.safeParse(data)
  if (!list.success) return { items: [], problems: [`The ${what} isn't a list of items (nor has "items" or "references")`] }
  const items: CslItem[] = [], problems: string[] = [], ids = new Set<string>()
  list.data.forEach((entry, i) => {
    const fields = CslFields.safeParse(entry)
    const read = fields.success ? readCslItem(fields.data) : { item: null, problem: `Item ${i + 1} isn't an object: skipped` }
    if (read.problem) problems.push(read.problem)
    if (!read.item) return
    if (ids.has(read.item.id)) problems.push(`"${read.item.id}" appears twice: kept the first`)
    else items.push(read.item)
    ids.add(read.item.id)
  })
  return { items, problems }
}

export function parseCslJson(text: string): ParseResult {
  let data: CslJson
  try {
    data = CslJson.parse(JSON.parse(text.replace(/^﻿/, "")))
  } catch (err) {
    return { items: [], problems: [`The CSL JSON doesn't parse: ${err instanceof Error ? err.message : String(err)}`] }
  }
  return itemsOf(data, "CSL JSON")
}

export function parseCslYaml(text: string): ParseResult {
  const problems: string[] = []
  for (const doc of parseAllDocuments(text.replace(/^﻿/, ""))) {
    if (doc.errors.length) return { items: [], problems: [`The CSL YAML doesn't parse: ${doc.errors[0].message}`] }
    const data = CslJson.safeParse(doc.toJS())
    if (data.success && data.data !== null) return itemsOf(data.data, "CSL YAML")
  }
  problems.push("The CSL YAML has no items")
  return { items: [], problems }
}
