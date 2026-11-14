import { useMemo } from "react"
import type { Store } from "@/core/data"
import type { FileCtx } from "@/core/define"
import { readProps } from "@/core/frontmatter"
import { noteItems } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { BlockView, segments } from "@/components/Blocks"
import { Markdown } from "@/components/Markdown"
import { EmbedView } from "@/components/NoteEmbed"
import { cn } from "@/lib/utils"

/** `path`'s body drawn read-only (`fm`: its frontmatter's text); `print`: with the parts noteEnd prints (`print`). */
export function NoteBody({ store, path, body, fm = "", className, print }: { store: Store; path: string; body: string; fm?: string; className?: string; print?: boolean }) {
  const { disabled } = usePrefs()
  const parts = useMemo(() => segments(body), [body])
  const ctx: FileCtx = useMemo(() => ({ store, path, fm: readProps(fm).props, body }), [store, path, fm, body])
  const ends = useMemo(() => (print ? noteItems(disabled, "end").filter(({ item }) => item.print) : []), [print, disabled])
  return (
    <div className={cn("note-body", className)} data-note-body={path}>
      {parts.map((s, i) => "md" in s ? <Markdown key={i} store={store} text={s.md} from={path} full className="note-body-md" />
        : "embed" in s ? <div key={i} className="note-body-embed"><EmbedView store={store} target={s.embed} height={s.height} from={path} seen={[path]} /></div>
        : <div key={i} className="note-body-block"><BlockView name={s.block} text={s.text} ctx={ctx} disabled={disabled} quiet
          nth={parts.slice(0, i).filter((x) => "block" in x && x.block === s.block).length} /></div>)}
      {ends.map(({ key, item }) => <div key={key} className="note-body-end">{item.render({ path, fm: ctx.fm, type: String(ctx.fm.type ?? "") || null, place: "print" })}</div>)}
    </div>
  )
}
