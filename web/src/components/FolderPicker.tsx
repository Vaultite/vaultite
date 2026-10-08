// "Move file to…": a fuzzy folder list in the palette overlay, "/" first; a folder typed that isn't
// there is made by the move. Mounted once; pickFolder asks.
import { useMemo, useState } from "react"
import { Folder, FolderPlus } from "lucide-react"
import { cleanName, isHidden } from "@/core/files"
import { fuzzy } from "@/core/search"
import { Marked, Palette } from "@/components/Palette"
import { signal } from "@/core/signal"

export type FolderPick = {
  /** What moves (for the field's placeholder), and its path (it can't go inside itself). */
  name: string; path: string
  /** The folders it can go to ("" is the top level), and every folder there is. */
  folders: string[]; all: string[]
  onPick: (folder: string) => void
}
let picking: FolderPick | null = null
const subs = signal()
export function pickFolder(p: FolderPick | null) { picking = p; subs.notify() }

export function FolderPicker() {
  const p = subs.use(() => picking)
  return p ? <Picker key={p.path} p={p} onClose={() => pickFolder(null)} /> : null
}

/** A typed folder path, made safe the way renames are ("a/b:c" -> "a/b c"). */
const cleanFolder = (s: string) =>
  s.split("/").map(cleanName).filter((x) => x && x !== "." && x !== "..").join("/")

type Item = { id: string; path: string; label: string; marks: number[]; create: boolean }

function Picker({ p, onClose }: { p: FolderPick; onClose: () => void }) {
  const [q, setQ] = useState("")
  const items = useMemo((): Item[] => {
    const query = q.trim().replace(/^\/+|\/+$/g, "")
    const all = p.folders.map((f) => ({ id: `f-${f}`, path: f, label: f || "/", marks: [] as number[], score: 0, create: false }))
    if (!query) return all
    const out: Item[] = all.flatMap((h) => { const m = fuzzy(query, h.label); return m ? [{ ...h, ...m }] : [] }).sort((a, b) => b.score - a.score)
    const name = cleanFolder(query)
    const taken = new Set(p.all.map((f) => f.toLowerCase()))
    if (name && !taken.has(name.toLowerCase()) && !isHidden(name) && name !== p.path && !name.startsWith(`${p.path}/`)) {
      out.push({ id: `new-${name}`, path: name, label: name, marks: [], create: true })
    }
    return out
  }, [p, q])
  const pick = (folder: string) => { onClose(); p.onPick(folder) }
  return (
    <Palette label="Move to folder" placeholder={`Move "${p.name}" to…`} query={q} setQuery={setQ} items={items} onClose={onClose}
      onPick={(it, { shift }) => {
        // ⇧Enter: make the folder typed.
        const h = shift ? items.find((x) => x.create) : it
        if (h) pick(h.path)
      }}
      empty={<p className="px-3 py-6 text-center text-[15px] text-muted-foreground">No folder matches "{q.trim()}".</p>}
      hints={[["ArrowUp ArrowDown", "to navigate"], ["Enter", "to move"], ["Shift+Enter", "to make the folder"], ["Escape", "to dismiss"]]}
      row={(h) => (
        <>
          {h.create
            ? <FolderPlus className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />
            : <Folder className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />}
          <span className="min-w-0 flex-1 truncate text-[15px] leading-[21px] text-foreground/90"><Marked text={h.label} marks={h.marks} /></span>
          {(h.create || !h.path) && <span className="shrink-0 text-[13px] text-muted-foreground">{h.create ? "New folder" : "Vault root"}</span>}
        </>
      )} />
  )
}
