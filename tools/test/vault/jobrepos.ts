import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { VaultTest } from "./harness.ts"
import { gitEnv } from "../../../core/gitenv.ts"
import * as W from "../../../plugins/core/companion/where.ts"
import { siteOf, siteRepo } from "../../../plugins/core/companion/jobplace.ts"
import { checkoutsText } from "../../../plugins/core/companion/jobhandoff.ts"
import { checkoutCards } from "../../../plugins/core/companion/checkouts.ts"

export default async ($: VaultTest) => {
  const { check } = $
  const all = (xs: unknown[]) => xs.every(Boolean)
  check("where: the routes a deploy names cover an address by host, wildcard and path, most closely", all([
    W.routeCovers("harbor.example/api/*", new URL("https://harbor.example/api/x")) > W.routeCovers("harbor.example", new URL("https://harbor.example/api/x")),
    W.routeCovers("*.harbor.example/*", new URL("https://a.harbor.example/")) > 0, !W.routeCovers("*.harbor.example/*", new URL("https://harbor.example/")),
    !W.routeCovers("harbor.example/api/*", new URL("https://harbor.example/")), !W.routeCovers("harbor.examples", new URL("https://harbor.example/"))]))
  check("handoff: a site is a repo's project's own when its host holds the repo's name", all([siteOf(new URL("https://harbor.example/"), "lighthouse/harbor"),
    siteOf(new URL("https://docs.harbor.example/"), "harbor"), siteOf(new URL("https://harbor-notes.example/"), "harbornotes"), !siteOf(new URL("https://harbors.example/"), "harbor"),
    !siteOf(new URL("https://news.example.org/"), "harbor")]))

  const card = (repo: string, title: string, what: string, deploys: string[] = []) => ({ repo, dir: `~/Projects/${repo.split("/")[1]}`, title, what, deploys })
  const app = card("lighthouse/beacon", "Beacon", "A reading app for long articles, offline."), web = card("lighthouse/beacon-web", "beacon-web", "The landing page and docs.", ["beacon.example", "www.beacon.example"])
  const cloud = card("lighthouse/beacon-cloud", "Beacon Cloud", "Sync for Beacon's readers.", ["beacon.app", "*.beacon.app", "beacon.example/updates"])
  const cards = [app, web, cloud, { ...web, label: "Studio" }], none = { repo: "", why: "" }
  const to = (words: string, repo: string, cs: Parameters<typeof siteRepo>[2] = cards) => siteRepo(words, repo, cs) ?? none
  const site = to("an idea for the Beacon website… render the reader view in full glass", "beacon"), dom = to("put a banner on beacon.app", "lighthouse/beacon")
  check("handoff: an ask about a product's website, the app's repo named, goes to the checkout deploying the site, saying why; a domain they name, to the one deploying it", all([
    site.repo === "lighthouse/beacon-web", site.why === "their ask is about the website, and beacon deploys none: lighthouse/beacon-web is beacon's site (it deploys beacon.example)",
    dom.repo === "lighthouse/beacon-cloud", dom.why === "their ask names beacon.app, which lighthouse/beacon-cloud (Beacon Cloud) deploys, not lighthouse/beacon"]), [site, dom])
  const readme = card("lighthouse/beacon-site", "beacon-site", "Website for Beacon at https://beacon.example (and www).")
  check("handoff: a site's repo is known by its README too (one deploying it first); asks not about a site, the named repo deploying one, or two sites alike keep the repo named", all([
    to("the Beacon site's footer is too tall", "beacon", [app, readme]).repo === "lighthouse/beacon-site", to("put it on beacon.example", "beacon", [app, readme]).repo === "lighthouse/beacon-site",
    to("the website's hero", "beacon", [app, web, readme]).repo === "lighthouse/beacon-web", to("the reader's sidebar jumps", "beacon") === none,
    to("the website's hero", "beacon-web") === none, to("put it on beacon.example", "beacon-web") === none,
    to("the website's hero", "beacon", [app, web, card("lighthouse/beacon-www", "beacon-www", "The landing page, redone.", ["beacon.example/*"])]) === none]))

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobrepos-")), root = path.join(tmp, "Projects")
  const make = (name: string, slug: string, files: Record<string, string>) => {
    const dir = path.join(root, name), g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd: dir, stdio: "pipe", env: gitEnv() })
    for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t) }
    g("init", "-q"); g("remote", "add", "origin", `git@github.com:${slug}.git`); g("add", "."); g("commit", "-qm", "first")
    return g
  }
  try {
    make("beacon", "lighthouse/beacon", { "README.md": '<h1 align="center"><img src="icon.png"><br>Beacon</h1>\n\n<p><b>Read later, offline.</b> A reading app for long articles.</p>\n',
      "package.json": JSON.stringify({ name: "beacon", homepage: "https://beacon.example" }) })
    const g = make("beacon-web", "lighthouse/beacon-web", { "README.md": "# beacon-web\n\nWebsite for Beacon at https://beacon.example,\nbuilt with Vite.\n\n## Deploy\n", "wrangler.toml": 'routes = [{ pattern = "beacon.example", custom_domain = true }]\n' })
    g("worktree", "add", "-q", path.join(root, "beacon-web-j1"), "-b", "j1")
    const found = checkoutCards([root]), listed = checkoutsText(found.map((c) => ({ ...c, label: "" })))
    check("checkouts: each repo once (its worktrees aside), with its README's title and first lines and the sites it deploys, never an app's homepage", all([
      found.length === 2, listed.includes("- lighthouse/beacon: Beacon: Read later, offline. A reading app for long articles. (on here)"),
      listed.includes("- lighthouse/beacon-web: beacon-web: Website for Beacon at https://beacon.example, built with Vite.; deploys beacon.example (on here)"),
      to("an idea for the Beacon website", "beacon", found).repo === "lighthouse/beacon-web"]), { n: found.length, dirs: found.map((c) => c.dir), listed })
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}
