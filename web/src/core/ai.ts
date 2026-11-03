// Use AI, plugins.json's `ai` (core/coreops/ai.ts): off, the plugins whose manifest says `ai` are off, their switches
// kept. Also the coding agents on the server's machine and the companion's agent, for Settings > AI and the first run.
import { useCallback, useEffect, useState } from "react"
import { op } from "@/core/http"
import { isEnabled, pluginById } from "@/core/plugins"
import { pluginSettings } from "@/core/pluginSettings"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"

/** Whether AI is on (the default). */
export const aiOn = () => getPrefs().ai
export const useAi = () => usePrefs().ai
/** Turn AI on or off: the plugins for AI follow at once, their own switches untouched. */
export const setAi = (on: boolean) => setPrefs({ ai: on })

/** A coding agent Vaultite runs (ai.agents): its command on the server's machine (null: not there), its site, and its
 *  plugin (false: one to get from Vaultite's plugins) and whether that's switched on. */
export type CodingAgent = { id: string; name: string; path: string | null; site: string; plugin: boolean; on: boolean }

/** The coding agents, found or not, on the machine the server runs on. */
export const codingAgents = () => op<CodingAgent[]>("ai.agents")

/** codingAgents(), asked when drawn and again with `reload` (after one is installed or switched). */
export function useCodingAgents() {
  const [list, setList] = useState<CodingAgent[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const reload = useCallback(() => codingAgents().then((l) => { setList(l); setError(null) }, setError), [])
  useEffect(() => { void reload() }, [reload])
  return { list, error, reload }
}

// The companion is a plugin of its own (on unless switched off): which agent it runs is its `agent` setting, a
// terminal's agent name ("claude", "codex", an account's "claude_work").
const COMPANION = "companion"
const companionDefault = () => String(pluginById(COMPANION)?.settingsDecls.agent?.default ?? "claude")

/** Whether there's a companion now: its plugin is on (and so is AI). */
export const hasCompanion = () => isEnabled(COMPANION, getPrefs().disabled)
/** The agent the companion runs, by its name in a terminal ("claude"). */
export const companionAgent = () => {
  const v = pluginSettings<{ agent?: unknown }>(COMPANION).get().agent
  return typeof v === "string" && v ? v : companionDefault()
}
export function useCompanionAgent() {
  const v = pluginSettings<{ agent?: unknown }>(COMPANION).use().agent
  return typeof v === "string" && v ? v : companionDefault()
}
/** Have the companion run `agent` (its name in a terminal: an agent's `name`, core/plugins.ts agentsOn). */
export const setCompanion = (agent: string) => pluginSettings<{ agent?: string }>(COMPANION).set({ agent: agent === companionDefault() ? null : agent })
