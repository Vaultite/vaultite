import { pluginSettings, QUIET_AFTER } from "@vaultite"

/** In ms; null: never, every one stays listed. */
export function useFoldAfter(): number | null {
  const v = pluginSettings("agents").use(true)?.fold
  if (v === "never") return null
  const min = Number(v)
  return min > 0 ? min * 60_000 : QUIET_AFTER
}
