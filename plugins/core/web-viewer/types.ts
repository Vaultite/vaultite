import type { Bookmark } from "./bookmarks"
import type { ElementRule } from "./elements"
import type { SiteStyle } from "./sitestyles"

declare module "@vaultite" {
  interface PluginState { bookmarks?: Bookmark[]; bookmarkFolders?: string[]; bookmarksNote?: string | null; blockedElements?: ElementRule[]; siteStyles?: SiteStyle[] }
}
