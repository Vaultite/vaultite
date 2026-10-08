import { BookOpen } from "lucide-react"
import { definePlugin, detailPath, plainText } from "@vaultite"
import { BookDetail, BookFields, BooksPanel } from "./Books"
import { mockBooks } from "./mock"

export default definePlugin({
  mock: mockBooks,
  details: {
    book: {
      render: (s, [id]) => { const b = s.books.find((x) => x.id === id); return b ? <BookDetail store={s} b={b} /> : null },
      title: (s, [id]) => s.books.find((x) => x.id === id)?.title ?? "",
      // On desktop a book opens as its file (its block draws the same fields), like a person, a note or a log.
      file: (s, [id]) => (s.books.some((x) => x.id === id) ? `${id}.md` : null),
    },
  },
  files: {
    types: ["book"], folders: ["Books"], icon: BookOpen, tint: "var(--orange)",
    kicker: ({ store, path }) => { const b = store.books.find((x) => `${x.id}.md` === path); return b?.author ? `Book · ${b.author}` : "Book" },
  },
  blocks: {
    // ```block-book: the book file's fields. ```block-books: what you're reading and want to read (on Learning).
    book: ({ store, path }) => { const b = store.books.find((x) => `${x.id}.md` === path); return b ? <BookFields b={b} /> : null },
    books: ({ store }) => <BooksPanel store={store} />,
  },
  search: (s) => s.books.map((b) => ({
    id: `book-${b.id}`, title: b.title, meta: b.author, kind: "Book", icon: BookOpen, tint: "var(--learning)",
    detail: detailPath("book", b.id), file: `${b.id}.md`, text: `${b.author} ${plainText(b.notes)}`, recent: 0, weight: 4,
  })),
  links: (s) => s.books.map((b) => ({ kind: "book", id: b.id, title: b.title, detail: detailPath("book", b.id), names: [b.title] })),
  preview: "learning",
})
