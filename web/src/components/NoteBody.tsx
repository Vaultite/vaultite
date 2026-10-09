// A note's text drawn read-only as reading it looks, for slides and PDF export: Markdown (with its images and inline
// embeds), embeds and blocks.
import { useMemo } from "react"
import type { Store } from "@/core/data"
import type { FileCtx } from "@/core/define"
import { readProps } from "@/core/frontmatter"
import { usePrefs } from "@/core/prefs"
import { BlockView, segments, useKindBlocks } from "@/components/Blocks"
import { Markdown } from "@/components/Markdown"
import { EmbedView } from "@/components/NoteEmbed"
import { cn } from "@/lib/utils"

/** `path`'s body (no frontmatter), drawn read-only. `fm`: its frontmatter as text, for the blocks that read it. `whole`:
 *  the file's whole body, so its kind's blocks it doesn't place are drawn on top, as its page has them. */
export function NoteBody({ store, path, body, fm = "", whole, className }: { store: Store; path: string; body: string; fm?: string; whole?: boolean; className?: string }) {
  const { disabled } = usePrefs()
  const kind = useKindBlocks(store, path)
  const parts = useMemo(() => segments(body, whole ? kind : undefined), [body, whole, kind])
  const ctx: FileCtx = useMemo(() => ({ store, path, fm: readProps(fm).props, body }), [store, path, fm, body])
  return (
    <div className={cn("note-body", className)} data-note-body={path}>
      {parts.map((s, i) => "md" in s ? <Markdown key={i} store={store} text={s.md} from={path} full className="note-body-md" />
        : "embed" in s ? <div key={i} className="note-body-embed"><EmbedView store={store} target={s.embed} height={s.height} from={path} seen={[path]} /></div>
        : <div key={i} className="note-body-block"><BlockView name={s.block} text={s.text} ctx={ctx} disabled={disabled} quiet
          nth={parts.slice(0, i).filter((x) => "block" in x && x.block === s.block).length} /></div>)}
    </div>
  )
}
