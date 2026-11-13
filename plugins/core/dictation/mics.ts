// A browser or a phone can't list a machine's inputs: the form offers the manifest's values there.
import { useEffect, useState } from "react"
import { dictationSource, type MicList, type SettingChoice } from "@vaultite"

export function useMicChoices(): SettingChoice[] | null {
  const src = dictationSource
  const can = !!src?.microphones && !!src.onMicrophones
  const [list, setList] = useState<MicList | null | undefined>(undefined)
  useEffect(() => {
    if (!can) return
    let live = true
    const off = src!.onMicrophones!((l) => { if (live) setList(l) })
    src!.microphones!().then((l) => { if (live) setList((was) => was ?? l) }, () => { if (live) setList((was) => was ?? null) })
    return () => { live = false; off() }
  }, [can, src])
  if (!can || list === null) return null
  const def = list?.inputs.find((m) => m.uid === list.input)
  const now = (label: string, name?: string) => (name ? `${label} (${name})` : label)
  const names = [...new Set((list?.inputs ?? []).map((m) => m.name))]
  return [{ value: "auto", label: now("Automatic", list?.auto) }, { value: "default", label: now("System default", def?.name) },
    ...names.map((n) => ({ value: n, label: n }))]
}
