// Any vault file drawn as `![[file]]` draws it in a note, for plugins (a canvas's file cards). `fill`: no header,
// filling its parent's box.
import type { Store } from "@/core/data"
import { inVault, isMd, isMediaEmbed, stem } from "@/core/files"
import { kindOf } from "@/core/filekinds"
import { formatFor } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { FileCard, MediaEmbed, rawUrl, useFileInfo } from "@/components/FileViewers"
import { FormatEmbed } from "@/components/FormatView"
import { NoteEmbed } from "@/components/NoteEmbed"
import { cn } from "@/lib/utils"

export function FileEmbed({ store, path, from = "", height, fill }: { store: Store
  /** The file's vault path. */
  path: string
  /** The file it's shown in (an embedded note doesn't show that file again inside itself). */
  from?: string
  /** Its height (an embed's `|400`), where the kind has one (a PDF, a drawing, an artifact). */
  height?: number
  /** No header, and it fills its parent's box (100% wide and tall): images contained, a PDF or a video as big as the
   *  box, audio centred, a note or a table scrolling inside it. */
  fill?: boolean }) {
  const { disabled } = usePrefs()
  const there = inVault(store, path)
  if (!there) return <p className={cn("text-[13px] text-muted-foreground", fill && "p-3")}>No file {stem(path)} in the vault.</p>
  // A Markdown file a plugin draws (Plan.excalidraw.md) is its drawing, not its text.
  if (formatFor(path, disabled)) return <FormatEmbed store={store} path={path} height={height} fill={fill} />
  if (isMd(path)) return <NoteEmbed store={store} target={path} from={from} seen={from ? [from] : []} fill={fill} />
  if (kindOf(path) === "image") return <ImageEmbed path={path} height={height} fill={fill} />
  if (isMediaEmbed(path)) return <MediaEmbed path={path} height={height} fill={fill} />
  return <OtherEmbed path={path} fill={fill} />
}

/** An image, redrawn when it changes; contained in the box with `fill`. */
function ImageEmbed({ path, height, fill }: { path: string; height?: number; fill?: boolean }) {
  const [, v] = useFileInfo(path)
  const img = <img src={rawUrl(path, { v })} alt={path.split("/").pop()} draggable={false} loading="lazy"
    className={cn("block select-none", fill ? "size-full object-contain" : "max-w-full rounded-[6px]")} style={!fill && height ? { height } : undefined} />
  return fill ? <div className="size-full overflow-hidden" data-image-embed={path}>{img}</div> : img
}

/** Anything else (code, an archive, a document): its card. */
function OtherEmbed({ path, fill }: { path: string; fill?: boolean }) {
  const [info] = useFileInfo(path)
  return <div className={cn(fill && "grid size-full place-items-center overflow-auto")}><FileCard path={path} info={info} /></div>
}
