import { z } from "zod"

export const CslName = z.looseObject({
  family: z.string().optional(),
  given: z.string().optional(),
  "dropping-particle": z.string().optional(),
  "non-dropping-particle": z.string().optional(),
  suffix: z.string().optional(),
  literal: z.string().optional(),
})
export type CslName = z.infer<typeof CslName>

export const CslDate = z.looseObject({
  "date-parts": z.array(z.array(z.union([z.number(), z.string()]))).optional(),
  literal: z.string().optional(),
  raw: z.string().optional(),
  season: z.union([z.number(), z.string()]).optional(),
  circa: z.union([z.boolean(), z.number(), z.string()]).optional(),
})
export type CslDate = z.infer<typeof CslDate>

const NAME_FIELDS = ["author", "editor", "translator", "container-author", "collection-editor", "composer", "director",
  "interviewer", "recipient", "reviewed-author", "editorial-director", "illustrator", "original-author"] as const
const DATE_FIELDS = ["issued", "accessed", "original-date", "event-date", "submitted"] as const
export type NameField = typeof NAME_FIELDS[number]
export type DateField = typeof DATE_FIELDS[number]
export const nameFields: readonly NameField[] = NAME_FIELDS
export const dateFields: readonly DateField[] = DATE_FIELDS

export const CslItem = z.looseObject({
  id: z.string(),
  type: z.string(),
  title: z.string().optional(),
  "container-title": z.string().optional(),
  publisher: z.string().optional(),
  "publisher-place": z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  page: z.string().optional(),
  edition: z.string().optional(),
  DOI: z.string().optional(),
  URL: z.string().optional(),
  ISBN: z.string().optional(),
  ISSN: z.string().optional(),
  abstract: z.string().optional(),
  note: z.string().optional(),
  language: z.string().optional(),
  ...Object.fromEntries(NAME_FIELDS.map((k) => [k, z.array(CslName).optional()])),
  ...Object.fromEntries(DATE_FIELDS.map((k) => [k, CslDate.optional()])),
})
export type CslItem = z.infer<typeof CslItem> & Partial<Record<NameField, CslName[]>> & Partial<Record<DateField, CslDate>>

export const ITEM_TYPES = ["article", "article-journal", "article-magazine", "article-newspaper", "bill", "book", "broadcast",
  "chapter", "classic", "collection", "dataset", "document", "entry", "entry-dictionary", "entry-encyclopedia", "event",
  "figure", "graphic", "hearing", "interview", "legal_case", "legislation", "manuscript", "map", "motion_picture",
  "musical_score", "pamphlet", "paper-conference", "patent", "performance", "periodical", "personal_communication",
  "post", "post-weblog", "regulation", "report", "review", "review-book", "software", "song", "speech", "standard",
  "thesis", "treaty", "webpage"] as const
const TYPES = new Set<string>(ITEM_TYPES)
export const isItemType = (t: string) => TYPES.has(t)

export function familyOf(n: CslName): string {
  if (n.literal) return n.literal
  return [n["non-dropping-particle"], n.family].filter(Boolean).join(" ") || n.given || ""
}

export function nameText(n: CslName): string {
  if (n.literal) return n.literal
  const family = familyOf(n), given = [n.given, n["dropping-particle"]].filter(Boolean).join(" ")
  return [family, given, n.suffix].filter(Boolean).join(", ")
}

export function yearOf(item: CslItem): string {
  const d = item.issued
  const y = d?.["date-parts"]?.[0]?.[0]
  if (y !== undefined && String(y).trim()) return String(y)
  const m = /\b(\d{4})\b/.exec(d?.raw ?? d?.literal ?? "")
  return m ? m[1] : ""
}

export function authorsShort(item: CslItem): string {
  const names = item.author?.length ? item.author : item.editor ?? []
  if (!names.length) return ""
  if (names.length === 1) return familyOf(names[0])
  if (names.length === 2) return `${familyOf(names[0])} and ${familyOf(names[1])}`
  return `${familyOf(names[0])} et al.`
}

export function bareDoi(text: string): string {
  const m = /(10\.\d{4,9}\/\S+)/i.exec(text.trim())
  return m ? m[1].replace(/[.,;]+$/, "") : ""
}

export function searchText(item: CslItem): string {
  const names = [...item.author ?? [], ...item.editor ?? []].map(nameText).join(" ")
  return [item.id, names, yearOf(item), item.title ?? "", item["container-title"] ?? ""].join(" ")
}
