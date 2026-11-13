import { op } from "@/core/http"
import { notifyError } from "@/core/notify"
import { signal } from "@/core/signal"
import { strings } from "../../../core/values.ts"

export type PaletteFile = { pinned?: unknown }

let own: string[] | null = null, seeded: string[] = []
let pins: string[] = []
const changed = signal()
const publish = () => { pins = own ?? seeded; changed.notify() }

export function hydratePalette(saved: PaletteFile | undefined, seeds: { palette?: PaletteFile } | undefined) {
  const next = Array.isArray(saved?.pinned) ? strings(saved.pinned) : null, from = strings(seeds?.palette?.pinned)
  if (JSON.stringify([next, from]) === JSON.stringify([own, seeded])) return
  own = next
  seeded = from
  publish()
}

export const pinnedCommands = () => pins
export const usePinnedCommands = () => changed.use(pinnedCommands)

export function pinCommand(id: string, on: boolean) {
  const was = own
  own = on ? [...pins.filter((x) => x !== id), id] : pins.filter((x) => x !== id)
  publish()
  return op(on ? "palette.pin" : "palette.unpin", { id }).catch((e) => {
    own = was
    publish()
    notifyError(e, on ? "Couldn't pin the command" : "Couldn't unpin the command")
  })
}
