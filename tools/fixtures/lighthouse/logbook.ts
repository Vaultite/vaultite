// The keepers' logbook, loaded only when asked for (its own chunk of the bundle, sharing the app's CodeMirror with it).
import { EditorView } from "@codemirror/view"
import { beam } from "./beam.ts"

export const logbook = () => `The keepers' logbook: calm seas${EditorView ? "." : ""} The beam is ${beam(20, 21)}.`
export const tally = async (hour: number) => (await import("./tally.ts")).tally(hour)
