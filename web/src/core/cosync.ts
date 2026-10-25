// Notes typed in together right now (a plugin's live session: the Companion's co-editing): the server saves them, and
// brings in what changes on disk, so their editors' autosave stands down while they are.

const live = new Map<string, number>()

/** Whether a live session keeps `path` now. */
export const keptLive = (path: string) => (live.get(path) ?? 0) > 0

/** A live session keeps `path` from now: returns how to say it stopped. */
export function keepLive(path: string) {
  live.set(path, (live.get(path) ?? 0) + 1)
  let done = false
  return () => {
    if (done) return
    done = true
    const n = (live.get(path) ?? 1) - 1
    if (n > 0) live.set(path, n); else live.delete(path)
  }
}
