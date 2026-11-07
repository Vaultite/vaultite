// A cursor's conversation, clicked open: its last words and what the user asked it, above a box to ask it more. One look
// in the window (Overlay.tsx's Popover) and over the screen (web/src/screen.tsx's panel); each gives its own words' drawing.
import { useLayoutEffect, useRef, type ReactNode } from "react"
import { Ellipsis, X } from "lucide-react"

export type ChatItem = { id: string; kind: string; text?: string; t: number; question?: boolean }

const ICON = "grid size-6 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground [@media(pointer:coarse)]:size-9"

export function Chat({ name, tint, items, draft, setDraft, send, close, more, words, time, actions, tools, busy, focus, placeholder, phone, windowed, className, style }: {
  name: string; tint: string
  items: ChatItem[]
  draft: string; setDraft: (s: string) => void; send: () => void; close: () => void
  more: (e: React.MouseEvent) => void
  /** A say's words, drawn (Markdown). */
  words: (n: ChatItem) => ReactNode
  time: (t: number) => string
  /** A say's buttons (the window's Put in note, Pin). */
  actions?: (n: ChatItem) => ReactNode
  /** Beside the box (the screen's microphone). */
  tools?: ReactNode
  /** At work on what it was asked: its answer is on its way. */
  busy?: boolean
  focus: boolean
  /** What its empty box says (default: Ask <name>). */
  placeholder?: string
  /** A phone's card: a Close button, and its head dragged down closes it (Phone.tsx). */
  phone?: boolean
  /** A window of its own over the screen (screen.tsx's): a Close button, and its head drags it. */
  windowed?: boolean
  className?: string; style?: React.CSSProperties
}) {
  const list = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [items.length, busy])
  return (
    <div data-companion-popover={name} data-floats className={`companion-pop flex w-[300px] max-w-[calc(100vw-8px)] flex-col overflow-hidden rounded-[12px] border border-border/60 bg-background text-[13px] leading-snug text-foreground shadow-lg ${className ?? ""}`}
      style={{ boxShadow: `0 0 0 1.5px color-mix(in srgb, ${tint} 45%, transparent), 0 8px 24px rgba(0,0,0,.14)`, ...style }}>
      <div data-swipe={phone || undefined} data-companion-head={windowed || undefined} className={`flex items-center gap-1 pt-1 pr-1 pl-3 ${phone ? "touch-none" : ""} ${windowed ? "[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]" : ""}`}>
        {/* (its name alone: what it runs, its More menu in the app says) */}
        <div data-companion-name className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-muted-foreground">{name}</div>
        <button type="button" aria-label={`More for ${name}`} data-tip="More" className={ICON} onClick={more}><Ellipsis className="size-3.5 [@media(pointer:coarse)]:size-4.5" /></button>
        {phone && <button type="button" aria-label="Close" className={ICON} onClick={close}><X className="size-4.5" /></button>}
        {windowed && <button type="button" aria-label="Close" data-tip="Close" className={ICON} onClick={close}><X className="size-3.5" /></button>}
      </div>
      {(items.length > 0 || busy) && (
        <div ref={list} className="edge-fade-y max-h-[280px] overflow-y-auto overscroll-contain px-2.5 pt-2 [scrollbar-width:none] [@media(pointer:coarse)]:max-h-[45vh] [&::-webkit-scrollbar]:hidden">
          {items.map((n) => n.kind === "ask" ? (
            // (what the user asked it: theirs, on the right, as in any conversation)
            <div key={n.id} data-asked={n.id} className="flex justify-end pb-2 pl-8">
              <div className="min-w-0 rounded-[10px] rounded-br-[4px] bg-foreground/[0.07] px-2.5 py-1.5 break-words whitespace-pre-wrap">{n.text}</div>
            </div>
          ) : (
            <div key={n.id} data-said={n.id} data-question={n.question || undefined} className="group flex items-start gap-0.5 pb-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-muted-foreground">{time(n.t)}</div>
                {words(n)}
              </div>
              {actions && <div className="mt-2 flex shrink-0">{actions(n)}</div>}
            </div>
          ))}
          {busy && <div data-companion-busy className="pb-2.5 pl-0.5" aria-label={`${name} is thinking`}><span className="companion-dots" style={{ color: tint }}><i /><i /><i /></span></div>}
        </div>
      )}
      <div className={`flex items-center ${items.length > 0 || busy ? "border-t border-border/60" : ""}`}>
        <input autoFocus={focus} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder ?? `Ask ${name}`} enterKeyHint="send"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send() } else if (e.key === "Escape") { e.preventDefault(); close() } }}
          className="h-9 min-w-0 flex-1 bg-transparent px-3 text-[13.5px] outline-none [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-[17px]" />
        {tools}
      </div>
    </div>
  )
}
