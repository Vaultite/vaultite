import { parseRepo, repoText, webLink } from "../../../core/bundlelinks.ts"
import { fromGitHub } from "../../../web/demo/github.ts"
import { fitForDemo } from "../../../web/demo/machine.ts"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check } = $
  // A bundle's link (core/bundlelinks.ts): what names a repository, and the two links made from it.
  {
    const named = (s: string) => { const r = parseRepo(s); return r && repoText(r) }
    const cases: [string, string | null][] = [
      ["alice/desk", "alice/desk"], ["gh:alice/desk", "alice/desk"], [" alice/desk.git ", "alice/desk"], ["alice/desk@v1.2.0", "alice/desk@v1.2.0"],
      ["alice/kit/bundles/writing", "alice/kit/bundles/writing"], ["https://github.com/alice/desk", "alice/desk"], ["github.com/alice/desk.git/", "alice/desk"],
      ["https://github.com/alice/kit/tree/main/bundles/writing", "alice/kit/bundles/writing"], ["https://vaultite.com/b/alice/desk", "alice/desk"],
      ["www.vaultite.com/b/alice/kit/writing?x=1#top", "alice/kit/writing"], ["vaultite://bundle/alice/desk", "alice/desk"],
      ["alice", null], ["alice/../etc", null], ["alice/desk/..", null], ["alice/de sk", null], ["https://example.com/alice/desk", null], ["", null],
      ["alice/desk.git/folder", null], ["/Users/alice/desk", null],
    ]
    const wrong = cases.filter(([s, want]) => named(s) !== want).map(([s, want]) => ({ s, want, got: named(s) }))
    check("bundle links: owner/name, gh:, github.com, vaultite.com/b and vaultite://bundle all name the repository; nothing else does", !wrong.length, wrong)
    const r = parseRepo("alice/kit/writing@v2.0.0")!
    check("bundle links: the page, without the tag", webLink(r) === "https://vaultite.com/b/alice/kit/writing", webLink(r))
  }

  // The demo's import from GitHub (web/demo/github.ts), over a made-up GitHub: the same files the app's clone takes.
  {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0xff, 0xfe])
    const repo: Record<string, string | Buffer> = {
      "README.md": "# Writing desk\n", "LICENSE": "MIT\n", ".github/workflows/ci.yml": "on: push\n",
      "bundle.json": JSON.stringify({ name: "Writing desk", description: "For writing", author: "Alice Park" }),
      "plugins.json": JSON.stringify({ disabled: ["terminal"], enabled: ["claude-code", "kanban"], install: { kanban: { name: "Kanban", source: "alice/kanban" } } }),
      "pages.json": JSON.stringify({ pinned: ["Desk.md"] }), "Desk.md": "---\ntype: dashboard\n---\n# Desk\n", "Notes.md": "not the bundle's\n",
      "preview.png": PNG, "plugins/word-count/manifest.json": JSON.stringify({ id: "word-count", name: "Word count" }), "plugins/word-count/web.js": "export {}",
    }
    const asked: string[] = []
    const gh = (files: Record<string, string | Buffer>, tags: string[] | null) => async (url: string) => {
      asked.push(url)
      const u = new URL(url)
      if (u.hostname === "api.github.com" && u.pathname.endsWith("/tags")) return tags ? Response.json(tags.map((name) => ({ name }))) : new Response("{}", { status: 404 })
      if (u.hostname === "api.github.com" && u.pathname.includes("/git/trees/")) {
        return Response.json({ tree: Object.entries(files).map(([path, v]) => ({ path, type: "blob", mode: "100644", size: v.length })) })
      }
      const rel = decodeURIComponent(u.pathname.split("/").slice(4).join("/"))
      return rel in files ? new Response(new Uint8Array(Buffer.from(files[rel]))) : new Response("404", { status: 404 })
    }
    const got = await fromGitHub("alice/desk", gh(repo, ["v0.9.0", "v1.10.0", "v1.2.0", "nightly"]))
    const files = Object.keys(got.files).sort().join()
    check("demo import: a bundle's folder at the top, without the repository's own files", files === "Desk.md,bundle.json,pages.json,plugins.json,plugins/word-count/manifest.json,plugins/word-count/web.js,preview.png", files)
    check("demo import: at its newest version tag, its pictures as bytes, where it's from in bundle.json",
      asked.some((u) => u.includes("/git/trees/v1.10.0")) && asked.some((u) => u.startsWith("https://raw.githubusercontent.com/alice/desk/v1.10.0/")) &&
      (got.files["preview.png"] as Any).base64 === PNG.toString("base64") && JSON.parse(got.files["bundle.json"] as string).from === "alice/desk" && got.id === "desk", got)
    asked.length = 0
    await fromGitHub("alice/desk", gh(repo, []))
    check("demo import: no version tag, the default branch", asked.some((u) => u.includes("/git/trees/HEAD")), asked)
    const one = { "README.md": "hi", "desk.bundle.json": JSON.stringify({ vaultite: "bundle", format: 1, id: "desk", files: { "bundle.json": { name: "Desk" } } }) }
    const single = await fromGitHub("alice/one", gh(one, []))
    check("demo import: or one .bundle.json", single.id === "desk" && JSON.parse(single.files["bundle.json"] as string).name === "Desk", single)
    const fails = async (given: string, f: Any, want: RegExp) => { try { await fromGitHub(given, f); return "imported" } catch (e) { return want.test((e as Error).message) ? "" : (e as Error).message } }
    const errors = [
      await fails("alice/gone", gh({}, null), /no public repository alice\/gone/),
      await fails("alice/plain", gh({ "README.md": "hi" }, []), /has no bundle/),
      await fails("alice/kit/nope", gh(repo, []), /has no folder nope/),
      await fails("alice", gh(repo, []), /isn't a bundle's repository/),
      await fails("alice/desk", async () => new Response("{}", { status: 403 }), /too many requests/),
      await fails("alice/desk", async () => { throw new TypeError("offline") }, /couldn't reach GitHub/),
    ].filter(Boolean)
    check("demo import: a repository that's gone, has no bundle, a bad name or GitHub saying wait: each says so", !errors.length, errors)

    const fit = fitForDemo(got.files)
    const pj = JSON.parse(fit.files["plugins.json"] as string)
    check("demo import: plugins it brings or installs are left out (they run code), what needs a machine stays off, what the demo draws made up stays",
      fit.code.join() === "Word count,Kanban" && !Object.keys(fit.files).some((f) => f.startsWith("plugins/word-count/")) && !pj.install &&
      !pj.enabled.includes("kanban") && pj.disabled.includes("terminal") && !pj.disabled.includes("claude-code") &&
      !!fit.plugins.enabled?.includes("claude-code"), fit)
    const [code, r] = await api("POST", "bundles/import", { ...got, files: fit.files })
    check("demo import: what it made imports as a bundle from that repository, not applied", code === 200 && r.bundle.name === "Writing desk" && r.bundle.from === "alice/desk" &&
      r.bundle.author === "Alice Park" && !r.bundle.problems.length && r.bundle.preview, r)
    if (r.bundle?.id) await api("DELETE", `bundles/${r.bundle.id}`)
  }
}
