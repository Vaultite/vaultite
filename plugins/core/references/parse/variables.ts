import { dateFields, nameFields } from "../csl.ts"

export const NAME_KEYS = new Set<string>([...nameFields, "chair", "compiler", "contributor", "curator",
  "executive-producer", "guest", "host", "narrator", "organizer", "performer", "producer", "script-writer",
  "series-creator", "translator"])

export const DATE_KEYS = new Set<string>([...dateFields, "available-date"])

export const TEXT_KEYS = new Set<string>(["abstract", "annote", "archive", "archive_collection", "archive_location",
  "archive-place", "authority", "call-number", "chapter-number", "citation-key", "citation-label", "collection-number",
  "collection-title", "container-title", "container-title-short", "dimensions", "division", "DOI", "edition", "event",
  "event-title", "event-place", "genre", "ISBN", "ISSN", "issue", "jurisdiction", "keyword", "language", "license",
  "medium", "note", "number", "number-of-pages", "number-of-volumes", "original-publisher", "original-publisher-place",
  "original-title", "page", "page-first", "part-number", "part-title", "PMCID", "PMID", "printing-number", "publisher",
  "publisher-place", "references", "reviewed-genre", "reviewed-title", "scale", "section", "source", "status",
  "supplement-number", "title", "title-short", "URL", "version", "volume", "volume-title", "volume-title-short",
  "year-suffix", "journalAbbreviation", "shortTitle"])

export const KEY_CASE = new Map([["doi", "DOI"], ["url", "URL"], ["isbn", "ISBN"], ["issn", "ISSN"], ["pmid", "PMID"],
  ["pmcid", "PMCID"]])
