// A Jupyter notebook (.ipynb), read-only: Markdown cells like notes, code highlighted, and their outputs (HTML ones in a
// frame that can't run script or load anything). Its source view is the JSON. Lazy chunk (with the editor).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { classHighlighter, highlightCode } from "@lezer/highlight"
import type { LanguageSupport } from "@codemirror/language"
import { Markdown } from "@/components/Markdown"
import { cn } from "@/lib/utils"
import { languageNamed } from "./languages"

type Output = { output_type: string; name?: string; text?: string | string[]; data?: Record<string, string | string[]>; ename?: string; evalue?: string; traceback?: string[] }
type Cell = { cell_type: string; source: string | string[]; execution_count?: number | null; outputs?: Output[] }
type Nb = { cells?: Cell[]; metadata?: { kernelspec?: { language?: string }; language_info?: { name?: string } } }

const join = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join("") : s ?? "")
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g // eslint-disable-line no-control-regex

function Code({ code, lang }: { code: string; lang: LanguageSupport | null }) {
  const html = useMemo(() => {
    if (!lang) return null
    const out: ReactNode[] = []
    let k = 0
    highlightCode(code, lang.language.parser.parse(code), classHighlighter,
      (text, classes) => out.push(classes ? <span key={k++} className={classes}>{text}</span> : text), () => out.push("\n"))
    return out
  }, [code, lang])
  return <pre className="nb-code overflow-x-auto rounded-[8px] bg-foreground/[0.04] px-3 py-2 text-[13px] leading-[20px]"><code>{html ?? code}</code></pre>
}

/** A cell's HTML output, in a frame with no script and no network, as tall as its content. */
function HtmlOutput({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(40)
  const doc = useMemo(() => {
    const css = getComputedStyle(document.documentElement)
    const v = (n: string) => css.getPropertyValue(n).trim()
    return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">` +
      `<style>body{margin:0;font:13px/1.45 ui-sans-serif,system-ui,sans-serif;color:${v("--foreground")};background:transparent}` +
      `table{border-collapse:collapse}th,td{padding:3px 10px;text-align:right;border-bottom:0.5px solid ${v("--border")}}` +
      `th{font-weight:600}tbody tr:nth-child(odd){background:color-mix(in srgb,${v("--foreground")} 4%,transparent)}</style>${html}`
  }, [html])
  return (
    <iframe ref={ref} sandbox="allow-same-origin" srcDoc={doc} title="Output" className="block w-full" style={{ height: h }}
      onLoad={() => { const d = ref.current?.contentDocument; if (d) setH(Math.min(4000, d.documentElement.scrollHeight + 2)) }} />
  )
}

function OutputView({ o }: { o: Output }) {
  const pre = "overflow-x-auto text-[13px] leading-[19px] whitespace-pre-wrap font-mono"
  if (o.output_type === "stream") return <pre className={cn(pre, o.name === "stderr" && "text-(--red)")}>{join(o.text).replace(ANSI, "")}</pre>
  if (o.output_type === "error") return <pre className={cn(pre, "text-(--red)")}>{(o.traceback?.join("\n") ?? `${o.ename}: ${o.evalue}`).replace(ANSI, "")}</pre>
  const d = o.data ?? {}
  for (const t of ["image/png", "image/jpeg", "image/gif"]) {
    if (d[t]) return <img src={`data:${t};base64,${join(d[t]).replace(/\s/g, "")}`} alt="Output" className="max-w-full self-start rounded-[6px]" />
  }
  if (d["image/svg+xml"]) return <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(join(d["image/svg+xml"]))}`} alt="Output" className="max-w-full self-start" />
  if (d["text/html"]) return <HtmlOutput html={join(d["text/html"])} />
  if (d["text/markdown"]) return <Markdown text={join(d["text/markdown"])} />
  if (d["text/plain"]) return <pre className={pre}>{join(d["text/plain"]).replace(ANSI, "")}</pre>
  return null
}

export default function Notebook({ text }: { text: string }) {
  const nb = useMemo((): Nb | null => { try { return JSON.parse(text) } catch { return null } }, [text])
  const name = nb?.metadata?.language_info?.name ?? nb?.metadata?.kernelspec?.language ?? "python"
  const [lang, setLang] = useState<LanguageSupport | null>(null)
  useEffect(() => { let on = true; languageNamed(name).then((l) => on && setLang(l)); return () => { on = false } }, [name])
  if (!nb || !Array.isArray(nb.cells)) return <p className="text-[15px] text-muted-foreground">This notebook couldn't be read. Its source view shows its text.</p>
  if (!nb.cells.length) return <p className="text-[15px] text-muted-foreground">This notebook has no cells.</p>
  return (
    <div className="notebook flex flex-col gap-4 pb-16" data-notebook>
      {nb.cells.map((c, i) => c.cell_type === "markdown" ? (
        <Markdown key={i} text={join(c.source)} />
      ) : c.cell_type === "code" ? (
        <div key={i} className="flex flex-col gap-2" data-cell="code">
          <div className="relative">
            {c.execution_count != null && <span className="absolute -top-4 left-0 text-[11px] text-muted-foreground">[{c.execution_count}]</span>}
            <Code code={join(c.source)} lang={lang} />
          </div>
          {!!c.outputs?.length && <div className="flex flex-col gap-2 px-3">{c.outputs.map((o, j) => <OutputView key={j} o={o} />)}</div>}
        </div>
      ) : (
        <pre key={i} className="text-[13px] whitespace-pre-wrap text-muted-foreground">{join(c.source)}</pre>
      ))}
    </div>
  )
}
