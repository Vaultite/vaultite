// The confirm dialog for destructive actions that can't be undone; never the browser's confirm(). Anything undoable
// doesn't ask: it acts, then offers Undo in a toast. With a field, it asks for a secret (an agent's `vau secret`).
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { usePageLock } from "@/core/pagelock"
import { cn } from "@/lib/utils"
import { signal } from "@/core/signal"
import { answerUi } from "@/core/live"

export type ConfirmOptions = {
  title: string
  body?: string
  /** The confirm button's label (default "OK"). */
  confirm?: string
  /** The cancel button's label (default "Cancel"). */
  cancel?: string
  /** It destroys something: the confirm button is red. */
  danger?: boolean
  /** A secret to give before confirming: hidden text, or a file's contents. Never shown, never kept. */
  field?: "secret" | "file"
}
/** A secret given: text, or a file's contents (base64 when it isn't text). */
export type Given = { value: string; base64: boolean }
type Ask = ConfirmOptions & { done: (ok: boolean, given?: Given) => void }

let asking: Ask | null = null
const subs = signal()
const set = (a: Ask | null) => { asking = a; subs.notify() }

/** Ask; resolves true when confirmed, false when cancelled. A second question while one is open cancels the first. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  asking?.done(false)
  return new Promise((resolve) => set({ ...opts, done: resolve }))
}

/** Ask for a secret (opts.field); null when cancelled or `ended` (the asker stopped waiting). */
export function secretDialog(opts: ConfirmOptions & { field: "secret" | "file" }, ended?: AbortSignal): Promise<Given | null> {
  asking?.done(false)
  return new Promise((resolve) => {
    const a: Ask = { ...opts, done: (ok, given) => resolve(ok && given ? given : null) }
    ended?.addEventListener("abort", () => { if (asking === a) { set(null); a.done(false) } })
    set(a)
  })
}

// An agent's `vau secret` (core/coreops/secret.ts): the value given, or null.
answerUi("secret", (m, ended) => secretDialog({
  title: typeof m.prompt === "string" ? m.prompt : "A secret", confirm: "Send", field: m.file ? "file" : "secret",
  body: `${typeof m.from === "string" && m.from ? m.from : "An agent"} asks for this. It goes to that machine only, never into the vault.`,
}, ended))

/** A file's contents as text, else base64. */
async function readGiven(f: File): Promise<Given> {
  const bytes = new Uint8Array(await f.arrayBuffer())
  try { return { value: new TextDecoder("utf-8", { fatal: true }).decode(bytes), base64: false } } catch { /* binary */ }
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { value: btoa(bin), base64: true }
}

export function ConfirmDialogs() {
  const a = subs.use(() => asking)
  return a ? createPortal(<Dialog key={a.title + (a.body ?? "")} a={a} />, document.body) : null
}

function Dialog({ a }: { a: Ask }) {
  const ref = useRef<HTMLDialogElement>(null)
  const ok = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [given, setGiven] = useState<Given | null>(null)
  const [file, setFile] = useState("")
  const finish = (v: boolean) => {
    if (v && a.field && !given) return
    if (asking === a) set(null)
    a.done(v, given ?? undefined)
  }
  usePageLock()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    const back = document.activeElement as HTMLElement | null
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "")
    if (a.field) input.current?.focus(); else ok.current?.focus()
    return () => { if (d.open && typeof d.close === "function") d.close(); back?.focus?.({ preventScroll: true }) }
  }, [])
  return (
    <dialog ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={a.body ? "confirm-body" : undefined}
      data-confirm
      onCancel={(e) => { e.preventDefault(); finish(false) }}
      onKeyDown={(e) => {
        // Enter confirms (unless Cancel has the focus: then it's that button's own Enter).
        if (e.key === "Enter" && !e.nativeEvent.isComposing && document.activeElement?.getAttribute("data-cancel") === null) { e.preventDefault(); finish(true) }
        // The focus stays on the two buttons.
        if (e.key === "Tab") {
          const all = [...e.currentTarget.querySelectorAll<HTMLElement>("button, input")]
          const i = all.indexOf(document.activeElement as HTMLElement)
          e.preventDefault()
          all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus()
        }
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return
        const r = e.currentTarget.getBoundingClientRect()
        if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) finish(false)
      }}
      className={cn(
        "m-auto w-[calc(100%-3rem)] max-w-[320px] overflow-hidden rounded-[14px] border-[0.5px] border-border bg-card p-0 text-foreground shadow-2xl outline-none md:max-w-[400px]",
        "backdrop:bg-black/30 open:animate-in open:fade-in open:zoom-in-95 open:duration-150",
      )}>
      <div className="px-5 pt-5 pb-4 text-center md:text-left">
        <h2 id="confirm-title" className="text-[17px] leading-[22px] font-semibold md:text-[15px] md:leading-[20px]">{a.title}</h2>
        {a.body && <p id="confirm-body" className="mt-1.5 text-[15px] whitespace-pre-line leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]">{a.body}</p>}
        {a.field === "secret" && (
          <input ref={input} type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label={a.title}
            onChange={(e) => setGiven(e.target.value ? { value: e.target.value, base64: false } : null)}
            className="mt-3 h-9 w-full rounded-[8px] border-[0.5px] border-border bg-background px-3 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-7 md:text-[13px]" />
        )}
        {a.field === "file" && (
          <label className="mt-3 flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-foreground/[0.06] px-3 text-[15px] font-medium hover:bg-foreground/[0.1] md:h-7 md:text-[13px]">
            <input ref={input} type="file" className="sr-only" aria-label={a.title}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                setGiven(null); setFile("")
                if (!f) return
                if (f.size > 1 << 20) { setFile("Over 1 MB: not a key file"); return }
                setGiven(await readGiven(f)); setFile(f.name)
              }} />
            <span className="truncate">{file || "Choose a file…"}</span>
          </label>
        )}
      </div>
      <div className="flex border-t-[0.5px] border-border md:justify-end md:gap-2 md:border-0 md:px-5 md:pb-4">
        <button type="button" data-cancel onClick={() => finish(false)}
          className="h-11 flex-1 cursor-pointer text-[17px] text-primary hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.07] focus-visible:outline-none md:h-7 md:flex-none md:rounded-[6px] md:bg-foreground/[0.06] md:px-3 md:text-[13px] md:font-medium md:text-foreground md:hover:bg-foreground/[0.1] md:focus-visible:ring-2 md:focus-visible:ring-ring">
          {a.cancel ?? "Cancel"}
        </button>
        <button ref={ok} type="button" data-confirm-ok onClick={() => finish(true)} disabled={!!a.field && !given}
          className={cn("h-11 flex-1 cursor-pointer border-l-[0.5px] border-border text-[17px] font-semibold hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.07] focus-visible:outline-none",
            "md:h-7 md:flex-none md:rounded-[6px] md:border-0 md:px-3 md:text-[13px] md:font-medium md:text-white md:focus-visible:ring-2 md:focus-visible:ring-ring md:focus-visible:ring-offset-1 md:focus-visible:ring-offset-card disabled:cursor-default disabled:opacity-50",
            a.danger ? "text-destructive md:bg-destructive md:hover:bg-destructive/90" : "text-primary md:bg-primary md:hover:bg-primary/90")}>
          {a.confirm ?? "OK"}
        </button>
      </div>
    </dialog>
  )
}
