// Plugins from elsewhere: install one from a git repository (core/installs.ts), update and uninstall it, and search
// the plugin directory (core/pluginindex.ts).
import fs from "node:fs"
import path from "node:path"
import type { App } from "../app.ts"
import { diff, fetchSource, type Locked, newer, parseSource, place, readLock, releaseNotes, tagOf, unlock } from "../installs.ts"
import { type Op, OpError } from "../ops.ts"
import { localDate, localTime } from "../plugins.ts"
import type { Entry } from "../pluginindex.ts"
import { disclosed, disclosuresOf } from "../pluginmeta.ts"
import { autoUpdates, type Update } from "../updates.ts"
import { compareVersions, tagVersion } from "../version.ts"
import { DIR, digestOf } from "../vaultplugins.ts"
import { type Any, strings } from "./common.ts"

const SOURCE = { type: "string" as const, required: true, description: "owner/name on GitHub (owner/name/folder for one of several in it; with @tag), a git URL, a folder on this machine, or a zip's https address with #sha256=<hex>" }

export function installOps(app: App): Op[] {
  const tiers = () => new Map(app.app.map((p) => [p.id, p.tier]))
  const vaultIds = () => [...app.vaultPlugins.found.keys()]
  const blocked = (id: string, version: string, repos: (string | null)[]) => app.index.blockedWhy(id, version, repos)

  /** Each installed plugin with a newer version: what it would change (files, disclosures), from a fetched copy.
   *  `auto`: only those that update on their own (core/updates.ts), applied, and allowed here when this machine allowed
   *  them before (a version it skips, rolled back from, is left). */
  const updates = async (only: string | null, apply: boolean, force: boolean, auto = false) => {
    const lock = readLock(app.vault)
    const ids = (only ? [only] : Object.keys(lock).sort()).filter((id) => !auto || (lock[id] && autoUpdates(app.vault.config("plugins"), id, lock[id].source)))
    if (only && !lock[only]) throw new OpError(`'${only}' wasn't installed from a repository (${Object.keys(lock).join(", ") || "none was"})`, 404)
    const out: Any[] = []
    for (const id of ids) {
      const l = lock[id] as Locked
      const dir = app.vault.abs(`${DIR}/${id}`)
      let next: Awaited<ReturnType<typeof newer>>
      try { next = await newer(l) } catch (e) { out.push({ id, version: l.version, error: (e as Error).message }); continue }
      if (!next) { out.push({ id, version: l.version, current: true }); continue }
      const src = { ...parseSource(l.source), tag: next.tag }
      if (auto && next.tag && l.skip && tagVersion(next.tag) === l.skip) { out.push({ id, version: l.version, current: true, skipped: l.skip }); continue }
      let f
      try { f = await fetchSource(src, tiers(), vaultIds().filter((x) => x !== id)) } catch (e) {
        out.push({ id, version: l.version, to: next.tag ?? next.commit?.slice(0, 7), error: (e as Error).message, problems: (e as OpError).problems ?? [] })
        continue
      }
      try {
        if (f.id !== id) throw new OpError(`its new version's id is '${f.id}', not '${id}'`, 422)
        let was: Any = {}
        try { was = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) } catch { /* gone: all of it is new */ }
        const changes = diff(dir, f.dir, was, f.manifest)
        // (a newer commit of a repository of several plugins may not touch this one)
        if (!next.tag && !changes.files.length) { out.push({ id, version: l.version, current: true }); continue }
        const edited = fs.existsSync(dir) && digestOf(dir).content !== l.hash
        const row: Any = { id, name: String(f.manifest.name ?? id), version: l.version, to: String(f.manifest.version ?? ""), tag: f.tag, commit: f.commit, files: changes.files,
          disclosures: changes.disclosures, edited, applied: false }
        const why = blocked(id, row.to, [l.repo, typeof f.manifest.repo === "string" ? f.manifest.repo : null])
        if (why) row.error = why
        else if (apply && edited && !force) row.error = "its files were changed here since it was installed: pass force to replace them"
        // (one that says it does more beyond the vault than it did waits for the user, even when it updates on its own)
        else if (auto && changes.disclosures.some((d) => d.startsWith("now"))) row.error = "it says it does more beyond the vault now: update it by hand"
        else if (apply) {
          row.notes = await releaseNotes(src, l.commit, f.commit)
          await app.hold(() => place(app.vault, f, src, { how: auto ? "auto" : "manual", notes: row.notes }))
          // (a folder on this machine is its owner's work in progress: allowed before, it stays allowed)
          if (src.folder && app.vaultPlugins.trust.approval(id)) { app.vaultPlugins.allow(id, { version: row.to, edits: true }); row.allowed = true }
          else if (auto && app.vaultPlugins.trust.approval(id)) { app.vaultPlugins.trust.noEdits(id); app.vaultPlugins.allow(id, { version: row.to }); row.allowed = true }
          else app.vaultPlugins.trust.noEdits(id)
          row.applied = true
        }
        out.push(row)
      } finally {
        f.done()
      }
    }
    if (out.some((r) => r.applied)) await app.syncPlugins()
    if (auto) await app.tellUpdated(out.filter((r) => r.applied))
    return out
  }

  return [{
    id: "plugin.install",
    cli: "plugin install",
    summary: "Install a vault plugin from a git repository (GitHub's owner/name) at its newest version: off until turned on.",
    help: `Fetches a plugin with git (owner/name on GitHub, owner/name/folder for one of several in a repository, whose
tags are then <folder>/v1.2.0, a git URL, or a folder on this machine) at a tag: the newest
version tag when none is given (owner/name@v1.2.0 or --tag for another), its default branch when it has none (then
followed by commit). Checks it like a vault plugin (its manifest, imports, commands; its version must be its tag's;
it needs version and repo), copies it to .vaultite/plugins/<id>/ and records where it came from in
.vaultite/plugins-lock.json. It's off until turned on (\`vau plugin on <id>\`: it runs code on this machine, so ask the
user first, and show them what it says it does: its disclosures).

A plugin that isn't in a repository can come as a zip from an https address, pinned by its hash after it
(#sha256=<64 hex digits>, refused if the download differs): the plugin's files at its top or in its one folder. Its
address is recorded without its query (a short-lived signed one isn't kept); it has no updates: a newer version is
another address.

  vau plugin install alice/lighthouse
  vau plugin install alice/lighthouse@v1.2.0
  vau plugin install alice/plugins/lighthouse
  vau plugin install ~/code/lighthouse
  vau plugin install "https://example.com/lighthouse-1.2.0.zip#sha256=<hex>"`,
    kind: "write",
    owner: "installing a plugin",
    lock: false, // (fetching waits on the network: it writes only at the end)
    params: { source: SOURCE, tag: { type: "string", description: "the tag to install (else the newest version tag)" } },
    args: ["source"],
    run: async ({ source, tag }) => {
      const src = parseSource(source, tag)
      const f = await fetchSource(src, tiers(), vaultIds())
      try {
        const version = String(f.manifest.version ?? "")
        const why = blocked(f.id, version, [src.repo, typeof f.manifest.repo === "string" ? f.manifest.repo : null])
        if (why) throw new OpError(why, 409)
        const lock = readLock(app.vault)
        // (a folder with only its settings, data.json, is kept for it: one of the app's plugins that became an install)
        if (fs.existsSync(app.vault.abs(`${DIR}/${f.id}/manifest.json`))) {
          throw new OpError(lock[f.id] ? `${f.id} is installed already (${lock[f.id].version}): vau plugin update ${f.id}`
            : `there's a vault plugin '${f.id}' already, made here: rename or remove it first`, 409)
        }
        const entry = await app.hold(() => place(app.vault, f, src))
        app.vaultPlugins.trust.noEdits(f.id)
        await app.syncPlugins()
        return { id: f.id, name: String(f.manifest.name ?? f.id), version, tag: f.tag, commit: f.commit, untagged: f.untagged, folder: `${DIR}/${f.id}`,
          disclosures: disclosuresOf(f.manifest), source: entry }
      } finally {
        f.done()
      }
    },
    text: (r) => [`Installed ${r.name} ${r.version} in ${r.folder}/${r.tag ? ` (${r.tag})` : r.commit ? ` (commit ${r.commit.slice(0, 7)})` : ""}.`,
      ...(r.untagged ? ["It has no version tags: it's the default branch as it is now (updates follow its commits)."] : []),
      ...disclosed(r.disclosures).map((d) => `It says it ${d}.`),
      `It's off until turned on (it runs code on this machine: ask the user first): vau plugin on ${r.id}`].join("\n"),
  }, {
    id: "plugin.update",
    cli: "plugin update",
    summary: "Check installed plugins for newer versions and what they'd change; --apply installs them (to be allowed again).",
    help: `For each plugin installed from a repository (or the one named), asks its repository for a newer version tag
(or, installed without tags, a newer commit), fetches it and says what would change: its version, its files, and what
it says it does beyond the vault. Nothing changes without --apply; applied, its files are replaced (its settings
kept), what's new in it (its commits since) is kept in its history (vau plugin history), and since its code changed it
waits to be allowed on this machine again (vau plugin allow <id>). A plugin whose files were edited here since it was
installed is only replaced with --force. One installed from a folder on this machine takes that folder's files as they
are now, and, allowed before, keeps running: a plugin's author edits, then --apply.

Plugins update on their own too (--auto, what the server does every hour on one machine): those plugins.json's
\`updates\` covers ("vaultite", the default: Vaultite's own; "all"; "off"; a plugin's own choice in \`updatesOn\` and
\`updatesOff\`), applied and allowed on every machine that allowed them before, with a notification. Not one edited
here, one that says it does more beyond the vault than it did, nor a version rolled back from.

  vau plugin update
  vau plugin update lighthouse --apply`,
    kind: "write",
    owner: "updating a plugin",
    lock: false,
    params: {
      id: { type: "string", description: "one installed plugin (else all of them)" },
      apply: { type: "boolean", description: "install the newer versions (else only say what they'd change)" },
      force: { type: "boolean", description: "with apply: replace files edited here since it was installed" },
      auto: { type: "boolean", description: "only those that update on their own, applied and allowed (what the hourly check does)" },
    },
    args: ["id"],
    run: ({ id, apply, force, auto }) => updates(id ?? null, !!apply || !!auto, !!force && !auto, !!auto),
    text: (rows: Any[]) => {
      if (!rows.length) return "No plugin was installed from a repository."
      return rows.map((r) => {
        if (r.current) return `${r.id} ${r.version}: up to date${r.skipped ? ` (skipping ${r.skipped}, rolled back from)` : ""}.`
        const head = `${r.id} ${r.version} -> ${r.to}${r.tag ? ` (${r.tag})` : ""}`
        if (r.error) return `${head}: ${r.error}${r.problems?.length ? "\n" + r.problems.map((p: string) => `  - ${p}`).join("\n") : ""}`
        const lines = [`${head}${!r.applied ? "" : r.allowed ? ": installed, and running" : ": installed. It waits to be allowed on this machine again: vau plugin allow " + r.id}`,
          ...(r.notes ?? []).map((n: string) => `  new: ${n}`),
          ...(r.edited && !r.applied ? ["  its files were changed here since it was installed (--force replaces them)"] : []),
          ...r.disclosures.map((d: string) => `  ${d}`), ...r.files.slice(0, 30).map((f: string) => `  ${f}`), ...(r.files.length > 30 ? [`  and ${r.files.length - 30} more`] : [])]
        return lines.join("\n")
      }).join("\n") + (rows.some((r) => !r.current && !r.error && !r.applied) ? "\nvau plugin update <id> --apply installs one (ask the user first)." : "")
    },
  }, {
    id: "plugin.rollback",
    cli: "plugin rollback",
    summary: "Put an installed plugin back to the version it had before its last update; it doesn't update to that one on its own again.",
    help: `Installs the version a plugin had before its last update (by its version tag), keeps its settings, and
records it in its history. Updating on its own then skips the version rolled back from (a newer one is taken); an
update by hand takes it. Allowed on this machine if it was before.

  vau plugin rollback lighthouse`,
    kind: "write",
    owner: "updating a plugin",
    lock: false,
    params: { id: { type: "string", required: true, description: "the installed plugin" } },
    args: ["id"],
    run: async ({ id }) => {
      const l = readLock(app.vault)[id]
      if (!l) throw new OpError(`'${id}' wasn't installed from a repository`, 404)
      const last = l.history?.at(-1)
      if (!last || last.to !== l.version) throw new OpError(`${id} ${l.version} hasn't been updated since it was installed: no version before it to go back to`, 409)
      if (last.how === "rollback") throw new OpError(`${id} was just rolled back to ${l.version}: update it to go forward again`, 409)
      const src = parseSource(l.source)
      const tag = await tagOf(src, last.from)
      if (!tag) throw new OpError(`${src.repo ?? l.source} has no tag for ${id} ${last.from} to go back to`, 404)
      const f = await fetchSource({ ...src, tag }, tiers(), vaultIds().filter((x) => x !== id))
      try {
        if (f.id !== id) throw new OpError(`its version ${last.from} is '${f.id}', not '${id}'`, 422)
        await app.hold(() => place(app.vault, f, src, { how: "rollback", notes: [], skip: l.version }))
        const allowed = !!app.vaultPlugins.trust.approval(id)
        if (allowed) { app.vaultPlugins.trust.noEdits(id); app.vaultPlugins.allow(id, { version: last.from }) }
        await app.syncPlugins()
        return { id, name: String(f.manifest.name ?? id), from: l.version, to: last.from, tag, allowed }
      } finally {
        f.done()
      }
    },
    text: (r) => `${r.name} is back to ${r.to} (${r.tag})${r.allowed ? ", and running" : ""}. It won't update to ${r.from} on its own again.`,
  }, {
    id: "plugin.history",
    cli: "plugin history",
    summary: "What updated the installed plugins: each update's versions, when, how (on its own, by hand, rolled back) and what's new.",
    help: `Every update of the plugins installed from a repository, newest first, as their lock entries keep them
(.vaultite/plugins-lock.json \`history\`): what's new is the commits' subjects since the version it replaced.

  vau plugin history
  vau plugin history lighthouse
  vau plugin history --since 2026-10-01`,
    kind: "read",
    params: {
      id: { type: "string", description: "one installed plugin (else all of them)" },
      since: { type: "string", description: "only updates on or after this date (YYYY-MM-DD)" },
    },
    args: ["id"],
    run: ({ id, since }) => {
      const lock = readLock(app.vault)
      if (id && !lock[id]) throw new OpError(`'${id}' wasn't installed from a repository`, 404)
      const name = (x: string) => { const m = app.vaultPlugins.found.get(x)?.manifest; return typeof m?.name === "string" && m.name ? m.name : x }
      return Object.entries(lock).filter(([x]) => !id || x === id)
        .flatMap(([x, l]) => (l.history ?? []).map((u: Update) => ({ id: x, name: name(x), ...u })))
        .filter((u) => !since || localDate(Date.parse(u.at)) >= since)
        .sort((a, b) => b.at.localeCompare(a.at))
    },
    text: (rows: Any[]) => rows.length ? rows.map((u) => `- ${localDate(Date.parse(u.at))} ${localTime(Date.parse(u.at))} ${u.name} ${u.from} -> ${u.to}` +
      ` (${u.how === "auto" ? "on its own" : u.how === "rollback" ? "rolled back" : "by hand"})${u.notes.map((n: string) => `\n  ${n}`).join("")}`).join("\n")
      : "No plugin has been updated yet.",
  }, {
    id: "plugin.uninstall",
    cli: "plugin uninstall",
    summary: "Remove a vault plugin: turned off, its folder to the trash, its lock entry and this machine's approval gone.",
    help: `Turns a vault plugin off, moves .vaultite/plugins/<id>/ (its settings too) to the vault's .trash, and forgets
where it came from (.vaultite/plugins-lock.json) and that this machine allowed it.

  vau plugin uninstall lighthouse`,
    kind: "destructive",
    owner: "removing a plugin",
    params: { id: { type: "string", required: true, description: "the vault plugin's id" } },
    args: ["id"],
    run: async ({ id }) => {
      const rel = `${DIR}/${id}`
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !fs.existsSync(app.vault.abs(rel)) || !app.vaultPlugins.found.has(id)) throw new OpError(`there's no vault plugin '${id}'`, 404)
      const enabled = strings(app.vault.config("plugins").enabled)
      if (enabled.includes(id)) app.vault.patchConfig("plugins", { enabled: enabled.filter((x) => x !== id) })
      const to = app.vault.toTrash(rel)
      unlock(app.vault, id)
      app.vaultPlugins.trust.forget(id)
      await app.syncPlugins()
      return { id, trashed: to }
    },
    text: (r) => `Removed ${r.id}: its folder is in ${r.trashed}.`,
  }, {
    id: "plugin.search",
    cli: "plugin search",
    summary: "Search the plugin directory (GitHub repos with the topic vaultite-plugin): stars, version, what each discloses.",
    help: `Reads the plugin directory's index (plugins.json's \`index\`, else Vaultite's; fetched at most once an hour,
cached in .vaultite/cache/) and lists its plugins matching the words given, by stars (or newest, or last updated),
with what each says it does beyond the vault, and whether it's installed here (and an update is out). Install one
with \`vau plugin install <source>\` (its repository, and its folder in it when it has several).

  vau plugin search
  vau plugin search habits --sort updated`,
    kind: "read",
    params: {
      q: { type: "string", description: "words to look for in names, descriptions, authors and topics" },
      sort: { type: "string", enum: ["stars", "new", "updated"], default: "stars", description: "by stars, newest, or last updated" },
      refresh: { type: "boolean", description: "fetch the index again now" },
    },
    args: ["q"],
    run: async ({ q, sort, refresh }) => {
      const got = await app.index.get(!!refresh)
      const lock = readLock(app.vault)
      const words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean)
      const time = (e: Entry) => Date.parse(e.released ?? e.pushed ?? "") || 0
      const plugins = got.index.plugins
        .filter((e) => words.every((w) => `${e.id} ${e.name} ${e.description} ${e.author} ${e.topics.join(" ")}`.toLowerCase().includes(w)))
        .sort((a, b) => sort === "new" ? (Date.parse(b.created ?? "") || 0) - (Date.parse(a.created ?? "") || 0)
          : sort === "updated" ? time(b) - time(a) : b.stars - a.stars || b.score - a.score)
        .map((e) => {
          const here = app.vaultPlugins.found.get(e.id)
          const installed = here ? String(here.manifest.version ?? "") || null : null
          const ours = !!here && (lock[e.id]?.repo ?? here.manifest.repo ?? "").toString().toLowerCase() === e.repo.toLowerCase()
          return { ...e, source: e.dir ? `${e.repo}/${e.dir}` : e.repo, installed: here ? installed ?? "" : null, ours, update: ours && !!installed && compareVersions(e.version, installed)! > 0,
            blocked: app.index.blockedWhy(e.id, e.version, [e.repo]) }
        })
      return { url: got.url, available: got.available, fetched: got.fetched, ...(got.error ? { error: got.error } : {}), plugins }
    },
    text: (r) => {
      if (!r.available) return `The plugin directory can't be read now (${r.url}${r.error ? `: ${r.error}` : ""}).`
      if (!r.plugins.length) return "No plugins match."
      return r.plugins.map((e: Any) => `- ${e.name} (${e.source}) ${e.version}, ${e.stars} stars${e.released ? `, released ${e.released.slice(0, 10)}` : ""}` +
        `${e.installed !== null ? (e.update ? `, installed ${e.installed} (update out)` : ", installed") : ""}${e.blocked ? ", blocked" : ""}: ${e.description}` +
        (disclosed(e.disclosures).length ? `\n  says it ${disclosed(e.disclosures).join("; ")}` : "")).join("\n")
    },
  }]
}
