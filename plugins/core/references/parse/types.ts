import { isItemType } from "../csl.ts"

const BIBTEX: [string, string][] = [
  ["article", "article-journal"], ["book", "book"], ["mvbook", "book"], ["bookinbook", "chapter"], ["booklet", "pamphlet"],
  ["collection", "book"], ["mvcollection", "book"], ["proceedings", "book"], ["mvproceedings", "book"],
  ["reference", "book"], ["mvreference", "book"], ["inbook", "chapter"], ["incollection", "chapter"],
  ["suppbook", "chapter"], ["suppcollection", "chapter"], ["inreference", "entry-encyclopedia"],
  ["inproceedings", "paper-conference"], ["conference", "paper-conference"], ["manual", "book"], ["misc", "document"],
  ["online", "webpage"], ["electronic", "webpage"], ["www", "webpage"], ["patent", "patent"],
  ["periodical", "periodical"], ["suppperiodical", "article-journal"], ["phdthesis", "thesis"],
  ["mastersthesis", "thesis"], ["thesis", "thesis"], ["report", "report"], ["techreport", "report"],
  ["unpublished", "manuscript"], ["dataset", "dataset"], ["data", "dataset"], ["software", "software"],
  ["softwareversion", "software"], ["codefragment", "software"], ["standard", "standard"],
  ["letter", "personal_communication"], ["artwork", "graphic"], ["image", "graphic"], ["audio", "song"],
  ["music", "song"], ["video", "motion_picture"], ["movie", "motion_picture"], ["performance", "performance"],
  ["jurisdiction", "legal_case"], ["legislation", "legislation"], ["legal", "legislation"], ["review", "review"],
  ["set", "document"], ["xdata", "document"],
]

const ZOTERO: [string, string][] = [
  ["journalArticle", "article-journal"], ["magazineArticle", "article-magazine"],
  ["newspaperArticle", "article-newspaper"], ["bookSection", "chapter"], ["conferencePaper", "paper-conference"],
  ["encyclopediaArticle", "entry-encyclopedia"], ["dictionaryEntry", "entry-dictionary"], ["blogPost", "post-weblog"],
  ["forumPost", "post"], ["webpage", "webpage"], ["thesis", "thesis"], ["report", "report"], ["preprint", "article"],
  ["manuscript", "manuscript"], ["letter", "personal_communication"], ["email", "personal_communication"],
  ["instantMessage", "personal_communication"], ["interview", "interview"], ["film", "motion_picture"],
  ["videoRecording", "motion_picture"], ["tvBroadcast", "broadcast"], ["radioBroadcast", "broadcast"],
  ["podcast", "song"], ["audioRecording", "song"], ["presentation", "speech"], ["computerProgram", "software"],
  ["case", "legal_case"], ["statute", "legislation"], ["bill", "bill"], ["hearing", "hearing"], ["patent", "patent"],
  ["artwork", "graphic"], ["map", "map"], ["document", "document"], ["note", "document"], ["attachment", "document"],
  ["standard", "standard"], ["dataset", "dataset"], ["book", "book"],
]

const TYPES = new Map<string, string>()
for (const [from, to] of [...BIBTEX, ...ZOTERO]) TYPES.set(from.toLowerCase(), to)
const BIBTEX_TYPES = new Map(BIBTEX)

export function bibtexTypeOf(entryType: string): string {
  return BIBTEX_TYPES.get(entryType.toLowerCase()) ?? itemTypeOf(entryType)
}

export function itemTypeOf(text: string): string {
  const t = text.trim()
  if (isItemType(t)) return t
  const lower = t.toLowerCase()
  if (isItemType(lower)) return lower
  return TYPES.get(lower.replace(/[\s_-]/g, "")) ?? "document"
}
