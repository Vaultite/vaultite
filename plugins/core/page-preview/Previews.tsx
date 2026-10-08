// The popovers: a resting pointer on a link previews its note, links inside stack more. While editing, ⌘ must be held
// (`trigger: auto`); computers only, and never inside a sheet (it's drawn above everything).
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from "react-dom"
import { SquareArrowOutUpRight } from "lucide-react"
import { modKey, NotePreview, noteFor, openAt, stem, useLive, type Store } from "@vaultite"

type Settings = { trigger?: "auto" | "hover" | "mod"; delay?: number }
type Pop = { id: number; target: string; from: string; path: string; anchor: Element; rect: DOMRect }

const WIDTH = 460, HEIGHT = 400, GAP = 6, LINGER = 300

/** What an element previews: the link's target and the file it's in (for [[#Heading]] and relative names). */
function targetOf(store: Store, el: Element): { target: string; from: string; path: string } | null {
  const from = el.closest<HTMLElement>("[data-preview-path]")?.dataset.previewPath
    ?? el.closest<HTMLElement>("[data-embed]")?.dataset.embed ?? el.closest<HTMLElement>(".file-view[data-path]")?.dataset.path ?? ""
  const own = (el as HTMLElement).dataset
  const target = own.preview ? own.preview.replace(/\.md$/i, "") : (own.wiki ?? "")
  if (!target) return null
  const path = noteFor(store, target, from)
  return path ? { target, from, path } : null
}

/** How deep in the stack a link is: 0 on the page, n inside the n-th popover. */
const levelOf = (el: Element) => Number(el.closest<HTMLElement>("[data-preview-level]")?.dataset.previewLevel ?? -1) + 1

export function Previews({ store }: { store: Store }) {
  const [desktop] = useState(() => matchMedia("(hover: hover) and (pointer: fine)").matches)
  const { data } = useLive<Settings>(desktop ? "page-preview/settings" : null)
  const [pops, setPops] = useState<Pop[]>([])
  const live = useRef({ store, settings: data, pops })
  live.current = { store, settings: data, pops }

  useEffect(() => {
    if (!desktop) return
    let n = 0
    let armed: { el: Element; level: number; t: { target: string; from: string; path: string }; mod: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null
    let closing: ReturnType<typeof setTimeout> | null = null
    let x = -1, y = -1
    const show = (a: NonNullable<typeof armed>) => {
      if (!a.el.isConnected) return
      const rect = a.el.getBoundingClientRect()
      setPops((ps) => [...ps.slice(0, a.level), { id: ++n, ...a.t, anchor: a.el, rect }])
    }
    const disarm = () => { if (armed?.timer) clearTimeout(armed.timer); armed = null }
    const closeAll = () => { disarm(); setPops((ps) => (ps.length ? [] : ps)) }
    /** A moment after the pointer moves, keep the popovers it's in (or whose link it's on) and those under them. */
    const check = () => {
      if (closing) clearTimeout(closing)
      if (!live.current.pops.length) return
      closing = setTimeout(() => {
        closing = null
        const under = x < 0 ? null : document.elementFromPoint(x, y)
        const ps = live.current.pops
        let keep = under ? levelOf(under) : 0
        ps.forEach((p, i) => { if (under && p.anchor.contains(under)) keep = Math.max(keep, i + 1) })
        if (armed?.timer && armed.level <= keep) keep = Math.max(keep, armed.level)
        if (keep < ps.length) setPops(ps.slice(0, keep))
      }, LINGER)
    }
    const over = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY
      check()
      const el = (e.target as Element).closest?.("[data-wiki], [data-preview]")
      if (!el || el === armed?.el) return
      disarm()
      if (el.closest("dialog") || el.closest("[data-no-preview]")) return
      const t = targetOf(live.current.store, el)
      if (!t) return
      const trigger = live.current.settings?.trigger ?? "auto"
      const editing = !!el.closest(".cm-content[contenteditable=true]")
      const mod = trigger === "mod" || (trigger === "auto" && editing)
      const a: NonNullable<typeof armed> = { el, level: levelOf(el), t, mod, timer: null }
      armed = a
      if (mod && !(e.metaKey || e.ctrlKey)) return
      const delay = Math.max(0, Number(live.current.settings?.delay ?? 500)) || 0
      a.timer = setTimeout(() => { a.timer = null; if (armed === a) show(a) }, mod ? Math.min(delay, 150) : delay)
    }
    const out = (e: PointerEvent) => {
      if (armed && !(e.relatedTarget instanceof Node && armed.el.contains(e.relatedTarget))) disarm()
    }
    const move = (e: PointerEvent) => { x = e.clientX; y = e.clientY }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && live.current.pops.length) { closeAll(); return }
      // ⌘ pressed while pointing at a link that needs it: at once.
      if ((e.key === "Meta" || e.key === "Control") && armed && !armed.timer && armed.mod) show(armed)
    }
    const down = (e: Event) => { if (!(e.target as Element).closest?.("[data-preview-level]")) closeAll() }
    const click = (e: Event) => {
      // A link followed from inside a popover: it opened somewhere else.
      if ((e.target as Element).closest?.("[data-preview-level] :is([data-wiki], a[href], [data-tag])")) setTimeout(closeAll, 0)
    }
    document.addEventListener("pointerover", over, true)
    document.addEventListener("pointerout", out, true)
    document.addEventListener("pointermove", move, { capture: true, passive: true })
    document.addEventListener("keydown", key, true)
    document.addEventListener("pointerdown", down, true)
    document.addEventListener("click", click, true)
    addEventListener("hashchange", closeAll)
    addEventListener("blur", closeAll)
    return () => {
      disarm()
      if (closing) clearTimeout(closing)
      document.removeEventListener("pointerover", over, true)
      document.removeEventListener("pointerout", out, true)
      document.removeEventListener("pointermove", move, true)
      document.removeEventListener("keydown", key, true)
      document.removeEventListener("pointerdown", down, true)
      document.removeEventListener("click", click, true)
      removeEventListener("hashchange", closeAll)
      removeEventListener("blur", closeAll)
    }
  }, [desktop])

  if (!pops.length) return null
  return createPortal(<>{pops.map((p, i) => <Popover key={p.id} pop={p} level={i} store={store} onClose={() => setPops([])} />)}</>, document.body)
}

