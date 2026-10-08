// Made-up notes for plugin previews (Plugins → a plugin).
import { addDays, today, type Store } from "@vaultite"
import type { Note } from "./types"

export function mockNotes(): Partial<Store> {
  const d = (n: number) => addDays(today(), -n)
  const utc = (day: string) => `${day} 12:00:00`
  const N = (title: string, kind: string, body: string, ago: number, extra: Partial<Note> = {}): Note => ({
    id: `Notes/${title}`, title, kind, body, tags: "", status: null, journal: false, source: "claude", ext_id: null,
    created_at: utc(d(ago)), updated_at: utc(d(ago)), aliases: [], ...extra,
  })
  const notes = [
    N("Weekend trip ideas", "idea", "## Options\n- The coast with [[Alice Rivera]]\n- **A cabin weekend** if it snows early\n\nSee [[Packing list]].", 0,
      { status: "exploring", tags: "Travel" }),
    N("Packing list", "note", "- [x] Headlamp\n- [ ] Rain jacket\n- [ ] Snacks", 2, { tags: "Travel" }),
    N("A calm Sunday", "note", "Slow morning, long walk, called [[Bob Chen]]. Felt rested.", 3, { tags: "Journal", journal: true }),
  ]
  return { notes }
}
