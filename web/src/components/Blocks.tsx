// Blocks: what every block shows besides its plugin's drawing, the same for all: plugin off, loading, a failure (each
// block its own error boundary), and while editing, option notes against its declaration.
import { Suspense, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Ellipsis, SlidersHorizontal } from "lucide-react"
import { Catch } from "@/components/Guard"
import type { Store } from "@/core/data"
import type { FileCtx } from "@/core/define"
import { readFile } from "@/core/files"
import { embedOf, fenceBlock } from "@/core/formats"
import { blockName, scan } from "../../../core/sections.ts"
import { innerOf, noteParts, setBlockText, setProp } from "@/core/frontmatter"
import { notifyError } from "@/core/notify"
import { resolver } from "@/core/links"
import { blockFor } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { Loading, Switch } from "@/components/kit"
import { BlockSource, openBlockMenu } from "@/components/BlockSource"
import type { BlockEdit } from "@/editor/livePreview"
import { capitalize } from "@/lib/utils"
import { onTop, optionNotes, parseOptions, resolveOptions, type BlockDecl, type OptionDecl } from "../../../core/blocks.ts"

/** A block's text read as options ({} when it's empty or isn't YAML), the way the server reads them (core/blocks.ts). */
export function blockOptions(text: string): Record<string, unknown> {
  return parseOptions(text).options
}

/** A file's kind's blocks (the server's row: core/blocks.ts onTop). */
export const kindBlocksOf = (store: Store, path: string) => store.files.files.find((f) => f.path === path)?.kindBlocks

/** kindBlocksOf, the same array while they're the same. */
export function useKindBlocks(store: Store, path: string): string[] | undefined {
  const key = kindBlocksOf(store, path)?.join(",") ?? ""
  return useMemo(() => (key ? key.split(",") : undefined), [key])
}

/** A body in pieces: its blocks, its embeds and the Markdown between them (blank-only text left out). `line`: where
 *  it starts in the body (0-based), so a drawn page and the editor can find the same place (FileView's keepPlace).
 *  `kind`: its file's kind's blocks, those it doesn't place drawn first. */
export type Segment = ({ block: string; text: string } | { md: string } | { embed: string; height?: number }) & { line: number }
export function segments(body: string, kind?: string[]): Segment[] {
  const out: Segment[] = onTop(kind, body).map((block) => ({ block, text: "", line: 0 }))
  const { lines, prose, fences } = scan(body)
  const opens = new Map(fences.map((f) => [f.open, f]))
  let md: string[] = []
  let mdAt = 0
  const flush = () => {
    if (md.join("\n").trim()) out.push({ md: md.join("\n").trim(), line: mdAt + md.findIndex((l) => l.trim()) })
    md = []
  }
  for (let i = 0; i < lines.length; i++) {
    const f = opens.get(i)
    // (or a fence a plugin draws: ```base)
    const name = f && f.close !== null ? blockName(f.info) ?? fenceBlock(f.info) : null
    if (f && name) {
      flush()
      out.push({ block: name, text: lines.slice(i + 1, f.close!).join("\n"), line: i })
      i = f.close!
      continue
    }
    // A code fence is Markdown as it is, embeds and all.
    if (f) { if (!md.length) mdAt = i; const end = f.close ?? lines.length - 1; md.push(...lines.slice(i, end + 1)); i = end; continue }
    // An artifact or a table shown in the file: `![[Finance/Spending.html]]` (or a .csv, a PDF, audio, video, or a
    // file a plugin draws) on a line of its own, with an optional height (`![[Spending.html|600]]`).
    const e = prose[i] ? embedOf(lines[i]) : null
    if (e) { flush(); out.push({ embed: e.target, height: e.height, line: i }); continue }
    if (!md.length) mdAt = i
    md.push(lines[i])
  }
  flush()
  return out
}

/** ```block-<name> drawn by its plugin with its options (defaults filled in); one whose plugin is off says so (`quiet`:
 *  nothing). `editing` shows option notes; `edit` (in an editor): its bar and options form, which writes its fence. */
