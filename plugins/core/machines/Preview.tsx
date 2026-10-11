import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Wrench } from "lucide-react"
import { get, machinePath, fmtAgo, dateText, Markdown, Loading, Empty, Bar } from "@vaultite"

type Contents = { path: string; text?: string; base64?: string; truncated: boolean; size: number; mtime?: number | null }
type Obj = Record<string, unknown>

const IMAGES: Record<string, string> = { png: "png", jpg: "jpeg", jpeg: "jpeg", gif: "gif", webp: "webp", svg: "svg+xml", avif: "avif" }
const BIG = 8388608
const pre = "whitespace-pre-wrap break-words font-mono text-[13px] [overflow-wrap:anywhere]"
const small = "inline-flex min-h-11 items-center rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground md:min-h-7"

export const extOf = (p: string) => { const n = p.slice(p.lastIndexOf("/") + 1), i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : "" }
export const isImage = (p: string) => extOf(p) in IMAGES
export function fmtSize(n: number) {
  if (n < 1024) return `${n} B`
  const u = ["KB", "MB", "GB", "TB"]
  let v = n / 1024, i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}
export const ago = (ms: number) => fmtAgo(new Date(ms).toISOString())
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v)

/** A file of an agent machine, drawn by its kind; Raw shows the text as it is. */
export function FilePreview({ id, path, tick }: { id: string; path: string; tick: number }) {
  const [file, setFile] = useState<Contents | null>(null)
  const [error, setError] = useState("")
  const [raw, setRaw] = useState(false)
  useEffect(() => {
    let on = true
    setFile(null); setError("")
    const read = (max?: number) => get<Contents>(machinePath(id, `fs/read?path=${encodeURIComponent(path)}${max ? `&max=${max}` : ""}`))
    // An image cut at the 1 MB preview is unreadable: ask once more for up to 8 MB.
    read().then((d) => d.truncated && isImage(path) && d.base64 !== undefined ? read(BIG) : d)
      .then((d) => { if (on) setFile(d) }, (e) => { if (on) setError(e.message) })
    return () => { on = false }
  }, [id, path, tick])
  const name = path.slice(path.lastIndexOf("/") + 1)
  const ext = extOf(path)
  const rich = file?.text !== undefined && ["md", "markdown", "json", "jsonl", "ndjson", "svg"].includes(ext)
  return <div className="min-w-0 space-y-3" data-file-preview={path}>
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium break-all">{name}</p>
        {file ? <p className="text-[13px] text-muted-foreground">{fmtSize(file.size)}{file.mtime ? ` · ${ago(file.mtime)}` : ""}</p>
          : !error && <p className="loading-in text-[13px]" aria-busy><Bar w="7em" /></p>}
        <p className="font-mono text-[12px] break-all text-muted-foreground">{path}</p>
      </div>
      {rich && <button type="button" className={`${small} border border-border`} aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? "Formatted" : "Raw"}</button>}
    </div>
    {file?.truncated && <p className="text-[13px] text-muted-foreground">Preview limited to the first {isImage(path) && file.base64 !== undefined ? "8" : "1"} MB.</p>}
    {error ? <p role="alert" className="text-[14px] text-destructive">{error}</p>
      : !file ? <Loading />
      : raw || !rich ? <Body file={file} ext={ext} />
      : <Rich text={file.text!} ext={ext} file={file} />}
  </div>
}

function Body({ file, ext }: { file: Contents; ext: string }) {
  if (file.text !== undefined) return <pre className={`${pre} rounded-lg border border-border bg-card p-3`} data-file-content>{file.text}</pre>
  if (IMAGES[ext] && !file.truncated) return <Picture src={`data:image/${IMAGES[ext]};base64,${file.base64}`} size={file.size} />
  return <Empty>{IMAGES[ext] ? "Image too large to preview" : "Binary file"} · {fmtSize(file.size)}. {IMAGES[ext] ? "" : "Text preview is unavailable."}</Empty>
}

