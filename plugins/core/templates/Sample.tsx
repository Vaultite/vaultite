import { useEffect, useState } from "react"
import { formatDate, Markdown, readFile, splitFm } from "@vaultite"
import { fillVars, type FORMATS } from "./fill"

export function TemplateSample({ path, formats }: { path: string; formats: typeof FORMATS }) {
  const [body, setBody] = useState<string | null>(null)
  useEffect(() => {
    readFile(path).then(({ text }) => setBody(splitFm(fillVars(text, "Untitled", formatDate, new Date(), formats)).body), () => setBody(""))
  }, [path, formats])
  return body && <Markdown text={body} full />
}
