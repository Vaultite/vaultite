type Owner = { kind: "joining" | "live" }
const owners = new Map<string, Owner>()
const backs = new Set<(path: string, base: string | null) => void>()

/** Whether a live session keeps `path` now (joining it or typed in): its editors' autosave stands down. */
export const keptLive = (path: string) => owners.has(path)
export const typedLive = (path: string) => owners.get(path)?.kind === "live"

/** A live session takes `path`'s saving (joining it): `live` once typed in, `handBack` on `base` (the text the server
 *  has then; none: what its editors last saved). A later hold on the path replaces this one, whose calls do nothing. */
export function keepLive(path: string) {
  const me: Owner = { kind: "joining" }
  owners.set(path, me)
  return {
    live() { if (owners.get(path) === me) me.kind = "live" },
    handBack(base: string | null = null) {
      if (owners.get(path) !== me) return
      owners.delete(path)
      for (const fn of backs) fn(path, base)
    },
  }
}

export function onHandBack(fn: (path: string, base: string | null) => void) {
  backs.add(fn)
  return () => { backs.delete(fn) }
}
