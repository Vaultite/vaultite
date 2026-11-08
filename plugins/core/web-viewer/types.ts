// Browser's part of the store (/api/state's `bookmarks` and their note's path `bookmarksNote`, `blockedElements` and `siteStyles`, from its plugin.ts): the
// bookmarks note's links, the blocked elements list's rules and each site's style.
import type { Bookmark } from "./bookmarks"
import type { ElementRule } from "./elements"
import type { SiteStyle } from "./sitestyles"

declare module "@vaultite" {
  interface PluginState { bookmarks?: Bookmark[]; bookmarkFolders?: string[]; bookmarksNote?: string | null; blockedElements?: ElementRule[]; siteStyles?: SiteStyle[] }
}
