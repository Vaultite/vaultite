// Export to PDF and Print: the note as it reads, on white in light colours, alone in #vau-print while
// printing. The desktop app saves with printToPDF; a browser uses its print dialog.
import { useEffect, useRef, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { FileDown, Printer } from "lucide-react"
import { activeFile, currentFile, definePlugin, dismissNotice, getStore, notify, notifyError, NoteBody, Panel, readFile, savePdf, splitFm, stem, type Store } from "@vaultite"

type Job = { path: string; text: string; how: "pdf" | "print"; ready: () => void }
let job: Job | null = null
const subs = new Set<() => void>()
const setJob = (j: Job | null) => { job = j; subs.forEach((f) => f()) }

const isNote = (p: string) => /\.md$/i.test(p) && !p.startsWith(".")
const here = () => { const f = currentFile() || activeFile()?.path || ""; return isNote(f) ? f : "" }

const CSS = `
#vau-print { position: fixed; left: -20000px; top: 0; width: 720px; pointer-events: none; background: var(--card); color: var(--foreground); }
#vau-print .print-title { font-size: 30px; line-height: 36px; font-weight: 700; margin: 0 0 20px; overflow-wrap: anywhere; }
#vau-print .wikilink, #vau-print a.tag { color: inherit; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
#vau-print .note-embed-head svg { display: none; }
@media print {
  @page { margin: 16mm 16mm 18mm; }
  html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; background: transparent !important; }
  body > :not(#vau-print) { display: none !important; }
  #vau-print { position: static !important; left: auto !important; width: auto !important; background: transparent; }
  #vau-print :is(pre, blockquote, table, img, figure, .callout, .note-embed, .md-code) { break-inside: avoid; }
  #vau-print :is(h1, h2, h3, h4, .h1, .h2, .h3, .h4) { break-after: avoid; }
  #vau-print :is(audio, video, iframe) { display: none; }
}`

/** Images loaded (or failed), fonts in, math and diagrams drawn. Slow images are waited for, never dropped by a timer:
 *  after a moment a toast counts them, and its button goes on without the rest. */
async function settled(root: HTMLElement) {
  const started = Date.now(), id = "export-pdf-images"
  let skip = false, said = "", saidAt = 0
  for (const img of root.querySelectorAll("img")) img.loading = "eager"
  await document.fonts?.ready.catch(() => {})
  try {
    for (;;) {
      const imgs = [...root.querySelectorAll("img")]
      for (const img of imgs) img.loading = "eager" // (note embeds drawn since)
      const left = imgs.filter((i) => !i.complete).length
      if (!left || skip) break
      const text = `Waiting for ${left} of ${imgs.length} ${imgs.length === 1 ? "image" : "images"}…`
      // (said again each second: a toast swiped away comes back, or the export would wait unseen)
      if (Date.now() - started > 1500 && (text !== said || Date.now() - saidAt > 1000)) {
        said = text; saidAt = Date.now()
        notify(text, { id, duration: Infinity, action: { label: "Go on without", run: () => { skip = true } } })
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  } finally { if (said) dismissNotice(id) }
  await new Promise((r) => setTimeout(r, 400)) // (note embeds read their files; mermaid draws late)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

function PrintRoot({ j }: { j: Job }) {
  const ref = useRef<HTMLDivElement>(null)
  const { fm, body } = splitFm(j.text)
  useEffect(() => {
    if (ref.current) void settled(ref.current).then(j.ready)
  }, [j])
  return createPortal(
    <div id="vau-print" ref={ref} className="scheme-preview" aria-hidden data-print={j.path}>
      <style>{CSS}</style>
      <h1 className="print-title">{stem(j.path)}</h1>
      <NoteBody store={getStore() as Store} path={j.path} body={body} fm={fm} whole className="print-body" />
    </div>,
    document.body,
  )
}

function Background() {
  const j = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => job)
  return j ? <PrintRoot key={j.path + j.how} j={j} /> : null
}

/** Print the note (or save it as a PDF in the desktop app). */
export async function printNote(path: string, how: "pdf" | "print") {
  if (!path) { notify("Open a note to print it."); return }
  if (job) return
  let text: string
  try {
    const f = activeFile()
    text = f?.path === path ? f.text() : (await readFile(path)).text
  } catch (e) { notifyError(e, "Couldn't read the note"); return }
  const ready = new Promise<void>((r) => setJob({ path, text, how, ready: r }))
  await ready
  const title = document.title
  document.title = stem(path) // (the PDF's name in a browser's Save as PDF)
  const done = () => { document.title = title; setJob(null) }
  try {
    if (how === "pdf") {
      const saved = await savePdf(stem(path))
      if (saved !== undefined) { done(); return }
      notify("Choose Save as PDF in the print dialog.")
    }
    addEventListener("afterprint", done, { once: true })
    window.print()
    // (a browser whose print() doesn't wait and never says afterprint: put things back after a while)
    setTimeout(() => { if (job?.path === path) done() }, 60_000)
  } catch (e) {
    done()
    notifyError(e, "Couldn't print")
  }
}

export default definePlugin({
  commands: [
    { id: "export-pdf:pdf", name: "Export to PDF", when: () => !!here(), run: () => void printNote(here(), "pdf") },
    { id: "export-pdf:print", name: "Print note", when: () => !!here(), run: () => void printNote(here(), "print"), icon: Printer },
  ],
  // (Print is in the palette only: the menu is long enough, and a browser's Export to PDF is its print dialog anyway)
  fileMenu: (path) => (isNote(path) ? [{ label: "Export to PDF", icon: FileDown, section: "more", run: () => void printNote(path, "pdf") }] : []),
  background: () => <Background />,
  preview: () => (
    <Panel title="Export to PDF" icon={FileDown} tint="var(--blue)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Print a note or save it as a PDF, the way it reads: its title and text with images, embeds and math, on white,
        without the app around it. From the command palette or the note's menu.
      </p>
    </Panel>
  ),
})
