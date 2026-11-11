// How long an agent asking nothing stays in view before it folds under Earlier, as the user set it (the Agents plugin's
// setting `fold`, in Settings > AI): the Terminals panel's and the Agents panel's.
import { pluginSettings, QUIET_AFTER } from "@vaultite"

/** In ms; null: never, every one stays listed. */
export function useFoldAfter(): number | null {
  const v = pluginSettings("agents").use(true)?.fold
  if (v === "never") return null
  const min = Number(v)
  return min > 0 ? min * 60_000 : QUIET_AFTER
}