export function BlockView(props: { name: string; text: string; ctx: FileCtx; disabled: string[]; quiet?: boolean; editing?: boolean; nth?: number; edit?: BlockEdit }) {
  const { name, text, ctx, edit } = props
  const [form, setForm] = useState(false)
  const decl = blockFor(name, props.disabled).decl
  // In an editor its fence changes there; drawn on a page (a dashboard), in its file, when that can be changed.
  const write = edit?.setText ?? (ctx.setProperty && props.nth !== undefined && !ctx.host
    ? (t: string) => void setBlockText(ctx.path, name, props.nth!, t).catch((e) => notifyError(e, "Couldn't change its options")) : null)
  const options = !!decl?.options && Object.keys(decl.options).length > 0 && !!write
  const menu = (at: { x: number; y: number }) => openBlockMenu(at, { name, text, path: ctx.path, nth: props.nth, edit, options: options ? () => setForm(true) : undefined })
  // Right-click (or a held finger): where its data comes from, and editing it (components/BlockSource.tsx).
  return (
    <BlockSource name={name} menu={menu}>
      <Block {...props} />
      {form && options && <BlockOptions decl={decl!} text={text} set={write!} close={() => setForm(false)} source={edit?.source ?? null} />}
      {edit && createPortal(<BlockBar name={name} options={options} form={form} setForm={setForm} menu={menu} />, edit.bar)}
    </BlockSource>
  )
}

/** What a block adds to its bar in the editor: its name, Options, and its menu (the editor adds </>). */
function BlockBar({ name, options, form, setForm, menu }: { name: string; options: boolean; form: boolean; setForm: (f: boolean) => void; menu: (at: { x: number; y: number }) => void }) {
  const hold = (e: ReactMouseEvent) => e.preventDefault()
  return (
    <>
      <span className="cm-block-name">{capitalize(name.replace(/-/g, " "))}</span>
      {options && (
        <button type="button" className="cm-block-btn" data-tip="Options" aria-label="Options" aria-pressed={form} onMouseDown={hold} onClick={() => setForm(!form)}>
          <SlidersHorizontal className="size-4" strokeWidth={2.25} />
        </button>
      )}
      <button type="button" className="cm-block-btn" data-tip="More" aria-label="More" onMouseDown={hold}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); menu({ x: r.left, y: r.bottom + 4 }) }}>
        <Ellipsis className="size-4" strokeWidth={2.25} />
      </button>
    </>
  )
}

/** A block's options as a form, from its declaration: each change written into its fence as YAML, like typing it. */
function BlockOptions({ decl, text, set, close, source }: { decl: BlockDecl; text: string; set: (text: string) => void; close: () => void; source: (() => void) | null }) {
  const { options: now, error } = parseOptions(text)
  const put = (key: string, value: unknown) => {
    const empty = value === undefined || value === "" || (Array.isArray(value) && !value.length)
    set(innerOf(setProp(`---\n${text}\n---\n`, key, empty ? undefined : value)))
  }
  // (a map, a Bases filter, is written in its source)
  const all = Object.entries(decl.options ?? {})
  const rows = all.filter(([, d]) => !(Array.isArray(d.type) ? d.type : [d.type]).includes("map"))
  return (
    <div className="cm-block-options" data-no-edit>
      {error && <p className="text-[13px] text-muted-foreground">{capitalize(error)}: fix it in its source.</p>}
      {!error && rows.map(([key, d]) => (
        <label key={key} className="flex min-h-9 items-center gap-3 py-1">
          <span className="w-28 shrink-0 text-[13px] font-medium">{capitalize(key.replace(/_/g, " "))}</span>
          <span className="min-w-0 flex-1"><OptionInput d={d} value={now[key]} set={(v) => put(key, v)} /></span>
          <span className="hidden min-w-0 flex-1 truncate text-[13px] text-muted-foreground md:block" data-tip-trunc data-tip={capitalize(d.description)}>{capitalize(d.description)}</span>
        </label>
      ))}
      <div className="mt-1 flex gap-4 text-[13px] font-semibold text-primary">
        <button type="button" className="cursor-pointer" onClick={close}>Done</button>
        {source && rows.length < all.length && <button type="button" className="cursor-pointer" onClick={source}>More in its source</button>}
      </div>
    </div>
  )
}

