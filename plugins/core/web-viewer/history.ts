import { useEffect } from "react"
import { webPages } from "@vaultite"
import { needEngine } from "./engine"

export type How = "typed" | "link" | "bookmark" | "form" | "other"
export type Suggestion = { url: string; title: string; host: string; visits: number; typed: number; last: number }
export type Visit = { id: number; url: string; title: string; host: string; at: number; profile: string; how: How }
export type Removed = { url: string; title: string; at: number; profile: string; how: How; source: string }
export type Found = { complete: { text: string; url: string } | null; rows: (Suggestion & { score: number })[] }
export type ImportSource = { browser: "brave" | "chrome"; name: string; profiles: { dir: string; name: string; history: boolean; bookmarks: boolean }[] }
export type ImportedBookmark = { url: string; title: string; folder: string }

export const hasHistory = () => !!webPages?.engine

const ask = needEngine("web pages open in Vaultite's desktop app")

export const searchHistory = (text: string, limit = 8) => ask("history:search", text, limit)
export const topSites = (limit = 8) => ask("history:top", limit)
export const listHistory = (o: { before?: number; text?: string; limit?: number }) => ask("history:list", o)
export const markTyped = (url: string, how: "typed" | "bookmark" = "typed") => { void ask("history:typed", url, how).catch(() => {}) }
export const removeVisits = (o: { visits?: number[]; urls?: string[] }) => ask("history:remove", o)
export const removeSite = (site: string) => ask("history:remove-site", site)
export const clearHistory = (from: number | null, to: number | null) => ask("history:clear", from, to)
export const restoreVisits = (visits: Removed[]) => ask("history:restore", visits)

export const importSources = () => ask("import:sources")
export const importHistory = (browser: string, dir: string, profile: string) => ask("import:history", browser, dir, profile)
export const importBookmarks = (browser: string, dir: string) => ask("import:bookmarks", browser, dir)

export function useHistoryChanged(fn: () => void) {
  useEffect(() => webPages?.on((m) => { if (m.type === "engine:history:changed") fn() }), [fn])
}
