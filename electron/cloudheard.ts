import type { CloudSession } from "./cloud.ts"

let last: CloudSession[] = []
const heard = new Set<(list: CloudSession[]) => void>()
export function tellCloud(list: CloudSession[]) {
  last = list
  for (const fn of heard) fn(list)
}
export function onCloud(fn: (list: CloudSession[]) => void) {
  heard.add(fn)
  fn(last)
  return () => { heard.delete(fn) }
}