const listOf = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : []).map((x) => x.trim()).filter(Boolean)

/** One option's value, as its type takes it: a switch, a choice, a number, a comma list, a text. */
function OptionInput({ d, value, set }: { d: OptionDecl; value: unknown; set: (v: unknown) => void }) {
  const ts = Array.isArray(d.type) ? d.type : [d.type]
  const shown = value === undefined || value === null ? "" : Array.isArray(value) ? value.join(", ") : String(value)
  const [v, setV] = useState(shown)
  useEffect(() => setV(shown), [shown])
  const hint = d.default === undefined ? "" : Array.isArray(d.default) ? d.default.join(", ") : String(d.default)
  if (ts.length === 1 && ts[0] === "boolean") return <Switch on={value === undefined ? d.default === true : value === true} onChange={set} label={d.description} />
  if (ts.includes("enum") && d.values?.length) {
    return (
      <select value={shown} onChange={(e) => set(e.target.value === "" ? undefined : ts.includes("number") && !isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value)}
        className="h-8 w-full min-w-0 cursor-pointer rounded-[6px] bg-foreground/[0.04] px-1.5 text-[15px] outline-none">
        <option value="">{hint ? `Default (${hint})` : "Default"}</option>
        {d.values.map((x) => <option key={String(x)} value={String(x)}>{String(x)}</option>)}
      </select>
    )
  }
  const commit = () => {
    if (v === shown) return
    const t = v.trim()
    if (ts.includes("list") && !ts.includes("string")) set(listOf(t))
    else if (ts.includes("number") && t !== "" && !isNaN(Number(t))) set(Number(t))
    else set(t)
  }
  return (
    <input value={v} placeholder={hint} spellCheck={false} aria-label={d.description} inputMode={ts.length === 1 && ts[0] === "number" ? "decimal" : undefined}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() } if (e.key === "Escape") { setV(shown); e.currentTarget.blur() } }}
      className="h-8 w-full min-w-0 rounded-[6px] bg-foreground/[0.04] px-1.5 text-[15px] outline-none placeholder:text-muted-foreground focus:bg-foreground/[0.06]" />
  )
}

function Block({ name, text, ctx, disabled, quiet, editing }: { name: string; text: string; ctx: FileCtx; disabled: string[]; quiet?: boolean; editing?: boolean }) {
  const { plugin, render, decl } = blockFor(name, disabled)
  if (!render) {
    if (quiet) return null
    return (
      <p className="text-[15px] text-muted-foreground">
        {plugin ? `${plugin.name} is off, so this ${name} block isn't drawn.` : `No plugin draws block-${name}.`}
      </p>
    )
  }
  const parsed = parseOptions(text)
  const options = resolveOptions(decl, parsed.options)
  // A plugin's fence (```tasks) is written in its own language, not as options: nothing to note.
  const notes = editing && !name.startsWith("```") ? optionNotes(decl, parsed.options, parsed.error) : []
  // (keyed by a vault plugin's version: a block drawn by an older one starts afresh; one that failed is tried again
  // when its text changes)
  const drawn = typeof options.file === "string" && options.file.trim()
    ? <OtherFile name={name} text={text} options={options} ctx={ctx} render={render} editing={editing} />
    : <Island key={plugin?.version} retry={text} name={name} editing={editing}><Drawn render={render} ctx={{ ...ctx, text, options }} /></Island>
  if (!notes.length) return drawn
  return <>{drawn}<BlockNotes name={name} notes={notes} /></>
}

type Render = NonNullable<ReturnType<typeof blockFor>["render"]>

/** The plugin's render, called inside the block's own boundaries (an error in it, or its code still loading, stays
 *  this block's), with the core's loading line while it suspends. */
function Drawn({ render, ctx }: { render: Render; ctx: Parameters<Render>[0] }) {
  return <Suspense fallback={<Loading />}>{render(ctx)}</Suspense>
}

/** What's wrong with a block's options, under it while editing: one quiet line ("Unknown option isues: did you mean
 *  issues?"), the option names in code. */
