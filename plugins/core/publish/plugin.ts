// Publish: notes and folders as public pages on Vaultite Cloud (a Publish plan, checked there). Which ones is the
// vault's (data.json `published`); the pages are rendered and served by Vaultite Cloud, sent by push.ts.
import { type OpCtx, OpError, Plugin } from "../../../core/plugins.ts"
import { collect, notesOf, type Source } from "./collect.ts"
import { notEntitled, PublishError, push, type Pushed, remote, type Relay, type Remote } from "./push.ts"

export const plugin = new Plugin(import.meta.url)

const mcp = () => plugin.peer("mcp")?.exports as { cloudFetch: Relay; cloudStatus: () => { handle: string | null; connectUrl: string } } | undefined
const relay: Relay = (route, init) => {
  const m = mcp()
  if (!m) throw new OpError("Publish needs the MCP plugin, which keeps this machine's Vaultite Cloud sign-in", 409)
  return m.cloudFetch(route, init)
}
const signedIn = () => !!mcp()?.cloudStatus().handle

/** The published notes and folders as data.json lists them (vault paths, notes without .md). */
const items = (): string[] => { const v = plugin.settings().published; return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : [] }
const source = () => plugin.vault as unknown as Source

plugin.state(() => ({ publish: { items: items(), notes: notesOf(source(), items()) } }))

/** An OpError for what went wrong talking to Vaultite Cloud. */
function failed(e: unknown): never {
  if (e instanceof OpError) throw e
  if (e instanceof PublishError) throw new OpError(e.message, e.status)
  const status = (e as { status?: number }).status
  if (status === 401) throw new OpError((e as Error).message, 401)
  throw new OpError(`Couldn't reach Vaultite Cloud: ${(e as Error).message}`, 502)
}

/** A note or folder of the vault as data.json keeps it, from a path or a note's name. */
function itemOf(ctx: OpCtx, raw: unknown): { item: string; folder: boolean } {
  const p = String(raw ?? "").trim().replace(/^\/+|\/+$/g, "")
  if (!p) throw new OpError("say which note or folder")
  const v = ctx.vault
  if (v.entries.has(p)) return { item: p.replace(/\.md$/i, ""), folder: false }
  if (v.entries.has(`${p}.md`)) return { item: p, folder: false }
  if (v.folders.includes(p)) return { item: p, folder: true }
  const hit = v.resolveLink(p)
  if (hit && /\.md$/i.test(hit)) return { item: hit.replace(/\.md$/i, ""), folder: false }
  throw new OpError(`no note or folder '${p}'`, 404)
}

async function save(ctx: OpCtx, next: string[]) {
  await ctx.vault.lock(() => plugin.saveSettings({ ...plugin.settings(), published: [...new Set(next)] }))
}

const publishNow = (ctx: OpCtx) => push(relay, collect(ctx.vault as unknown as Source, items()))

type Changed = { item: string; folder: boolean; url: string | null; pushed: Pushed | null; error?: string }
const pageUrl = (r: { url?: string | null }, slug?: string) => (r.url && slug ? `${r.url}/${slug}` : r.url ?? null)

