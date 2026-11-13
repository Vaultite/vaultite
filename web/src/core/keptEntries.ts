import { isText } from "../../../core/values.ts"

export function keptEntries<T>(kept: unknown, isValue: (v: unknown) => v is T): [string, T][] {
  return Array.isArray(kept) ? kept.filter((e): e is [string, T] => Array.isArray(e) && isText(e[0]) && isValue(e[1])) : []
}
