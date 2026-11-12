import { useEffect, useRef, useState, type MouseEvent } from "react"
import { SquareArrowOutUpRight } from "lucide-react"
import { anchorKey, extract, splitAnchor } from "../../../core/sections.ts"
import type { Store } from "@/core/data"
import type { FileCtx } from "@/core/define"
import { fileOf, findEmbed, isMediaEmbed, readFile, stem } from "@/core/files"
import { noteParts } from "@/core/frontmatter"
import { openAt } from "@/core/anchors"
import { resolver } from "@/core/links"
import { fileFormatFor, usePluginsVersion } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { BlockView, segments } from "@/components/Blocks"
import { EmbedMenu } from "@/components/EmbedMenu"
import { MediaEmbed } from "@/components/FileViewers"
import { FormatEmbed } from "@/components/FormatView"
import { embedParts } from "@/core/formats"
import { Markdown } from "@/components/Markdown"
import { Loading } from "@/components/kit"
import type { EmbedEdit } from "@/editor/livePreview"
import { cn, scrollingBox } from "@/lib/utils"

const DEPTH = 20

/** The note an embed names, or null (not a note, or no such file). `from`: the file it's in (`![[#Heading]]`). */
export function noteFor(store: Store, target: string, from: string): string | null {
  const [name] = splitAnchor(target)
  if (!name) return from && /\.md$/i.test(from) ? from : null
  const hit = resolver(store)(name, from || undefined)?.file
  return hit && /\.md$/i.test(hit) ? hit : null
}

/** Whatever `![[target]]` names, drawn: a file's view, or a note's text; with its menu (`edit`: in the editor, what
 *  changes it in the note). */
export function EmbedView({ store, target, height, from, seen = [], edit }: { store: Store; target: string; height?: number; from: string; seen?: string[]; edit?: () => EmbedEdit | null }) {
  usePrefs()
  const path = findEmbed(store, target, from)
  return (
    <EmbedMenu store={store} target={target} from={from} edit={edit}>
      {!path ? <NoteEmbed store={store} target={target} from={from} seen={seen} />
        : isMediaEmbed(path) ? <MediaEmbed path={path} height={height} />
        : <FormatEmbed store={store} path={path} height={height} sub={embedParts(target).sub} from={from} />}
    </EmbedMenu>
  )
}

function useNoteText(path: string | null, mtime?: number) {
  const [file, setFile] = useState<{ path: string; text: string } | null>(null)
  useEffect(() => {
    if (!path) return
    let live = true
    readFile(path).then((r) => { if (live) setFile({ path, text: r.text }) }, () => { if (live) setFile({ path, text: "" }) })
    return () => { live = false }
  }, [path, mtime])
  return file
}

export function NoteEmbed({ store, target, from, seen = [], fill }: { store: Store; target: string; from: string; seen?: string[]; fill?: boolean }) {
  const { disabled } = usePrefs()
  usePluginsVersion()
  const [, anchor] = splitAnchor(target)
  const path = noteFor(store, target, from)
  const mtime = path ? fileOf(store, path)?.mtime : undefined
  const file = useNoteText(path, mtime)
  if (!path) return <p className="note-embed-missing">No file {splitAnchor(target)[0] || target} in the vault.</p>
  const box = fill ? "note-embed is-fill size-full overflow-auto" : "note-embed"
  const name = `${stem(path)}${anchor ? ` › ${anchor.replace(/^\^/, "^")}` : ""}`
  const key = anchor ? `${path}#${anchor}` : path
  const loop = seen.includes(key) || (!anchor && seen.some((k) => k === path || k.startsWith(`${path}#`)))
  const open = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); openAt(path, anchor, { newTab: e.metaKey || e.ctrlKey }) }
  const head = (
    <button type="button" className="note-embed-head" onClick={open} data-hold-menu data-tip={anchor ? `Open ${stem(path)} at ${anchor}` : `Open ${stem(path)}`}>
      <span className="truncate">{name}</span>
      <SquareArrowOutUpRight className="size-3.5 shrink-0" strokeWidth={2} />
    </button>
  )
  if (loop || seen.length > DEPTH) {
    return <div className={box} data-embed={path}>{!fill && head}<p className="note-embed-missing">{loop ? "It embeds itself, so it isn't shown again here." : "Embedded too deep to show here."}</p></div>
  }
  if (!file || file.path !== path) return <div className={cn(box, "min-h-16")} data-embed={path}>{!fill && head}<Loading /></div>
  const own = !anchor && !fill ? fileFormatFor(path, disabled) : null
  if (own) {
    const draw = own.embed ?? own.render
    return <div className={box} data-embed={path}>{head}<div className="note-embed-body">{draw({ store, path, text: file.text, editable: false, place: "embed", onChange: () => {}, ...(from && from !== path ? { host: from } : {}) })}</div></div>
  }
  const { fm, body } = noteParts(file.text)
  const part = extract(body, anchor)
  const ctx: FileCtx = { store, path, fm, body, ...(from && from !== path ? { host: from } : {}) }
  const inner = [...seen, key]
  return (
    <div className={box} data-embed={path}>
      {!fill && head}
      {part === null ? (
        <p className="note-embed-missing">No {anchor.startsWith("^") ? "block" : "heading"} {anchor} in {stem(path)}.</p>
      ) : (
        <div className="note-embed-body">
          {segments(part).map((s, i) => "md" in s ? <Markdown key={i} store={store} text={s.md} from={path} seen={inner} tasks />
            : "embed" in s ? <EmbedView key={i} store={store} target={s.embed} height={s.height} from={path} seen={inner} />
            : <BlockView key={i} name={s.block} text={s.text} ctx={ctx} disabled={disabled} quiet />)}
        </div>
      )}
    </div>
  )
}

/** A note drawn whole for a glance (Page preview's popover), scrolled to the heading `target` names; a block target
 *  shows only that block. Nothing while it loads. */
export function NotePreview({ store, target, from }: { store: Store; target: string; from: string }) {
  const { disabled } = usePrefs()
  const [, anchor] = splitAnchor(target)
  const path = noteFor(store, target, from)
  const file = useNoteText(path)
  const ref = useRef<HTMLDivElement>(null)
  const ready = !!file && file.path === path
  useEffect(() => {
    if (!ready || !anchor || anchor.startsWith("^") || !ref.current) return
    const want = anchorKey(anchor.split("#").pop() ?? "")
    const h = [...ref.current.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")].find((x) => anchorKey(x.textContent ?? "") === want)
    if (!h) return
    // Not scrollIntoView: that scrolls every ancestor, the page under the popover too.
    const p = scrollingBox(h)
    if (p) p.scrollTop += h.getBoundingClientRect().top - p.getBoundingClientRect().top - 8
  }, [ready, anchor])
  if (!path || !ready) return null
  const { fm, body } = noteParts(file.text)
  const part = anchor.startsWith("^") ? extract(body, anchor) : body
  const ctx: FileCtx = { store, path, fm, body }
  if (part === null) return <p className="note-embed-missing">No block {anchor} in {stem(path)}.</p>
  const parts = segments(part)
  if (!parts.length) return <p className="note-embed-missing">This note is empty.</p>
  return (
    <div ref={ref} data-note-preview={path}>
      {parts.map((s, i) => "md" in s ? <Markdown key={i} store={store} text={s.md} from={path} />
        : "embed" in s ? <EmbedView key={i} store={store} target={s.embed} height={s.height} from={path} seen={[path]} />
        : <BlockView key={i} name={s.block} text={s.text} ctx={ctx} disabled={disabled} quiet />)}
    </div>
  )
}
