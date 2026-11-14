declare module "citeproc" {
  type CiteprocItem = import("./csl.ts").CslItem
  type CiteprocSys = { retrieveLocale: (lang: string) => string | false; retrieveItem: (id: string) => CiteprocItem | undefined }
  type CiteprocCitation = {
    citationID: string
    citationItems: { id: string; locator?: string; label?: string; prefix?: string; suffix?: string; "suppress-author"?: boolean; "author-only"?: boolean }[]
    properties: { noteIndex: number; mode?: "composite" | "author-only" | "suppress-author" }
  }
  type CiteprocBibliography = [{ entry_ids: string[][]; bibliography_errors: { itemID?: string }[]; hangingindent?: boolean; "second-field-align"?: string | false }, string[]]
  export class Engine {
    constructor(sys: CiteprocSys, style: string, lang?: string, forceLang?: boolean)
    opt: { development_extensions: { wrap_url_and_doi: boolean }; xclass: string }
    updateItems(ids: string[]): void
    setOutputFormat(format: "html" | "text" | "rtf"): void
    rebuildProcessorState(citations: CiteprocCitation[], format?: "html" | "text"): [string, number, string][]
    makeBibliography(): CiteprocBibliography | false
  }
  const CSL: { Engine: typeof Engine }
  export default CSL
}
