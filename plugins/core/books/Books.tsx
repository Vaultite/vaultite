// Books on Learning (reading, up next, finished) and a book's sheet (book/<id>).
import { BookOpen } from "lucide-react"
import {
  detailPath, Empty, fmtDay, fmtLongDay, Group, isArchived, KV, List, Markdown, openDetail, Panel, Row, Section, SheetHead,
  type Store,
} from "@vaultite"
import type { Book } from "./types"

function BookRow({ b }: { b: Book }) {
  // (A current page past the last one, a typo, reads as finished: never a bar wider than its track.)
  const pct = b.total_pages ? Math.min(100, Math.max(0, Math.round(((b.current_page || 0) / b.total_pages) * 100))) : null
  const meta = [b.author, b.status === "reading" && b.started && !pct ? `started ${fmtDay(b.started).replace(/^(Today|Yesterday)$/, (w) => w.toLowerCase())}` : null].filter(Boolean).join(" · ")
  return (
    <div>
      <Row title={b.title} meta={meta} onOpen={() => openDetail(detailPath("book", b.id))}
        right={pct !== null ? `${pct}%` : b.status === "done" && b.rating ? `${b.rating}/5` : undefined} />
      {pct !== null && (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-[var(--orange)]" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export function BooksPanel({ store }: { store: Store }) {
  const books = store.books.filter((b) => !isArchived(b))
  const groups: [string, Book[]][] = [
    ["Reading", books.filter((b) => b.status === "reading")],
    ["Up next", books.filter((b) => b.status === "want").slice(0, 5)],
    ["Finished", books.filter((b) => b.status === "done").slice(0, 5)],
  ]
  return (
    <Panel title="Books" icon={BookOpen} tint="var(--orange)">
      {!books.length ? (
        <Empty>No books yet. Tell Claude what you're reading.</Empty>
      ) : (
        <div className="space-y-4">
          {groups.filter(([, bs]) => bs.length).map(([title, bs]) => (
            <Section key={title} title={title}>
              <List>{bs.map((b) => <BookRow key={b.id} b={b} />)}</List>
            </Section>
          ))}
        </div>
      )}
    </Panel>
  )
}

const STATUS: Record<Book["status"], string> = { reading: "Reading", want: "Want to read", done: "Finished", dropped: "Dropped" }

/** Status, progress, dates and rating: the sheet's body, and the header of a book's file. */
export function BookFields({ b }: { b: Book }) {
  return (
    <Group>
      <KV label="Status">{STATUS[b.status]}</KV>
      {b.total_pages ? <KV label="Progress">{b.current_page || 0} of {b.total_pages} pages</KV> : null}
      {b.started && <KV label="Started">{fmtLongDay(b.started)}</KV>}
      {b.finished && <KV label="Finished">{fmtLongDay(b.finished)}</KV>}
      {b.rating ? <KV label="Rating">{b.rating}/5</KV> : null}
    </Group>
  )
}

export function BookDetail({ store, b }: { store: Store; b: Book }) {
  return (
    <>
      <SheetHead icon={BookOpen} tint="var(--orange)" kicker="Book" title={b.title} sub={b.author} />
      <div className="space-y-5">
        <BookFields b={b} />
        {b.notes && (
          <Section title="Notes"><Markdown store={store} text={b.notes} /></Section>
        )}
      </div>
    </>
  )
}
