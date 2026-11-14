import type { CslItem } from "../../../plugins/core/references/csl.ts"
import { parseBibtex } from "../../../plugins/core/references/parse/bibtex.ts"
import { parseCslJson, parseCslYaml } from "../../../plugins/core/references/parse/csljson.ts"
import { makeKey } from "../../../plugins/core/references/parse/keys.ts"
import { latexToUnicode } from "../../../plugins/core/references/parse/latex.ts"
import { cslItemFrom } from "../../../plugins/core/references/parse/normalize.ts"
import { parseRis } from "../../../plugins/core/references/parse/ris.ts"
import { itemTypeOf } from "../../../plugins/core/references/parse/types.ts"
import type { VaultTest } from "./harness.ts"

const BIB = String.raw`
% Exported by a tool, with junk before the first entry: foo@bar.com
@comment{jabref-meta: databaseType:biblatex;}
@preamble{ "\newcommand{\noopsort}[1]{} {unbalanced in a string" }
@String{ JBIO = "Journal of {B}iology" }
@string(pub = {Springer})

@Article{ozturk2020,
  author    = {{\"O}zt{\"u}rk, Ay{\c{s}}e and Ga{\'{e}}tan, Jean and \v{S}koda, Petr and others},
  title     = {The {DNA} of {Drosophila}: {{RNA}} and \emph{in vivo} studies},
  journal   = jbio # " Letters",
  year      = 2020,
  month     = jan # "~" # "15",
  volume    = "12",
  number    = {3},
  pages     = {12--34},
  doi       = {https://doi.org/10.1000/xyz\_123},
  note      = "Quoted {with "braces"} inside",
  langid    = {english},
  keywords  = {genetics; flies},
}

junk between entries @ not an entry

@book(knuth84, author = "Donald E. Knuth", title = "The {\TeX}book", publisher = PUB, year = "1984",
  address = {Reading, MA}, series = {Computers and Typesetting}, number = {A}, edition = {2nd})

@inproceedings{child2020,
  author = {de la Fontaine, Jr, Jean and Ludwig van Beethoven and {Barnes and Noble}},
  title = {A child paper}, crossref = {conf2020}, pages = {1-10}}
@proceedings{conf2020, title = {Proceedings of the {ACM} Conference}, editor = {Smith, Alice},
  publisher = {ACM}, year = {2020}, location = {Paris}}

@article{broken2020, title = {This entry never closes its braces,
  year = 2020

@online{after2021, title = {After the broken one}, url = {https://example.com/a{\_}b}, urldate = {2021-03-04},
  author = {{World Health Organization}}}
@article{after2021, title = {A duplicate}}
@book{range2001, title = {Range}, date = {2001/2003}, author = {Doe, J.}}
@misc{vaswani2017, title = {Attention is all you need}, eprint = {1706.03762}, eprinttype = {arxiv},
  author = {Vaswani, Ashish}, year = 2017}
@xdata{mitpress, publisher = {MIT Press}, location = {Cambridge, MA}}
@book{gogh1999, title = {Letters}, xdata = {mitpress}, date = {1999-05},
  author = {family=Gogh, given=Vincent, prefix=van}}
@phdthesis{doe2010, author = {Doe, Jane}, title = {On things}, school = {MIT}, year = 2010}
@techreport{rep2019, author = {Roe, R.}, title = {Report}, institution = {NASA}, number = {TR-7}, year = 2019}
@misc{plain, title = {No url here}, howpublished = {Leaflet}, year = {in press}}
`

const ZOTERO_RIS = "﻿TY  - JOUR\r\nTI  - How to take smart notes\r\nAU  - Ahrens, Sönke\r\nAU  - van Gogh, Vincent\r\n" +
  "AU  - World Health Organization\r\nT2  - Journal of Notes\r\nJ2  - J. Notes\r\nVL  - 4\r\nIS  - 2\r\nSP  - 10\r\nEP  - 20\r\n" +
  "PY  - 2017\r\nDA  - 2017/03/01/\r\nDO  - 10.1234/abc\r\nUR  - https://example.com/notes\r\nSN  - 1234-567X\r\n" +
  "KW  - notes\r\nKW  - writing\r\nAB  - An abstract\r\n  that wraps.\r\nLA  - en\r\nY2  - 2020/01/05/10:20:00\r\nER  - \r\n\r\n"
