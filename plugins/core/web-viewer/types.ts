// Browser's part of the store (/api/state's `bookmarks` and `blockedElements`, from its plugin.ts): the bookmarks note's
// links and the blocked elements note's rules.
import type { Bookmark } from "./bookmarks"
import type { ElementRule } from "./elements"

declare module "@vaultite" {
  interface PluginState { bookmarks?: Bookmark[]; blockedElements?: ElementRule[] }
}