function Rich({ text, ext, file }: { text: string; ext: string; file: Contents }) {
  if (ext === "svg") return <Picture src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`} size={file.size} />
  if (ext === "json") { const v = parseJson(text); return v === undefined ? <Body file={file} ext="" /> : <div className="rounded-lg border border-border bg-card p-3"><JsonNode value={v} depth={0} /></div> }
  if (ext === "jsonl" || ext === "ndjson") return <Lines text={text} />
  return <MarkdownFile text={text} />
}

function Picture({ src, size }: { src: string; size: number }) {
  const [dims, setDims] = useState("")
  return <figure className="space-y-2">
    <img src={src} alt="" className="max-w-full rounded-lg border border-border" onLoad={(e) => setDims(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)} />
    <figcaption className="text-[13px] text-muted-foreground">{dims ? `${dims} · ` : ""}{fmtSize(size)}</figcaption>
  </figure>
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

/** Text cut at `max` characters, with the rest a click away. */
function Clip({ text, max = 400, className }: { text: string; max?: number; className?: string }) {
  const [all, setAll] = useState(false)
  if (all || text.length <= max) return <span className={className}>{text}</span>
  return <span className={className}>{text.slice(0, max)}… <button type="button" className="text-primary hover:underline" onClick={() => setAll(true)}>Show all ({fmtSize(text.length)})</button></span>
}

// --- Markdown with its frontmatter as a list

function MarkdownFile({ text }: { text: string }) {
  const { meta, body } = useMemo(() => splitFrontmatter(text), [text])
  return <div className="min-w-0 space-y-3">
    {meta.length > 0 && <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-border bg-card p-3 text-[13px]">
      {meta.map(([k, v], i) => <div key={i} className="contents"><dt className="break-words text-muted-foreground">{k}</dt><dd className={`${pre} font-sans`}>{v}</dd></div>)}
    </dl>}
    <Markdown text={body} />
  </div>
}

function splitFrontmatter(text: string): { meta: [string, string][]; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text)
  if (!m) return { meta: [], body: text }
  const meta: [string, string][] = []
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([^\s#][^:]*):(.*)$/.exec(line)
    if (kv) meta.push([kv[1].trim(), kv[2].trim()])
    else if (line.trim() && meta.length) meta[meta.length - 1][1] += (meta[meta.length - 1][1] ? "\n" : "") + line
  }
  return { meta, body: text.slice(m[0].length) }
}

// --- JSON as a tree

function JsonNode({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const [more, setMore] = useState(false)
  const key = name !== undefined && <span className="text-muted-foreground">{name}: </span>
  if (value === null || typeof value !== "object") {
    const s = typeof value === "string" ? JSON.stringify(value) : String(value)
    return <div className={pre}>{key}<Clip text={s} className={typeof value === "string" ? "" : "text-primary"} /></div>
  }
  const entries: [string, unknown][] = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value)
  const shown = more ? entries : entries.slice(0, 300)
  const sum = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`
  if (!entries.length) return <div className={pre}>{key}<span className="text-muted-foreground">{Array.isArray(value) ? "[]" : "{}"}</span></div>
  return <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="font-mono text-[13px]">
    <summary className="cursor-pointer break-all">{key}<span className="text-muted-foreground">{sum}</span></summary>
    {open && <div className="ml-1.5 border-l border-border pl-3">
      {shown.map(([k, v]) => <JsonNode key={k} name={k} value={v} depth={depth + 1} />)}
      {shown.length < entries.length && <button type="button" className={small} onClick={() => setMore(true)}>Show {entries.length - shown.length} more</button>}
    </div>}
  </details>
}

// --- JSON lines: a conversation when they read as one, else a tree per line

const CAP = 400
type Ev = { kind: string; role?: string; text?: string; name?: string; args?: string; output?: string; callId?: string; at?: unknown; raw: unknown }

const textOf = (v: unknown): string | undefined =>
  typeof v === "string" ? v
    : Array.isArray(v) ? v.map((p) => typeof p === "string" ? p : isObj(p) ? textOf(p.text ?? p.content) ?? "" : "").filter(Boolean).join("\n\n") || undefined
    : isObj(v) ? textOf(v.text ?? v.content) : undefined
const str = (v: unknown) => v === undefined ? undefined : typeof v === "string" ? v : JSON.stringify(v, null, 2)

function toEvent(o: unknown): Ev | null {
  if (!isObj(o)) return null
  const it = o.type === "item" && isObj(o.item) ? o.item : isObj(o.message) ? { ...o.message, type: o.message.type ?? "message" } : o
  const at = o.created_at ?? o.timestamp ?? it.created_at
  const type = typeof it.type === "string" ? it.type : it.role ? "message" : ""
  const callId = typeof it.call_id === "string" ? it.call_id : undefined
  if (type === "message" && typeof it.role === "string") return { kind: "message", role: it.role, text: textOf(it.text ?? it.content) ?? "", at, raw: o }
  if (type === "thinking" || type === "reasoning") return { kind: "thinking", text: textOf(it.thinking ?? it.text ?? it.summary) ?? "", at, raw: o }
  if (type === "function_call") return { kind: "call", name: String(it.name ?? "tool"), args: str(it.arguments), callId, at, raw: o }
  if (type === "function_call_output") return { kind: "output", output: str(it.output), callId, at, raw: o }
  if (type === "commentary_text" || type === "commentary") return { kind: "note", text: textOf(it.text) ?? "", at, raw: o }
  return null
}

