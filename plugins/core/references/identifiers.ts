import { z } from "zod"
import { bareDoi, CslItem } from "./csl.ts"
import { readCslItem } from "./parse/normalize.ts"
import { CslFields } from "./parse/normalize.ts"

export const DOI_URL = () => process.env.VAULTITE_DOI_URL || "https://doi.org"
export const BOOKS_URL = () => process.env.VAULTITE_OPENLIBRARY_URL || "https://openlibrary.org"

export type Identified = { kind: "doi" | "arxiv" | "isbn"; id: string }

export class LookupError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = "LookupError"
    this.status = status
  }
}

export function identify(text: string): Identified | null {
  const t = text.trim()
  const arxiv = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?(?:\.pdf)?$/i.exec(t)
  if (arxiv && (/arxiv/i.test(t) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(t))) return { kind: "arxiv", id: arxiv[1] }
  const doi = bareDoi(t)
  if (doi) return { kind: "doi", id: doi }
  const isbn = t.replace(/^isbn[:\s]*/i, "").replace(/[\s-]/g, "")
  if (/^(97[89])?\d{9}[\dX]$/i.test(isbn) && checksOut(isbn)) return { kind: "isbn", id: isbn.toUpperCase() }
  return null
}

function checksOut(isbn: string) {
  const d = isbn.toUpperCase().split("").map((c) => (c === "X" ? 10 : Number(c)))
  if (d.length === 10) return d.reduce((s, n, i) => s + n * (10 - i), 0) % 11 === 0
  return d.reduce((s, n, i) => s + n * (i % 2 ? 3 : 1), 0) % 10 === 0
}

async function fetchOk(url: string, headers: Record<string, string>) {
  let r: Response
  try { r = await fetch(url, { headers, signal: AbortSignal.timeout(15000), redirect: "follow" }) } catch { throw new LookupError("the lookup service isn't answering: try again later", 502) }
  if (r.status === 404) throw new LookupError("nothing is registered under that identifier", 404)
  if (!r.ok) throw new LookupError(`the lookup service answered ${r.status}`, 502)
  return r
}

async function byDoi(doi: string): Promise<CslItem> {
  const r = await fetchOk(`${DOI_URL()}/${encodeURI(doi)}`, { Accept: "application/vnd.citationstyles.csl+json" })
  const fields = CslFields.safeParse(await r.json().catch(() => null))
  if (!fields.success) throw new LookupError("doi.org's answer wasn't understood", 502)
  const read = readCslItem({ ...fields.data, id: doi })
  if (!read.item) throw new LookupError("doi.org's answer wasn't a reference", 502)
  return { ...read.item, DOI: read.item.DOI || doi }
}

const Book = z.looseObject({
  title: z.string(),
  subtitle: z.string().optional(),
  authors: z.array(z.looseObject({ name: z.string() })).optional(),
  publishers: z.array(z.looseObject({ name: z.string() })).optional(),
  publish_places: z.array(z.looseObject({ name: z.string() })).optional(),
  publish_date: z.string().optional(),
  number_of_pages: z.number().optional(),
  url: z.string().optional(),
})

async function byIsbn(isbn: string): Promise<CslItem> {
  const r = await fetchOk(`${BOOKS_URL()}/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, { Accept: "application/json" })
  const found = z.record(z.string(), Book).safeParse(await r.json().catch(() => null))
  const book = found.success ? found.data[`ISBN:${isbn}`] : undefined
  if (!book) throw new LookupError("Open Library has no book with that ISBN", 404)
  const read = readCslItem({
    id: isbn, type: "book", title: book.subtitle ? `${book.title}: ${book.subtitle}` : book.title,
    author: (book.authors ?? []).map((a) => a.name), publisher: book.publishers?.[0]?.name ?? "",
    "publisher-place": book.publish_places?.[0]?.name ?? "", issued: book.publish_date ?? "", ISBN: isbn,
    "number-of-pages": book.number_of_pages ? String(book.number_of_pages) : "",
  })
  if (!read.item) throw new LookupError("Open Library's answer wasn't a book", 502)
  return read.item
}

export async function lookUp(id: Identified): Promise<CslItem> {
  if (id.kind === "isbn") return byIsbn(id.id)
  if (id.kind === "arxiv") {
    const item = await byDoi(`10.48550/arXiv.${id.id}`)
    return { ...item, type: item.type === "article" || item.type === "document" ? "article" : item.type, URL: item.URL || `https://arxiv.org/abs/${id.id}` }
  }
  return byDoi(id.id)
}
