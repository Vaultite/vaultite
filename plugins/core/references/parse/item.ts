import type { CslDate, CslItem, CslName } from "../csl.ts"

export function put(item: CslItem, key: string, value: string | CslName[] | CslDate | null | undefined) {
  if (value === null || value === undefined || value === "" || item[key] !== undefined) return
  if (Array.isArray(value) && !value.length) return
  item[key] = value
}

export type ParseResult = { items: CslItem[]; problems: string[] }