function Lines({ text }: { text: string }) {
  const { rows, total, chat } = useMemo(() => {
    const all = text.split(/\r?\n/).filter((l) => l.trim())
    const rows = all.slice(0, CAP).map((l) => { const v = parseJson(l); return v === undefined ? l : v })
    const evs = rows.map(toEvent)
    const body = rows.filter((r) => !(isObj(r) && r.type === "session_header"))
    const known = evs.filter(Boolean).length
    return { rows, total: all.length, chat: known >= 1 && known * 2 >= body.length ? evs : null }
  }, [text])
  return <div className="min-w-0 space-y-2">
    {chat ? <Conversation rows={rows} evs={chat} /> : rows.map((r, i) => <div key={i} className="rounded-lg border border-border bg-card p-2">
      {typeof r === "string" ? <div className={pre}><Clip text={r} /></div> : <JsonNode name={String(i + 1)} value={r} depth={1} />}
    </div>)}
    {total > CAP && <p className="text-[13px] text-muted-foreground">Showing the first {CAP} of {total} lines. Raw shows them all.</p>}
  </div>
}

function when(at: unknown) {
  const n = typeof at === "number" ? (at < 1e12 ? at * 1000 : at) : typeof at === "string" ? Date.parse(at) : NaN
  return Number.isFinite(n) ? dateText(n, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""
}

function Conversation({ rows, evs }: { rows: unknown[]; evs: (Ev | null)[] }) {
  const outputs = useMemo(() => { const m = new Map<string, Ev>(); for (const e of evs) if (e?.kind === "output" && e.callId) m.set(e.callId, e); return m }, [evs])
  const called = useMemo(() => new Set(evs.filter((e) => e?.kind === "call" && e.callId).map((e) => e!.callId)), [evs])
  return <>{evs.map((e, i) => {
    const time = e ? when(e.at) : ""
    if (!e) return isObj(rows[i]) && rows[i].type === "session_header"
      ? <p key={i} className="text-[12px] text-muted-foreground">Session started{when((rows[i] as Obj).created_at ?? (rows[i] as Obj).timestamp) ? ` · ${when((rows[i] as Obj).created_at ?? (rows[i] as Obj).timestamp)}` : ""}</p>
      : <details key={i} className="text-[13px] text-muted-foreground"><summary className="cursor-pointer">Line {i + 1}</summary><JsonNode value={rows[i]} depth={1} /></details>
    if (e.kind === "message") {
      const user = e.role === "user"
      if (!user && e.role !== "assistant") return <Fold key={i} label={`${(e.role ?? "").charAt(0).toUpperCase()}${(e.role ?? "").slice(1) || "Other"} message`} time={time}><Markdown text={e.text ?? ""} /></Fold>
      return <div key={i} className={`flex ${user ? "justify-end" : ""}`}>
        <div className={`min-w-0 max-w-[92%] rounded-xl border border-border px-3 py-2 ${user ? "bg-accent" : "bg-card"}`}>
          <Markdown text={e.text ?? ""} />
          {time && <p className="mt-1 text-[12px] text-muted-foreground">{time}</p>}
        </div>
      </div>
    }
    if (e.kind === "thinking") return <Fold key={i} label="Thinking" time={time}><div className={`${pre} font-sans text-muted-foreground`}>{e.text}</div></Fold>
    if (e.kind === "note") return <p key={i} className="text-[13px] text-muted-foreground italic break-words">{e.text}{time ? ` · ${time}` : ""}</p>
    if (e.kind === "output" && e.callId && called.has(e.callId)) return null
    const out = e.kind === "call" ? (e.callId ? outputs.get(e.callId)?.output : undefined) : e.output
    const short = e.args ? e.args.replace(/\s+/g, " ").slice(0, 80) : ""
    return <Fold key={i} time={time} label={<span className="inline-flex min-w-0 items-center gap-1.5"><Wrench size={14} className="shrink-0" /><span className="font-medium text-foreground">{e.kind === "call" ? e.name : "Tool output"}</span>{short && <span className="truncate font-mono text-[12px]">{short}</span>}</span>}>
      {e.args && <div className={`${pre} rounded-lg bg-muted p-2`}><Clip text={prettyArgs(e.args)} max={2000} /></div>}
      {out !== undefined && <div className={`${pre} mt-2 rounded-lg bg-muted p-2`}><Clip text={out} max={2000} /></div>}
    </Fold>
  })}</>
}

const prettyArgs = (s: string) => { const v = parseJson(s); return v === undefined ? s : JSON.stringify(v, null, 2) }

function Fold({ label, time, children }: { label: ReactNode; time?: string | false; children: ReactNode }) {
  return <details className="min-w-0 rounded-lg border border-border px-3 text-[13px] text-muted-foreground">
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 md:min-h-8"><span className="min-w-0 flex-1 truncate">{label}</span>{time && <span className="shrink-0 text-[12px]">{time}</span>}</summary>
    <div className="pb-3">{children}</div>
  </details>
}