plugin.op({
  id: "publish.list",
  cli: "publish",
  mcp: true,
  summary: "What's published on the user's Vaultite Cloud site: each note's public address, and whether it has changes not yet sent.",
  help: `Publish puts chosen notes and folders on the web, rendered as pages with links between them and their images. Its
site is at https://publish.vaultite.app/<handle>; it needs a Publish plan on Vaultite Cloud (bought in a browser).

  vau publish`,
  kind: "read",
  lock: false,
  run: async (_p, ctx) => {
    const set = collect(ctx.vault as unknown as Source, items())
    let now: Remote | null = null, error = ""
    if (!signedIn()) error = "This machine isn't signed in to Vaultite Cloud (vau cloud)"
    else try { now = await remote(relay) } catch (e) { error = (e as Error).message }
    const hashes = new Map(now?.pages.map((p) => [p.slug, p.hash]) ?? [])
    return {
      url: now?.url ?? null, entitled: now?.entitled ?? null, billing: now?.billing ?? null, items: items(), warnings: set.warnings,
      ...(error ? { error } : {}),
      pages: set.pages.map((p) => ({ path: p.path, title: p.title, slug: p.slug, url: pageUrl(now ?? {}, p.slug),
        state: !now ? "unknown" : hashes.get(p.slug) === p.hash ? "published" : hashes.has(p.slug) ? "changed" : "new" })),
    }
  },
  text: (r) => {
    const out = [r.url ? `Site: ${r.url}` : "Not on Vaultite Cloud yet."]
    if (r.error) out.push(r.error)
    else if (r.entitled === false) out.push(`Publishing needs a Publish plan: ${r.billing}`)
    if (!r.pages.length) out.push("Nothing is chosen to publish: vau publish add <note or folder>.")
    for (const p of r.pages) out.push(`- ${p.path}: ${p.state === "published" ? p.url : p.state === "unknown" ? "not checked" : p.state === "changed" ? "changed since published" : "not sent yet"}`)
    for (const w of r.warnings) out.push(`- ${w}`)
    return out.join("\n")
  },
})

plugin.op({
  id: "publish.add",
  cli: "publish add",
  summary: "Publish a note or a folder (its notes at any depth) on the user's Vaultite Cloud site, and send the site now.",
  help: `Pages are public: anyone with the address can read them. Links to notes that aren't published read as plain text.

  vau publish add "Garden/Tomatoes"
  vau publish add Garden`,
  kind: "write",
  lock: false,
  params: { path: { type: "string", format: "path", required: true, description: "the note or folder" } },
  args: ["path"],
  run: async ({ path }, ctx): Promise<Changed> => {
    const { item, folder } = itemOf(ctx, path)
    try {
      const now = await remote(relay)
      if (!now.entitled) throw notEntitled(now.billing)
      await save(ctx, [...items(), item])
      const pushed = await publishNow(ctx)
      const slug = folder ? undefined : collect(ctx.vault as unknown as Source, items()).pages.find((p) => p.path === `${item}.md`)?.slug
      return { item, folder, url: pageUrl(pushed, slug), pushed }
    } catch (e) { failed(e) }
  },
  text: (r: Changed) => `Published ${r.item}${r.folder ? " (the folder)" : ""}: ${r.url}`,
})

plugin.op({
  id: "publish.remove",
  cli: "publish remove",
  summary: "Unpublish a note or a folder: its pages come off the user's Vaultite Cloud site now.",
  help: `  vau publish remove "Garden/Tomatoes"`,
  kind: "write",
  lock: false,
  params: { path: { type: "string", format: "path", required: true, description: "the note or folder, as it was published" } },
  args: ["path"],
  run: async ({ path }, ctx): Promise<Changed> => {
    const { item, folder } = itemOf(ctx, path)
    const list = items()
    if (!list.includes(item)) {
      const by = list.find((x) => item.startsWith(`${x}/`))
      throw new OpError(by ? `${item} is published with the folder ${by}: unpublish the folder` : `${item} isn't published`, 409)
    }
    await save(ctx, list.filter((x) => x !== item))
    try { return { item, folder, url: null, pushed: await publishNow(ctx) } } catch (e) {
      return { item, folder, url: null, pushed: null, error: e instanceof Error ? e.message : String(e) }
    }
  },
  text: (r: Changed) => r.error ? `Unpublished ${r.item} here, but the site isn't updated yet: ${r.error}. Try vau publish sync.` : `Unpublished ${r.item}.`,
})

plugin.op({
  id: "publish.sync",
  cli: "publish sync",
  summary: "Send the published notes as they are now to the user's Vaultite Cloud site (changed pages, new images; removed ones go).",
  help: "  vau publish sync",
  kind: "write",
  lock: false,
  run: async (_p, ctx) => { try { return await publishNow(ctx) } catch (e) { failed(e) } },
  text: (r: Pushed) => `Published ${r.pages} page${r.pages === 1 ? "" : "s"} at ${r.url}: ${r.changed} sent, ${r.images} image${r.images === 1 ? "" : "s"}, ${r.removed} removed.`,
})