function BlockNotes({ name, notes }: { name: string; notes: string[] }) {
  const text = notes.join("; ")
  return (
    <p className="mt-1.5 text-[13px] leading-[18px] text-muted-foreground" data-block-notes={name}>
      {text.split(/(`[^`]*`)/).map((part, i) => (part.startsWith("`") && part.endsWith("`") && part.length > 1
        ? <code key={i} className="rounded-[4px] bg-muted px-1 font-mono text-[12px]">{part.slice(1, -1)}</code>
        : i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))}
    </p>
  )
}

/** `file:` in any block's options draws it for another file: a name or path like a [[link]], or a folder ending in /
 *  for its newest file. Server: otherFile in core/render.ts. */
function fileFor(store: Store, target: string): string | null {
  const t = target.trim().replace(/^\[\[|\]\]$/g, "")
  if (t.endsWith("/")) {
    const dir = t.replace(/^\/+/, "").toLowerCase()
    const inside = store.files.files.filter((f) => f.path.toLowerCase().startsWith(dir) && f.path.endsWith(".md"))
    return inside.sort((a, b) => b.mtime - a.mtime)[0]?.path ?? null
  }
  const exact = store.files.files.find((f) => f.path.toLowerCase() === t.toLowerCase() || f.path.toLowerCase() === `${t.toLowerCase()}.md`)
  return exact?.path ?? resolver(store)(t)?.file ?? null
}

function OtherFile({ name, text, options, ctx, render, editing }: {
  name: string; text: string; options: Record<string, unknown>; ctx: FileCtx; render: Render; editing?: boolean
}) {
  const path = fileFor(ctx.store, String(options.file))
  const mtime = ctx.store.files.files.find((f) => f.path === path)?.mtime
  const [other, setOther] = useState<{ path: string; fm: Record<string, unknown>; body: string } | null>(null)
  useEffect(() => {
    if (!path) return
    let live = true
    readFile(path).then((f) => { if (live) setOther({ path, ...noteParts(f.text) }) }, () => {})
    return () => { live = false }
  }, [path, mtime])
  if (!path) return <p className="text-[15px] text-muted-foreground">No file {String(options.file)} to draw this {name} block for.</p>
  if (other?.path !== path) return <div className="min-h-20" aria-busy />
  return <Island retry={`${path}\0${text}`} name={name} editing={editing}><Drawn render={render} ctx={{ ...ctx, ...other, host: undefined, text, options }} /></Island>
}

/** Another file's blocks, as that file has them (Projects: each project's card is its file's blocks). `fm` is what
 *  they read from its frontmatter; `fallback` are the blocks to draw when the file isn't in the vault (previews). */
export function FileBlocks({ store, path, fm = {}, fallback = [] }: { store: Store; path: string; fm?: Record<string, unknown>; fallback?: string[] }) {
  const { disabled } = usePrefs()
  const f = store.files.files.find((x) => x.path === path)
  // (its kind's blocks it doesn't place first, as its page draws them)
  const top = (f?.kindBlocks ?? []).filter((n) => !f!.blocks.some(([b]) => b === n))
  const blocks = f ? [...top.map((n): [string, string] => [n, ""]), ...f.blocks] : fallback.map((n): [string, string] => [n, ""])
  const ctx: FileCtx = { store, path, fm, body: "" }
  return <>{blocks.map(([name, text], i) => <BlockView key={i} name={name} text={text} ctx={ctx} disabled={disabled} quiet />)}</>
}

/** A block drawn on its own: a failing one shows a note instead of breaking the page, retried when `retry` (its text)
 *  changes; `editing` shows the error's message. */
function Island({ children, name, editing, retry }: { children: ReactNode; name?: string; editing?: boolean; retry?: string }) {
  const what = name ? `This ${name} block` : "This block"
  const failed = (e: unknown) => (
    <p className="text-[15px] text-muted-foreground" data-block-failed={name ?? ""}>
      {editing ? `${what} couldn't be drawn: ${(e instanceof Error ? e.message : String(e)) || "error"}` : `${what} couldn't be drawn. Edit the file to see its text.`}
    </p>
  )
  return <Catch fallback={failed} reset={retry} onError={(e) => console.error(`block${name ? `-${name}` : ""}:`, e)}>{children}</Catch>
}
