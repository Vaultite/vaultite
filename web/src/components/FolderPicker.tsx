// A folder from the vault's, fuzzy, in the palette overlay ("/" first when it's one): "Move file to…" and a folder
// setting. A folder typed that isn't there is offered as new; the move (or the setting) makes it. Mounted once.
import { useMemo, useState } from "react"
import { Folder, FolderPlus } from "lucide-react"
import { getStore } from "@/core/data"
import { cleanName, folderList, isHidden } from "@/core/files"
import { post } from "@/core/http"
import { notifyError } from "@/core/notify"
import { fuzzy } from "@/core/search"
import { Marked, Palette } from "@/components/Palette"
import { signal } from "@/core/signal"
import { ARCHIVE_DIR } from "../../../core/fileprops.ts"

export type FolderPick = {
  /** The palette's name, its field's placeholder, and what Enter does ("move"). */
  label: string; placeholder: string; verb: string
  /** A folder that can't be typed, nor one inside it (what moves). */
  not?: string
  /** The folders offered ("" is the top level), and every folder there is. */
  folders: string[]; all: string[]
  /** `made`: typed, not there yet. */
  onPick: (folder: string, made: boolean) => void
}
let picking: FolderPick | null = null
const subs = signal()
export function pickFolder(p: FolderPick | null) { picking = p; subs.notify() }

/** A folder for a setting: one of the vault's (not hidden or archive ones), or one typed, made first. */
export function chooseFolder(label: string, onPick: (folder: string) => void) {
  const t = getStore()?.files
  if (!t) return
  const all = folderList(t)
  const folders = all.filter((f) => !isHidden(f) && !f.split("/").includes(ARCHIVE_DIR))
  pickFolder({ label, placeholder: "Choose a folder…", verb: "choose", folders, all, onPick: (f, made) => {
    if (!made) return onPick(f)
    post<{ path: string }>("folder", { path: f }).then((r) => onPick(r.path), (e) => notifyError(e, "Couldn't make the folder"))
  } })
}

export function FolderPicker() {
  const p = subs.use(() => picking)
  return p ? <Picker key={`${p.label}\n${p.not ?? ""}`} p={p} onClose={() => pickFolder(null)} /> : null
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
    if (name && !taken.has(name.toLowerCase()) && !isHidden(name) && (!p.not || (name !== p.not && !name.startsWith(`${p.not}/`)))) {
      out.push({ id: `new-${name}`, path: name, label: name, marks: [], create: true })
    }
    return out
  }, [p, q])
  const pick = (h: Item) => { onClose(); p.onPick(h.path, h.create) }
  return (
    <Palette label={p.label} placeholder={p.placeholder} query={q} setQuery={setQ} items={items} onClose={onClose}
      onPick={(it, { shift }) => {
        // ⇧Enter: make the folder typed.
        const h = shift ? items.find((x) => x.create) : it
        if (h) pick(h)
      }}
      empty={<p className="px-3 py-6 text-center text-[15px] text-muted-foreground">No folder matches "{q.trim()}".</p>}
      hints={[["ArrowUp ArrowDown", "to navigate"], ["Enter", `to ${p.verb}`], ["Shift+Enter", "to make the folder"], ["Escape", "to dismiss"]]}
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