const ENDNOTE_RIS = "TY  - CHAP\nID  - 42\nA1  - Doe, Jane\nED  - Smith, Al\nT1  - A chapter\nBT  - The book\nY1  - 2001///\n" +
  "SP  - 5-9\nPB  - Press\nCY  - Berlin\nSN  - 978-3-16-148410-0\nN1  - A note\nER  - \nTY  - BOOK\nID  - doe2001\n" +
  "AU  - Doe, Jane\nTI  - Another\nPY  - 2001\nER  -\nTY  - WEIRD\nTI  - Odd one\nER  - \n"

const PANDOC_YAML = `---
references:
- id: ahrens2017
  type: book
  author:
  - family: Ahrens
    given: Sönke
  title: How to take smart notes
  issued:
    date-parts:
    - - 2017
  publisher: CreateSpace
- id: older
  type: article-journal
  issued:
  - year: 2001
    month: 5
...
`

type Check = VaultTest["check"]
type Expect = Partial<CslItem>

const byId = (items: CslItem[], id: string) => items.find((i) => i.id === id)
const show = JSON.stringify
const has = (item: CslItem | undefined, expected: Expect) => Object.entries(expected).every(([k, v]) => show(item?.[k]) === show(v))
const exactly = (item: CslItem | null | undefined, expected: CslItem) => has(item ?? undefined, expected) && Object.keys(item ?? {}).length === Object.keys(expected).length
const issued = (...parts: number[][]) => ({ "date-parts": parts })

function latexChecks(check: Check) {
  const latex = latexToUnicode(String.raw`{\"O}zt{\"u}rk Ga{\'{e}}tan \v{S}koda \"o \'{\i}a \c{c} \u{a} \H{o} \k{a} \r{a} \=a \.z \^o \`a \~n Stra\ss e \o{} \AE{} \l{} \aa{}`)
  check("references: LaTeX accents in every form become Unicode letters", latex === "Öztürk Gaétan Škoda ö ía ç ă ő ą å ā ż ô à ñ Straße ø Æ ł å", latex)
  const marks = latexToUnicode(String.raw`a---b 1--2 x~y \& 5\% \$ a\_b \#1 \{x\} ` + "``q''" + String.raw` \textit{i} \textbf{b} \textsc{s} x\textsuperscript{2} \url{http://a.b/c\_d} \href{http://x}{link} \unknown{kept} {\it old}`)
  check("references: LaTeX dashes, spaces, escapes, quotes and formatting become text and citeproc markup",
    marks === "a—b 1–2 x y & 5% $ a_b #1 {x} “q” <i>i</i> <b>b</b> <span style=\"font-variant:small-caps;\">s</span> x<sup>2</sup> http://a.b/c_d link kept <i>old</i>", marks)
  const prot = [latexToUnicode("The {DNA} of {\\\"O}l", true), latexToUnicode("The {DNA}")]
  check("references: braces protecting case become nocase spans only when asked", show(prot) === show(["The <span class=\"nocase\">DNA</span> of Öl", "The DNA"]), prot)
}

function bibtexBasics(check: Check, items: CslItem[]) {
  const oz = byId(items, "ozturk2020")
  check("references: BibTeX names with LaTeX accents parse, and 'and others' is dropped",
    has(oz, { author: [{ given: "Ayşe", family: "Öztürk" }, { given: "Jean", family: "Gaétan" }, { given: "Petr", family: "Škoda" }] }), oz?.author)
  check("references: a BibTeX title keeps protected case as nocase spans and emphasis as italics",
    has(oz, { title: "The <span class=\"nocase\">DNA</span> of <span class=\"nocase\">Drosophila</span>: <span class=\"nocase\">RNA</span> and <i>in vivo</i> studies" }), oz?.title)
  check("references: @string macros are case-insensitive and join with # into the journal",
    has(oz, { "container-title": "Journal of <span class=\"nocase\">B</span>iology Letters" }), oz?.["container-title"])
  check("references: month macros joined with a day give the full issued date", has(oz, { issued: issued([2020, 1, 15]) }), oz?.issued)
  check("references: an article's number is its issue, pages get an en dash, the DOI is bare",
    has(oz, { issue: "3", page: "12–34", DOI: "10.1000/xyz_123", volume: "12" }), oz)
  check("references: a quoted value may hold braces and quotes inside them", has(oz, { note: "Quoted with \"braces\" inside" }), oz?.note)
  check("references: langid and keywords map to CSL language and keyword", has(oz, { language: "en", keyword: "genetics, flies" }), oz)
  const knuth = byId(items, "knuth84")
  check("references: an entry in parentheses with a macro publisher and a series number parses",
    has(knuth, { type: "book", title: "The TeXbook", publisher: "Springer", "publisher-place": "Reading, MA",
      "collection-title": "Computers and Typesetting", "collection-number": "A", edition: "2nd" }), knuth)
}