function Popover({ pop, level, store, onClose }: { pop: Pop; level: number; store: Store; onClose: () => void }) {
  const w = Math.min(WIDTH, innerWidth - 16)
  const below = innerHeight - pop.rect.bottom >= Math.min(HEIGHT, 240) || pop.rect.top < innerHeight - pop.rect.bottom
  const left = Math.min(Math.max(8, pop.rect.left), innerWidth - w - 8)
  const room = below ? innerHeight - pop.rect.bottom - GAP - 8 : pop.rect.top - GAP - 8
  const style = below ? { top: pop.rect.bottom + GAP } : { bottom: innerHeight - pop.rect.top + GAP }
  const anchor = pop.target.includes("#") ? pop.target.slice(pop.target.indexOf("#") + 1).trim() : ""
  const open = (e: ReactMouseEvent) => { e.preventDefault(); onClose(); openAt(pop.path, anchor, { newTab: e.metaKey || e.ctrlKey }) }
  return (
    <div role="dialog" aria-label={`Preview of ${stem(pop.path)}`} data-preview-level={level} data-preview-path={pop.path}
      className="glass-strong fixed z-[58] flex flex-col overflow-hidden rounded-[10px] shadow-xl ring-[0.5px] ring-border animate-in fade-in duration-100"
      style={{ ...style, left, width: w, maxHeight: Math.max(160, Math.min(HEIGHT, room)) }}>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b-[0.5px] border-border pr-1 pl-3 text-[12px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-medium">{stem(pop.path)}{anchor ? ` › ${anchor}` : ""}</span>
        <button type="button" onClick={open} aria-label={`Open ${stem(pop.path)}`} data-tip={`Open (${modKey}-click: in a new tab)`}
          className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] hover:bg-foreground/[0.06] hover:text-foreground">
          <SquareArrowOutUpRight className="size-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-3 text-[14px]" data-preview-body>
        <NotePreview store={store} target={pop.target} from={pop.from} />
      </div>
    </div>
  )
}
