// Made-up books for plugin previews (Plugins → a plugin).
import { addDays, today, type Store } from "@vaultite"
import type { Book } from "./types"

export function mockBooks(): Partial<Store> {
  const d = (n: number) => addDays(today(), -n)
  const books: Book[] = [
    { id: "Books/The Pragmatic Programmer", title: "The Pragmatic Programmer", author: "Hunt and Thomas", status: "reading", total_pages: 350,
      current_page: 140, started: d(12), finished: null, rating: null, notes: "", created: d(20) },
    { id: "Books/Deep Work", title: "Deep Work", author: "Cal Newport", status: "done", total_pages: 296, current_page: 296,
      started: d(60), finished: d(30), rating: 4, notes: "", created: d(70) },
  ]
  return { books }
}
