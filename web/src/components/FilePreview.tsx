import { createElement, memo, useEffect, useMemo, useState, type ReactNode } from "react"
import type { Store } from "@/core/data"
import { readAhead, stem } from "@/core/files"
import { kindIcon, kindOf } from "@/core/filekinds"
import { textRanges } from "@/core/findText"
import { noteParts } from "@/core/frontmatter"
import { fileAt, pageView } from "@/core/pages"
import { fileFormatFor, type FileCtx, type PageCtx } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { BlockView, segments } from "@/components/Blocks"
import { TITLE, TitleRow } from "@/components/FileTitle"
import { rawUrl } from "@/components/FileViewers"
import { Catch } from "@/components/Guard"
import { Markdown } from "@/components/Markdown"
import { EmbedView } from "@/components/NoteEmbed"
import { PREVIEW_WIDTH } from "@/components/PalettePreview"
import { Picture, PreviewCard, Zoomed } from "@/components/PreviewCard"
import { cn } from "@/lib/utils"

export type Near = (line: string) => [number, number][]

const INSET = 10, PICTURE = PREVIEW_WIDTH - 2 * INSET
const HEIGHT = "min(440px, 70dvh)"
const NOTE = 440, PAGE = 760
const BUDGET = 40, KEEP = 40, LIGHT = "vau-preview"

const texts = new Map<string, { mtime: number; text: string }>()
function keep(path: string, mtime: number, text: string) {
  texts.delete(path)
  texts.set(path, { mtime, text })
  if (texts.size > KEEP) texts.delete(texts.keys().next().value ?? "")
}

function useText(path: string, mtime: number) {
  const hit = texts.get(path)
  const fresh = hit?.mtime === mtime ? hit.text : null
  const [last, setLast] = useState<{ path: string; text: string } | null>(null)
  useEffect(() => {
    if (fresh !== null) return
    let on = true
    readAhead(path).then((f) => { keep(path, mtime, f.text); if (on) setLast({ path, text: f.text }) }, () => { if (on) setLast({ path, text: "" }) })
    return () => { on = false }
  }, [path, mtime, fresh])
  return fresh !== null ? { path, text: fresh } : last
}

type Excerpt = { text: string; from: number }
type Part = ReturnType<typeof segments>[number]

function startAt(lines: string[], parts: Part[], near: Near | null) {
  const hit = near ? lines.findIndex((l) => near(l).length > 0) : -1
  if (hit <= 0) return 0
  const at = parts.findLast((s) => s.line <= hit)
  if (!at || !("md" in at)) return at ? at.line : hit
  let from = hit
  while (from > at.line && lines[from - 1].trim()) from--
  return from
}

function excerpt(body: string, near: Near | null, block: number): Excerpt {
  const lines = body.split("\n"), parts = segments(body)
  const from = startAt(lines, parts, near)
  let used = 0, to = lines.length
  for (const [i, s] of parts.entries()) {
    const end = parts[i + 1]?.line ?? lines.length, start = Math.max(s.line, from)
    if (end <= from) continue
    const cost = "md" in s ? end - start : block
    if (used + cost > BUDGET) { to = "md" in s ? start + Math.max(1, BUDGET - used) : used ? s.line : end; break }
    used += cost
  }
  return { text: lines.slice(from, to).join("\n"), from }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
function useLit(el: HTMLElement | null, text: string, near: Near | null) {
  useEffect(() => {
    if (!el || !near || !("highlights" in CSS)) return
    const words = new Set(text.split("\n").flatMap((l) => near(l).map(([a, b]) => l.slice(a, b).toLowerCase())))
    if (!words.size) return
    CSS.highlights.set(LIGHT, new Highlight(...textRanges(el, new RegExp([...words].map(escape).join("|"), "gi"), 50)))
    return () => { CSS.highlights.delete(LIGHT) }
  }, [el, text, near])
}

function Card({ fades = false, children }: { fades?: boolean; children: ReactNode }) {
  return (
    <PreviewCard className="flex flex-col" style={{ width: PREVIEW_WIDTH, height: HEIGHT, padding: INSET, background: "var(--card)" }}>
      <Picture width={PICTURE} height="auto" className={cn("min-h-0 flex-1 bg-background", fades && "[mask-image:linear-gradient(to_bottom,black_80%,transparent)]")}>{children}</Picture>
    </PreviewCard>
  )
}

function NoteCard({ store, path, near }: { store: Store; path: string; near: Near | null }) {
  const { disabled } = usePrefs()
  const f = fileAt(store.files.files, path)
  const file = useText(path, f?.mtime ?? 0)
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const shown = file?.path ?? path
  const { fm, body } = useMemo(() => noteParts(file?.text ?? ""), [file?.text])
  const page = pageView(shown, store, disabled)
  const part = useMemo(() => excerpt(body, file?.path === path ? near : null, page ? 5 : 10), [body, near, file?.path, path, page])
  useLit(box, part.text, near)
  if (!file) return null
  const ctx: PageCtx = { store, path: shown, fm, body, title: stem(shown), place: "page", disabled }
  const wide = !!page && !page.narrow?.({ ...ctx, body: part.text })
  return (
    <Card fades>
      <Zoomed inner={wide ? PAGE : NOTE} width={PICTURE} className="px-6 py-5">
        <div ref={setBox} data-file-preview={shown}>
          <div className="mb-3"><TitleRow icon={fm.icon} tint={fm.tint}><h1 className={TITLE}>{stem(shown)}</h1></TitleRow></div>
          {part.from > 0 && <p className="mb-2 text-muted-foreground">…</p>}
          <Catch fallback={() => null} reset={`${shown}:${part.from}`}>
            {page ? page.render({ ...ctx, body: part.text }) : <Segments store={store} path={shown} text={part.text} ctx={{ store, path: shown, fm, body }} disabled={disabled} />}
          </Catch>
        </div>
      </Zoomed>
    </Card>
  )
}

function Segments({ store, path, text, ctx, disabled }: { store: Store; path: string; text: string; ctx: FileCtx; disabled: string[] }) {
  const parts = useMemo(() => segments(text), [text])
  return parts.map((s) => "md" in s ? <Markdown key={s.line} store={store} text={s.md} from={path} full />
    : "embed" in s ? <EmbedView key={s.line} store={store} target={s.embed} height={s.height} from={path} seen={[path]} />
    : <BlockView key={s.line} name={s.block} text={s.text} ctx={ctx} disabled={disabled} quiet />)
}

function OtherCard({ store, path }: { store: Store; path: string }) {
  if (kindOf(path) === "image") {
    const v = fileAt(store.files.others, path)?.mtime
    return <Card><img src={rawUrl(path, { v })} alt="" decoding="async" draggable={false} className="size-full bg-muted object-contain" /></Card>
  }
  return (
    <Card>
      <div className="flex size-full flex-col items-center justify-center gap-2 bg-muted px-4 text-center">
        {createElement(kindIcon(path), { className: "size-10 text-muted-foreground", strokeWidth: 1.5 })}
        <span className="max-w-full truncate text-[13px] text-muted-foreground">{path.split("/").pop()}</span>
      </div>
    </Card>
  )
}

export const FilePreview = memo(function FilePreview({ store, path, near = null }: { store: Store; path: string; near?: Near | null }) {
  const { disabled } = usePrefs()
  const note = /\.md$/i.test(path) && !fileFormatFor(path, disabled)
  return note ? <NoteCard store={store} path={path} near={near} /> : <OtherCard store={store} path={path} />
})
