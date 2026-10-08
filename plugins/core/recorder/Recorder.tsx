// Records while it's mounted (the plugin on), as long as its settings say.
import { useEffect } from "react"
import { usePluginSettings } from "@vaultite"
import { setKeep, startRecording } from "./record"

export function Recorder() {
  const [settings] = usePluginSettings("recorder")
  useEffect(() => setKeep(Number(settings?.minutes) || 5, settings?.typed_text === true), [settings])
  useEffect(startRecording, [])
  return null
}
