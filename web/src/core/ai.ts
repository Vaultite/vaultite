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

export type CodingAgent = { id: string; name: string; path: string | null; site: string; plugin: boolean; on: boolean }

export const codingAgents = () => op<CodingAgent[]>("ai.agents")

export function useCodingAgents() {
  const [list, setList] = useState<CodingAgent[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const reload = useCallback(() => codingAgents().then((l) => { setList(l); setError(null) }, setError), [])
  useEffect(() => { void reload() }, [reload])
  return { list, error, reload }
}

const COMPANION = "companion"
const companionDefault = () => String(pluginById(COMPANION)?.settingsDecls.agent?.default ?? "claude")

export const hasCompanion = () => isEnabled(COMPANION, getPrefs().disabled)
export const companionAgent = () => {
  const v = pluginSettings<{ agent?: unknown }>(COMPANION).get().agent
  return typeof v === "string" && v ? v : companionDefault()
}
export function useCompanionAgent() {
  const v = pluginSettings<{ agent?: unknown }>(COMPANION).use().agent
  return typeof v === "string" && v ? v : companionDefault()
}
export const setCompanion = (agent: string) => pluginSettings<{ agent?: string }>(COMPANION).set({ agent: agent === companionDefault() ? null : agent })
