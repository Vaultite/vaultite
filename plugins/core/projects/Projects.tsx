// Projects: a card per project file, drawn from the file's own blocks (what it is, then any live numbers it asks for),
// so a card changes when its file does.
import { ArrowUpRight } from "lucide-react"
import { cn, Empty, FileBlocks, isArchived, openFile, Panel, type BlockCtx } from "@vaultite"
import { GitHubIcon } from "./GitHubIcon"
import type { Project } from "./types"

const STATUS: Record<string, string> = { live: "var(--green)", building: "var(--blue)", idea: "var(--gray)", paused: "var(--orange)" }

export function ProjectCards({ store }: BlockCtx) {
  const projects = store.projects.filter((p) => !isArchived(p))
  if (!projects.length) return <Empty>No projects yet. Ask Claude to add one (a file in the vault's Projects folder).</Empty>
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* The first project gets the full row. */}
      {projects.map((p, i) => (
        <Panel key={p.id} className={i === 0 ? "lg:col-span-2" : undefined}>
          <button type="button" onClick={() => openFile(`${p.id}.md`)} className="mb-2 block cursor-pointer text-left text-[20px] font-semibold hover:underline">{p.name}</button>
          <div className="space-y-4">
            <FileBlocks store={store} path={`${p.id}.md`} fallback={["project"]}
              fm={{ status: p.status, tagline: p.tagline, links: p.links, repo: p.repo, path: p.path }} />
          </div>
        </Panel>
      ))}
    </div>
  )
}

/** ```block-project: status, tagline, links and repo as typed in the file; live numbers are other plugins' blocks. */
export function ProjectBlock({ fm }: BlockCtx) {
  const status = String(fm.status ?? ""), tagline = String(fm.tagline ?? "")
  const repo = typeof fm.repo === "string" && fm.repo.includes("/") ? `https://github.com/${fm.repo}` : null
  // A link to the repo itself is the mark's already.
  const links = Array.isArray(fm.links) ? (fm.links as Project["links"]).filter((l) => l && typeof l.url === "string" && l.url.replace(/\/$/, "") !== repo) : []
  return (
    <div>
      {status && <div className="mb-2 flex"><StatusPill status={status} /></div>}
      {tagline && <p className="mb-4 text-[15px] text-muted-foreground">{tagline}</p>}
      <Links links={links} repo={repo} />
    </div>
  )
}

/** The project a block is about: the file it's in, or the one its `project:` option names. */
export function projectFor({ store, path, options }: BlockCtx) {
  const name = typeof options.project === "string" ? options.project.toLowerCase() : null
  return store.projects.find((p) => (name ? p.name.toLowerCase() === name : `${p.id}.md` === path)) ?? null
}

function StatusPill({ status }: { status: string }) {
  if (!status) return null
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-medium">
      <span className="size-1.5 rounded-full" style={{ background: STATUS[status] ?? "var(--gray)" }} />
      {status[0].toUpperCase() + status.slice(1)}
    </span>
  )
}

function Links({ links, repo }: { links: Project["links"]; repo: string | null }) {
  if (!links.length && !repo) return null
  return (
    <div className="mb-1 flex flex-wrap gap-2">
      {links.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
          className={cn("flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-[14px] font-medium text-primary transition hover:bg-primary/15")}>
          {l.label}
          <ArrowUpRight className="size-3.5" />
        </a>
      ))}
      {repo && (
        <a href={repo} target="_blank" rel="noreferrer" aria-label="GitHub" data-tip={repo.slice(19)}
          className="grid size-[33px] place-items-center rounded-full bg-primary/10 text-primary transition hover:bg-primary/15">
          <GitHubIcon className="size-[17px]" />
        </a>
      )}
    </div>
  )
}