function bibtexInheritance(check: Check, items: CslItem[]) {
  const child = byId(items, "child2020")
  check("references: an inproceedings takes its proceedings' title, editor, publisher, place and year through crossref",
    has(child, { type: "paper-conference", title: "A child paper", "container-title": "Proceedings of the <span class=\"nocase\">ACM</span> Conference",
      publisher: "ACM", "publisher-place": "Paris", editor: [{ given: "Alice", family: "Smith" }], issued: issued([2020]), page: "1–10" }), child)
  check("references: 'von Last, Jr, First', 'First von Last' and a braced corporate name parse",
    has(child, { author: [{ given: "Jean", "non-dropping-particle": "de la", family: "Fontaine", suffix: "Jr" },
      { given: "Ludwig", "non-dropping-particle": "van", family: "Beethoven" }, { literal: "Barnes and Noble" }] }), child?.author)
  const gogh = byId(items, "gogh1999")
  check("references: xdata fields are inherited, the xdata entry isn't an item, and BibLaTeX's keyed names parse",
    has(gogh, { publisher: "MIT Press", "publisher-place": "Cambridge, MA", issued: issued([1999, 5]),
      author: [{ family: "Gogh", given: "Vincent", "non-dropping-particle": "van" }] }) && !byId(items, "mitpress"), gogh)
}

function bibtexRecovery(check: Check, items: CslItem[], problems: string[]) {
  check("references: a broken BibTeX entry is skipped with its key and line, and the entries after it still parse",
    !byId(items, "broken2020") && problems.some((p) => p.includes("broken2020") && p.includes("line 34"))
    && ["after2021", "vaswani2017", "plain"].every((id) => byId(items, id)), problems)
  const after = byId(items, "after2021")
  check("references: a duplicate key keeps the first entry and says so",
    has(after, { title: "After the broken one" }) && problems.some((p) => p.includes("after2021") && p.includes("twice")), problems)
  check("references: an online entry is a webpage with its URL unescaped, urldate as accessed and a corporate author",
    has(after, { type: "webpage", URL: "https://example.com/a_b", accessed: issued([2021, 3, 4]), author: [{ literal: "World Health Organization" }] }), after)
  check("references: a BibLaTeX date range becomes two date parts", has(byId(items, "range2001"), { issued: issued([2001], [2003]) }), byId(items, "range2001"))
  const arx = byId(items, "vaswani2017")
  check("references: an arXiv eprint becomes a preprint with its number and abs URL",
    has(arx, { type: "article", number: "arXiv:1706.03762", URL: "https://arxiv.org/abs/1706.03762", publisher: "arXiv" }), arx)
  const kinds = ["doe2010", "rep2019", "plain"].map((id) => byId(items, id))
  check("references: theses, reports and misc entries map to CSL types, genres and publishers",
    has(kinds[0], { type: "thesis", genre: "PhD thesis", publisher: "MIT" }) && has(kinds[1], { type: "report", number: "TR-7", publisher: "NASA", genre: "Technical report" })
    && has(kinds[2], { type: "document", publisher: "Leaflet", issued: { literal: "in press" } }), kinds)
  const short = parseBibtex("@misc{a, title={x}}\n@misc{b, title = {y}, author = {Last, First and {Org} and Plato}}")
  check("references: a short file parses all its entries", short.items.length === 2
    && has(short.items[1], { author: [{ given: "First", family: "Last" }, { literal: "Org" }, { family: "Plato" }] }), short)
}

function risChecks(check: Check) {
  const zotero = parseRis(ZOTERO_RIS).items[0]
  check("references: Zotero's RIS with CRLF and a BOM maps authors, container, pages, date and identifiers",
    has(zotero, { id: "ahrens2017", type: "article-journal", title: "How to take smart notes", "container-title": "Journal of Notes", page: "10–20",
      issue: "2", issued: issued([2017, 3, 1]), accessed: issued([2020, 1, 5]), DOI: "10.1234/abc", ISSN: "1234-567X", keyword: "notes, writing",
      abstract: "An abstract that wraps." }), zotero)
  check("references: RIS names keep particles, and a name without a comma is an organization",
    has(zotero, { author: [{ given: "Sönke", family: "Ahrens" }, { given: "Vincent", "non-dropping-particle": "van", family: "Gogh" }, { literal: "World Health Organization" }] }), zotero?.author)
  const endnote = parseRis(ENDNOTE_RIS)
  const [chap, book, odd] = endnote.items
  check("references: EndNote's RIS chapter takes its book as container, its ISBN, and a made key for a numeric ID",
    has(chap, { id: "doe2001", type: "chapter", "container-title": "The book", ISBN: "978-3-16-148410-0", page: "5-9",
      editor: [{ given: "Al", family: "Smith" }], issued: issued([2001]) }), chap)
  check("references: an RIS citekey ID already taken gets a made key, and an unknown type is a document with a problem",
    has(book, { id: "doe2001a" }) && has(odd, { type: "document" }) && endnote.problems.some((p) => p.includes("WEIRD")), endnote)
}

