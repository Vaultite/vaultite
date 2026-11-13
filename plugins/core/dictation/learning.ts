import { notify, op } from "@vaultite"
import { type Entry, learnedList, type Teach, watchWith } from "../../../core/desktop/dictationlearn.ts"

export { SETTLE_MS, WATCH_MS, type Watch } from "../../../core/desktop/dictationlearn.ts"

const inApp: Teach = {
  add: async (e) => (await op<{ added: Entry | null }>("dictation.add", { ...e, fixed: true }))?.added ?? null,
  remove: (e) => op("dictation.remove", { ...e }),
  told: (added, undo) => notify(`Added ${learnedList(added)} to your dictionary`, { duration: 6000, action: { label: "Undo", run: undo } }),
}

export const watchFix = (said: string, read: () => string | null) => watchWith(said, read, inApp)
