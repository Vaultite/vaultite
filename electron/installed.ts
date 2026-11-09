// After an update: whether what runs is what's installed. An app opened while an update swapped its bundle runs the tree
// that was replaced (its files stay readable), while the disk holds the new one.
import { codeAt } from "./identity.ts"

/** The commit installed at `root` now, as on disk (null: none, or unreadable). */
export const installedCommit = (root: string): string | null => codeAt(root)?.commit || null

/** Once a server is up: `restart` it (once a run) when it runs another commit than the installed one; `stale`: the app
 *  itself started from the replaced tree (a restart of the whole app brings it onto the installed one). */
export function afterUpdate(o: { installed: string | null; app: string | null; server: string | null; restarted: boolean }) {
  const off = (c: string | null) => !!o.installed && !!c && c !== o.installed
  return { stale: off(o.app), restart: off(o.server) && !o.restarted }
}
