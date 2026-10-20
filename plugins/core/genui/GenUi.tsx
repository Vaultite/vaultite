// A ```genui fence: its program run in the sandbox, what it draws shown with the app's components, and its values
// (the key picked, a box ticked) kept in the fence's {@state} line, so the note opens as it was left, on any device.
import { useEffect, useMemo, useRef, useState } from "react"
import { askAbout, copyText, Markdown, notify, onLook, openWebLink, type BlockCtx, errorText } from "@vaultite"
import { dilText, parse, savedData, savedState, stateNames, withState } from "./dil"
import { sandboxDoc, type FromSandbox, type Tree } from "./sandbox"
import { Drawn, type Host } from "./parts"

const SAVE_AFTER = 800

export function GenUiFence(ctx: BlockCtx) {
  const source = useMemo(() => withState(ctx.text, {}), [ctx.text])
  const nodes = useMemo(() => parse(source), [source])
  const names = useMemo(() => stateNames(nodes), [nodes])
  const data = useMemo(() => savedData(source), [source])
  const savedKey = JSON.stringify(savedState(ctx.text))
  const [tree, setTree] = useState<Tree[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  // The program's values as it last said them, and as last written into the fence.
  const current = useRef<Record<string, unknown>>(JSON.parse(savedKey))
  const written = useRef(savedKey)
  const text = useRef(ctx.text)
  text.current = ctx.text
  const setText = useRef(ctx.setText)
  setText.current = ctx.setText
  const timer = useRef(0)
  const run = useRef(() => {})
  run.current = () => frame.current?.contentWindow?.postMessage({ g: 1, type: "run", nodes, names, state: current.current, bindings: data.bindings, env: env() }, "*")

  const save = () => {
    clearTimeout(timer.current)
    timer.current = 0
    const key = JSON.stringify(current.current)
    if (key === written.current || !setText.current) return
    written.current = key
    try { setText.current(withState(text.current, current.current)) } catch { /* gone meanwhile */ }
  }
  useEffect(() => () => { if (timer.current) save() }, [])

  const box = useRef<HTMLDivElement>(null)
  const env = () => ({ dark: document.documentElement.classList.contains("dark"), mobile: matchMedia("(pointer: coarse)").matches && innerWidth < 768, width: box.current?.clientWidth ?? innerWidth })
  // Light or dark changed: drawn again for it (DIL.useTheme), keeping its values.
  useEffect(() => onLook(() => { if (ready.current) run.current() }), [])
  // A new program (the source changed): run it, keeping the values it had.
  useEffect(() => { if (ready.current) run.current() }, [nodes])
  // Values changed from elsewhere (another device, an agent): run with those.
  useEffect(() => {
    if (savedKey === written.current || savedKey === JSON.stringify(current.current)) return
    current.current = JSON.parse(savedKey)
    written.current = savedKey
    if (ready.current) run.current()
  }, [savedKey])

  const host = useMemo<Host>(() => ({
    from: ctx.path, data,
    call: (fn, args) => frame.current?.contentWindow?.postMessage({ g: 1, type: "call", fn, args }, "*"),
    action: (name, args) => {
      const a = typeof args[0] === "string" ? args[0] : ""
      if (name === "copy" || name === "copyText") void copyText(a).then(() => notify("Copied"))
      else if ((name === "openUrl" || name === "openExternal") && /^https?:\/\//i.test(a)) openWebLink(a)
      else if (name === "issueNewTurn" || name === "sendMessage" || name === "sendFollowUpMessage") {
        if (a.trim() && !askAbout(a, ctx.path)) void copyText(a).then(() => notify("Copied the question: no AI chat is on to ask it"))
      } else if (name === "openEntityDetail" && a) openWebLink(`https://www.google.com/search?q=${encodeURIComponent(a)}`)
    },
  }), [ctx.path, data])

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || e.data.g !== 1) return
      const d = e.data as FromSandbox
      if (d.type === "ready") { ready.current = true; run.current() }
      else if (d.type === "tree" && Array.isArray(d.tree)) { setTree(d.tree); setError(null) }
      else if (d.type === "error") setError(errorText(String(d.message), "This live answer couldn't run"))
      else if (d.type === "state" && d.state && typeof d.state === "object") {
        current.current = d.state
        clearTimeout(timer.current)
        timer.current = window.setTimeout(save, SAVE_AFTER)
      } else if (d.type === "action" && typeof d.name === "string") host.action(d.name, Array.isArray(d.args) ? d.args : [])
    }
    addEventListener("message", on)
    return () => removeEventListener("message", on)
  }, [host])

  return (
    <div ref={box} className="genui-block" data-genui>
      <iframe ref={frame} srcDoc={sandboxDoc()} sandbox="allow-scripts" aria-hidden tabIndex={-1} title="" className="hidden" />
      {tree ? <Drawn tree={tree} host={host} /> : error ? <Fallback source={source} from={ctx.path} /> : <div className="min-h-24" />}
      {error && <p className="mt-2 text-[13px] text-muted-foreground">{error}</p>}
    </div>
  )
}

/** What it says without running: its prose and labels. */
function Fallback({ source, from }: { source: string; from: string }) {
  const md = useMemo(() => dilText(source), [source])
  return md ? <Markdown text={md} full from={from} /> : null
}