function cslChecks(check: Check) {
  const json = parseCslJson(JSON.stringify([{ id: 12, type: "journalArticle", title: "T", volume: 3, author: ["Ahrens, Sönke", { family: "Doe", given: "J" }], issued: "2017-03-01" },
    { title: "No id here" }, { id: "b", issued: { "date-parts": [["2019", "2"]] }, editor: "Smith, A; Jones, B" }, 5, { id: "b" }]))
  check("references: CSL JSON normalizes ids, numbers, string names, string dates and Zotero types",
    json.items.length === 2 && exactly(json.items[0], { id: "12", type: "article-journal", title: "T", volume: "3", author: [{ family: "Ahrens", given: "Sönke" }, { family: "Doe", given: "J" }], issued: issued([2017, 3, 1]) })
    && exactly(json.items[1], { id: "b", type: "document", issued: issued([2019, 2]), editor: [{ family: "Smith", given: "A" }, { family: "Jones", given: "B" }] }), json.items)
  check("references: CSL JSON items without an id, not objects or repeated are problems, not crashes",
    json.problems.length === 3 && json.problems[0].includes("No id here"), json.problems)
  const wrapped = parseCslJson(JSON.stringify({ items: [{ id: "x", type: "book", issued: 1962 }] })), bad = parseCslJson("{nope")
  check("references: CSL JSON in an items object parses, and broken JSON is a problem",
    has(wrapped.items[0], { id: "x", issued: issued([1962]) }) && !bad.items.length && bad.problems.length === 1, [wrapped, bad])
  const yaml = parseCslYaml(PANDOC_YAML), list = parseCslYaml("- id: a\n  title: b\n  issued: 2020-05\n")
  check("references: Pandoc's CSL YAML with references, date-parts and its old year/month dates parses",
    yaml.items.length === 2 && has(yaml.items[0], { publisher: "CreateSpace", issued: issued([2017]) }) && has(yaml.items[1], { issued: issued([2001, 5]) })
    && has(list.items[0], { issued: issued([2020, 5]) }), [yaml, list])
  const fm = cslItemFrom({ type: "reference", "item-type": "inproceedings", author: ["Kuhn, Thomas"], issued: 1962, doi: "10.1/x", url: "https://x.org", isbn: 123, tags: ["a"], title: "Structure" },
    { id: "kuhn1962", typeKey: "item-type", cslOnly: true })
  check("references: front matter normalizes to CSL: item-type as the type, lowercase DOI/URL/ISBN, string names, a bare year",
    exactly(fm, { id: "kuhn1962", type: "paper-conference", author: [{ family: "Kuhn", given: "Thomas" }], issued: issued([1962]), DOI: "10.1/x", URL: "https://x.org", ISBN: "123", title: "Structure" }), fm)
  const types = ["bookSection", "conferencePaper", "inproceedings", "article-journal", "nonsense"].map(itemTypeOf)
  check("references: Zotero and BibTeX type names map to CSL types", types.join() === "chapter,paper-conference,paper-conference,article-journal,document", types)
}

function keyChecks(check: Check) {
  const taken = new Set(["ahrens2017"])
  const ahrens: CslItem = { id: "", type: "book", author: [{ family: "Ahrens", "non-dropping-particle": "de" }], issued: issued([2017]) }
  const keys = [makeKey(ahrens, taken), makeKey(ahrens, taken), makeKey({ id: "", type: "book", author: [{ family: "Øster Łąka" }] }, taken),
    makeKey({ id: "", type: "book", title: "<i>Être</i> et temps" }, taken)]
  check("references: made keys are family plus year in ASCII, a letter added when taken, 'nd' without a year, a title word without authors",
    keys.join() === "ahrens2017a,ahrens2017b,osterlakand,etrend" && taken.has("ahrens2017b"), keys)
}

export default async ($: VaultTest) => {
  const { check } = $
  latexChecks(check)
  const bib = parseBibtex(BIB)
  bibtexBasics(check, bib.items)
  bibtexInheritance(check, bib.items)
  bibtexRecovery(check, bib.items, bib.problems)
  risChecks(check)
  cslChecks(check)
  keyChecks(check)
}
