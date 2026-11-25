import { memo, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { askEnded, secretKeeper, useAsking, type Ask, type Given } from "@/components/ConfirmDialog"
import { fadeAway } from "@/core/animation"
import { usePageLock } from "@/core/pagelock"
import { cn } from "@/lib/utils"
import { focusableOf } from "@/core/dom"

async function readGiven(f: File): Promise<Given> {
  const bytes = new Uint8Array(await f.arrayBuffer())
  try { return { value: new TextDecoder("utf-8", { fatal: true }).decode(bytes), base64: false } } catch {}
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { value: btoa(bin), base64: true }
}

export const ConfirmDialogs = memo(function ConfirmDialogs() {
  const a = useAsking()
  return a ? createPortal(<Dialog key={a.title + (a.body ?? "")} a={a} />, document.body) : null
})

function Dialog({ a }: { a: Ask }) {
  const ref = useRef<HTMLDialogElement>(null)
  const ok = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [given, setGiven] = useState<Given | null>(null)
  const [file, setFile] = useState("")
  const kept = a.keepable && a.field === "secret" ? secretKeeper() : null
  const [keepIt, setKeepIt] = useState(false)
  const [picking, setPicking] = useState<{ id: string; title: string; username: string }[] | null>(null)
  const [query, setQuery] = useState("")
  const [unpicked, setUnpicked] = useState("")
  const finish = (v: boolean) => {
    if (v && a.field && !given) return
    askEnded(a)
    if (v && given && kept && keepIt) void kept.keep(a.title, given.value).catch(() => {})
    a.done(v, given ?? undefined)
  }
  const pick = async () => {
    const list = await kept?.entries().catch(() => null)
    if (list) setPicking(list)
    else setUnpicked("Your passwords are locked: unlock them in Passwords, or type it")
  }
  const chosen = async (id: string) => {
    const v = await kept?.value(id).catch(() => "")
    if (!v) { setPicking(null); setUnpicked("Not given: Touch ID on this Mac confirms it. Type it instead"); return }
    if (!input.current) return
    input.current.value = v
    setGiven({ value: v, base64: false })
    setKeepIt(false)
    setPicking(null)
  }
  const q = query.trim().toLowerCase()
  const shown = picking?.filter((e) => !q || e.title.toLowerCase().includes(q) || e.username.toLowerCase().includes(q)).slice(0, 6)
  usePageLock()
  // A layout effect's cleanup runs while the dialog is still in the DOM, so it can fade from there.
  useLayoutEffect(() => { const d = ref.current; return () => fadeAway([d], { scale: 0.98, backdrop: "rgb(0 0 0 / 0.3)" }) }, [])
  useEffect(() => {
    const d = ref.current
    if (!d) return
    const back = document.activeElement
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "")
    if (a.field) input.current?.focus(); else ok.current?.focus()
    return () => { if (d.open && typeof d.close === "function") d.close(); focusableOf(back)?.focus({ preventScroll: true }) }
  }, [])
  return (
    <dialog ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={a.body ? "confirm-body" : undefined}
      data-confirm
      onCancel={(e) => { e.preventDefault(); finish(false) }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing && document.activeElement?.getAttribute("data-cancel") === null) { e.preventDefault(); finish(true) }
        if (e.key === "Tab") {
          const all = [...e.currentTarget.querySelectorAll<HTMLElement>("button, input")]
          const i = all.findIndex((b) => b === document.activeElement)
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
        "backdrop:bg-black/30 open:animate-in open:fade-in open:zoom-in-95 open:duration-(--motion-fast)",
      )}>
      <div className="px-5 pt-5 pb-4 text-center md:text-left">
        <h2 id="confirm-title" className="text-[17px] leading-[22px] font-semibold md:text-[15px] md:leading-[20px]">{a.title}</h2>
        {a.body && <p id="confirm-body" className="mt-1.5 text-[15px] whitespace-pre-line leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]">{a.body}</p>}
        {a.field === "secret" && (
          <input ref={input} type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label={a.title}
            onChange={(e) => setGiven(e.target.value ? { value: e.target.value, base64: false } : null)}
            className="mt-3 h-9 w-full rounded-[8px] border-[0.5px] border-border bg-background px-3 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-7 md:text-[13px]" />
        )}
        {kept && !picking && (
          <div className="mt-2 flex items-center justify-between gap-2 text-[15px] md:text-[13px]">
            <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" checked={keepIt} onChange={(e) => setKeepIt(e.target.checked)} data-secret-keep />Keep in your passwords
            </label>
            <button type="button" onClick={() => void pick()} className="cursor-pointer text-primary hover:underline" data-secret-pick>From your passwords…</button>
          </div>
        )}
        {kept && unpicked && !picking && <p className="mt-1.5 text-[15px] text-muted-foreground md:text-[13px]" data-secret-unpicked>{unpicked}</p>}
        {picking && (
          <div className="mt-2 text-left" data-secret-picking>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your passwords" aria-label="Search your passwords"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (shown?.[0]) void chosen(shown[0].id) } }}
              className="h-9 w-full rounded-[8px] border-[0.5px] border-border bg-background px-3 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-7 md:text-[13px]" />
            <div className="mt-1 flex flex-col">
              {shown?.map((e) => (
                <button key={e.id} type="button" onClick={() => void chosen(e.id)} data-secret-entry={e.title}
                  className="flex h-9 cursor-pointer items-baseline gap-2 rounded-[6px] px-2 text-left text-[15px] hover:bg-foreground/[0.06] md:h-7 md:text-[13px]">
                  <span className="truncate">{e.title || "(untitled)"}</span><span className="truncate text-muted-foreground">{e.username}</span>
                </button>
              ))}
              {shown && !shown.length && <p className="px-2 py-1.5 text-[15px] text-muted-foreground md:text-[13px]">None found</p>}
            </div>
          </div>
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
          className="h-11 flex-1 cursor-pointer text-[17px] text-primary focus-visible:outline-none max-md:hover:bg-foreground/[0.05] max-md:focus-visible:bg-foreground/[0.07] md:h-7 md:flex-none md:rounded-[6px] md:bg-foreground/[0.06] md:px-3 md:text-[13px] md:font-medium md:text-foreground md:hover:bg-foreground/[0.1] md:focus-visible:ring-2 md:focus-visible:ring-ring">
          {a.cancel ?? "Cancel"}
        </button>
        <button ref={ok} type="button" data-confirm-ok onClick={() => finish(true)} disabled={!!a.field && !given}
          className={cn("h-11 flex-1 cursor-pointer border-l-[0.5px] border-border text-[17px] font-semibold focus-visible:outline-none max-md:hover:bg-foreground/[0.05] max-md:focus-visible:bg-foreground/[0.07]",
            "md:h-7 md:flex-none md:rounded-[6px] md:border-0 md:px-3 md:text-[13px] md:font-medium md:text-white md:focus-visible:ring-2 md:focus-visible:ring-ring md:focus-visible:ring-offset-1 md:focus-visible:ring-offset-card disabled:cursor-default disabled:opacity-50",
            a.danger ? "text-destructive md:bg-destructive md:hover:bg-destructive/90" : "text-primary md:bg-primary md:hover:bg-primary/90")}>
          {a.confirm ?? "OK"}
        </button>
      </div>
    </dialog>
  )
}
