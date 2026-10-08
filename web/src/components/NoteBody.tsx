// A note's text drawn read-only as reading it looks, for slides and PDF export: Markdown, embeds and blocks, plus the
// vault's images, which the editor draws itself and Markdown alone doesn't.
import { useEffect, useMemo, useRef } from "react"
import type { Store } from "@/core/data"
import type { FileCtx } from "@/core/define"
import { readProps } from "@/core/frontmatter"
import { usePrefs } from "@/core/prefs"
import { BlockView, segments, useKindBlocks } from "@/components/Blocks"
import { assetPath } from "@/components/EmbedMenu"
import { rawUrl } from "@/components/FileViewers"
import { Markdown } from "@/components/Markdown"
import { EmbedView } from "@/components/NoteEmbed"
import { cn } from "@/lib/utils"

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic)$/i

/** A vault image by its name or path (as an embed or a Markdown link writes it): its address, or null. */
function imageUrl(store: Store, name: string): string | null {
  const hit = assetPath(store, name.trim())
  return hit ? new URL(rawUrl(hit), document.baseURI).href : null
}

/** Images in the vault as Markdown images with full addresses (which Markdown draws), outside code; a width
 *  (`|300`) rides in the address's fragment, applied once drawn. */
function withImages(store: Store, md: string): string {
  let fence = ""
  return md.split("\n").map((line) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f) { if (!fence) fence = f[1]; else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = ""; return line }
    if (fence) return line
    return line
      .replace(/!\[\[([^\]|\n]+?)(?:\|([^\]\n]*))?\]\]/g, (all, target: string, alias?: string) => {
        if (!IMAGE.test(target.trim())) return all
        const url = imageUrl(store, target)
        if (!url) return all
        const w = /^\s*(\d+)(?:x\d+)?\s*$/.exec(alias ?? "")
        return `![${target.trim().replace(/[[\]]/g, "")}](${url.replace(/\)/g, "%29")}${w ? `#w${w[1]}` : ""})`
      })
      .replace(/!\[([^\]\n]*)\]\(<?([^)>\n\s]+)>?\)/g, (all, alt: string, src: string) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(src) || !IMAGE.test(src)) return all
        const url = imageUrl(store, src)
        return url ? `![${alt}](${url.replace(/\)/g, "%29")})` : all
      })
  }).join("\n")
}

/** `path`'s body (no frontmatter), drawn read-only. `fm`: its frontmatter as text, for the blocks that read it. `whole`:
 *  the file's whole body, so its kind's blocks it doesn't place are drawn on top, as its page has them. */
export function NoteBody({ store, path, body, fm = "", whole, className }: { store: Store; path: string; body: string; fm?: string; whole?: boolean; className?: string }) {
  const { disabled } = usePrefs()
  const kind = useKindBlocks(store, path)
  const parts = useMemo(() => segments(body, whole ? kind : undefined), [body, whole, kind])
  const ctx: FileCtx = useMemo(() => ({ store, path, fm: readProps(fm).props, body }), [store, path, fm, body])
  const ref = useRef<HTMLDivElement>(null)
  // Widths given as `|300` (see withImages).
  useEffect(() => {
    for (const img of ref.current?.querySelectorAll<HTMLImageElement>("img[src*='#w']") ?? []) {
      const w = /#w(\d+)$/.exec(img.getAttribute("src") ?? "")
      if (w) img.style.width = `${w[1]}px`
    }
  })
  return (
    <div ref={ref} className={cn("note-body", className)} data-note-body={path}>
      {parts.map((s, i) => "md" in s ? <Markdown key={i} store={store} text={withImages(store, s.md)} from={path} full className="note-body-md" />
        : "embed" in s ? <div key={i} className="note-body-embed"><EmbedView store={store} target={s.embed} height={s.height} from={path} seen={[path]} /></div>
        : <div key={i} className="note-body-block"><BlockView name={s.block} text={s.text} ctx={ctx} disabled={disabled} quiet
          nth={parts.slice(0, i).filter((x) => "block" in x && x.block === s.block).length} /></div>)}
    </div>
  )
}
