// A bundle's link, in its share sheet: once its file is in a GitHub repository, vaultite.com/b/<owner>/<name> shows it
// and tries it live in the web demo, then opens it in the app (core/bundlelinks.ts).
import { useState } from "react"
import { Link2 } from "lucide-react"
import { copyText } from "@/core/richmd"
import { notify, notifyError } from "@/core/notify"
import { Panel } from "@/components/kit"
import { Button } from "@/components/Button"
import type { BundleInfo } from "@/core/bundles"
import { parseRepo, repoText, webLink } from "../../../core/bundlelinks.ts"

export function BundleLink({ b }: { b: BundleInfo }) {
  const from = b.from ? parseRepo(b.from) : null
  const [text, setText] = useState(from ? repoText(from, false) : "")
  const repo = parseRepo(text)
  const link = repo ? webLink(repo) : null
  const copy = async () => {
    if (!link) return
    if (await copyText(link)) notify(`Copied the link to ${b.name}`)
    else notifyError(new Error("the clipboard can't be reached here"), "Couldn't copy it")
  }
  return (
    <div className="mt-4" data-bundle-link><Panel title="Link" icon={Link2}>
      <p className="mb-3 text-[13px] leading-[18px] text-muted-foreground">
        Put the file at the top of a public GitHub repository: others import it by its name (owner/name), and its link opens a page where anyone can try it live, then add it.
      </p>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void copy() }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="owner/name" spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="GitHub repository"
          className="h-10 min-w-0 flex-1 basis-40 rounded-[8px] border-[0.5px] border-border bg-card px-3 font-mono text-[16px] outline-none placeholder:font-sans placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 md:h-9 md:text-[13px]"
          data-bundle-link-repo />
        <Button type="submit" disabled={!link} data-bundle-link-copy><Link2 className="size-4" strokeWidth={2} />Copy link</Button>
      </form>
      {link && <p className="mt-2 truncate font-mono text-[13px] text-muted-foreground" data-bundle-link-url>{link}</p>}
    </Panel></div>
  )
}
