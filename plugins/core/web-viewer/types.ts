// Browser's part of the store (/api/state's `bookmarks`, `blockedElements` and `siteStyles`, from its plugin.ts): the
// bookmarks note's links, the blocked elements list's rules and each site's style.
import type { Bookmark } from "./bookmarks"
import type { ElementRule } from "./elements"
import type { SiteStyle } from "./sitestyles"

declare module "@vaultite" {
  interface PluginState { bookmarks?: Bookmark[]; blockedElements?: ElementRule[]; siteStyles?: SiteStyle[] }
}
