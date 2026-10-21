// Pick an icon in the palette overlay: Lucide's by name or tag ("music" finds guitar), or an emoji. Mounted once;
// `pickIcon` asks.
import { useEffect, useMemo, useState } from "react"
import { Check } from "lucide-react"
import { anyIcon, isEmoji, loadIconTags } from "@/core/icons"
import { isMac } from "@/core/platform"
import { fuzzy } from "@/core/fuzzy"
import { Bar } from "@/components/kit"
import { Marked, Palette } from "@/components/Palette"
import { signal } from "@/core/signal"

export type IconAsk = { title: string; current?: string; onPick: (name: string) => void; onClose?: () => void }
let asking: IconAsk | null = null
const subs = signal()
/** Ask the user for an icon: `onPick` gets its name (`guitar`) or the emoji; `onClose` runs as it closes, picked or not. */
export function pickIcon(a: IconAsk | null) { asking = a; subs.notify() }

export function IconPicker() {
  const a = subs.use(() => asking)
  return a ? <Picker key={a.title} a={a} onClose={() => { pickIcon(null); a.onClose?.() }} /> : null
}

type Row = { id: string; marks: number[]; about?: string }
const LIMIT = 120

/** The icons on their way: the palette's rows with a bar for each name, enough to fill it as the whole list will. */
function Skeleton() {
  return (
    <div className="loading-in" aria-busy>
      {Array.from({ length: 16 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <span className="grid size-6 shrink-0 place-items-center"><span className="skeleton size-[18px]" /></span>
          <span className="min-w-0 flex-1 text-[15px] leading-[21px]"><Bar w={`${[22, 16, 28, 19, 25][i % 5]}%`} /></span>
        </div>
      ))}
    </div>
  )
}

function Picker({ a, onClose }: { a: IconAsk; onClose: () => void }) {
  const [q, setQ] = useState("")
  const [tags, setTags] = useState<Record<string, string[]> | null>(null)
  useEffect(() => { void loadIconTags().then(setTags) }, [])
  const rows = useMemo((): Row[] => {
    const query = q.trim()
    if (isEmoji(query)) return [{ id: query, marks: [], about: "Emoji" }]
    if (!tags) return []
    const names = Object.keys(tags)
    if (!query) {
      const cur = a.current && (tags[a.current] || isEmoji(a.current)) ? [a.current] : []
      return [...cur, ...names.filter((n) => n !== a.current)].slice(0, LIMIT).map((id) => ({ id, marks: [] }))
    }
    const w = query.toLowerCase()
    // In its name first (the closest first), then what it's about, then names that only match loosely.
    const named = names.flatMap((n) => {
      const m = fuzzy(query, n)
      return m && n.includes(w.split(" ")[0]) ? [{ id: n, marks: m.marks, rank: n === w ? 0 : n.startsWith(w) ? 1 : 2, score: m.score }] : []
    })
    const seen = new Set(named.map((r) => r.id))
    const about = names.flatMap((n) => {
      const t = !seen.has(n) && tags[n].find((x) => x === w || x.startsWith(w) || x.split(" ").some((y) => y.startsWith(w)))
      return t ? [{ id: n, marks: [], about: t, rank: 3, score: t === w ? 1 : 0 }] : []
    })
    about.forEach((r) => seen.add(r.id))
    const loose = names.flatMap((n) => { const m = !seen.has(n) && fuzzy(query, n); return m ? [{ id: n, marks: m.marks, rank: 4, score: m.score }] : [] })
    return [...named, ...about, ...loose].sort((x, y) => x.rank - y.rank || y.score - x.score).slice(0, LIMIT)
      .map(({ rank: _r, score: _s, ...r }) => r)
  }, [tags, q, a.current])

  return (
    <Palette label={a.title} placeholder="Search icons, or type an emoji…" query={q} setQuery={setQ} items={rows} onClose={onClose}
      onPick={(r) => { if (!r) return; onClose(); a.onPick(r.id) }}
      empty={tags ? <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">No icon matches "{q.trim()}".</p> : <Skeleton />}
      hints={[["ArrowUp ArrowDown", "to navigate"], ["Enter", "to pick"], ...(isMac ? [["Ctrl+Mod+Space", "for an emoji"] as [string, string]] : []), ["Escape", "to dismiss"]]}
      row={(r) => {
        const Icon = anyIcon(r.id)
        return (
          <>
            <span className="grid size-6 shrink-0 place-items-center">{Icon && <Icon className="size-[18px]" />}</span>
            <span className="min-w-0 flex-1 truncate text-[15px] leading-[21px] text-foreground/90">{r.about === "Emoji" ? "Use this emoji" : <Marked text={r.id} marks={r.marks} />}</span>
            {r.about && <span className="shrink-0 text-[13px] text-muted-foreground">{r.about}</span>}
            {a.current !== undefined && <Check className={r.id === a.current ? "size-4 shrink-0 text-primary" : "invisible size-4 shrink-0"} strokeWidth={2.5} />}
          </>
        )
      }} />
  )
}
