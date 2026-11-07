// Words just dictated, watched a minute for the user's fixes (Wispr Flow's window): what a fix teaches goes into the
// dictionary, said with a toast and its Undo. The editor, terminals and fields each say how to read their words back.
import { notify, op } from "@vaultite"
import { learnedList, type Teach, watchWith } from "./learn.ts"
import type { Entry } from "./words.ts"

export { SETTLE_MS, WATCH_MS, type Watch } from "./learn.ts"

const inApp: Teach = {
  add: async (e) => (await op<{ added: Entry | null }>("dictation.add", { ...e, fixed: true }))?.added ?? null,
  remove: (e) => op("dictation.remove", { ...e }),
  told: (added, undo) => notify(`Added ${learnedList(added)} to your dictionary`, { duration: 6000, action: { label: "Undo", run: undo } }),
}

/** Watch `said`, as `read` gives it now (null: lost, as when the user went elsewhere). */
export const watchFix = (said: string, read: () => string | null) => watchWith(said, read, inApp)
