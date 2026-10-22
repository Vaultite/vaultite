import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, exists, read, vault, write } = $
  // The Browser's files in .vaultite: the blocked elements list (the note it was, moved there once) and each site's
  // style; their ops, and what the app gets of them in /api/state.
  const LIST = ".vaultite/plugins/web-viewer/blocked-elements.md", SITES = ".vaultite/plugins/web-viewer/sites"
  const { DONE, migrate } = await import("../../../core/migrations.ts")
  write("Blocked elements.md", "---\ntype: blocked-elements\n---\n\n## youtube.com\n\n- `youtube.com##ytd-reel-shelf-renderer` Shorts\n")
  vault.patchConfig("migrations", { done: DONE.filter((d) => d !== "blocked-elements-2026-10") })
  await migrate(vault, false)
  check("the blocked elements note moves into the Browser's list, as it was, the note to the trash",
    !exists("Blocked elements.md") && read(LIST) === "## youtube.com\n\n- `youtube.com##ytd-reel-shelf-renderer` Shorts\n", exists(LIST) ? read(LIST) : null)
  await vault.sync()

  let [, r] = await api("POST", "ops/web-viewer.block", { rule: "#related", site: "www.youtube.com" })
  check("browser block adds to the list, under its site", r.added && r.path === LIST && read(LIST).includes("- `youtube.com##ytd-reel-shelf-renderer` Shorts\n- `youtube.com###related`\n"), [r, read(LIST)])
  ;[, r] = await api("POST", "ops/web-viewer.blocked", { site: "youtube.com" })
  check("browser blocked lists them", JSON.stringify(r.rules) === JSON.stringify(["youtube.com##ytd-reel-shelf-renderer", "youtube.com###related"]), r)
  ;[, r] = await api("POST", "ops/web-viewer.unblock", { rule: "youtube.com###related" })
  check("browser unblock takes one out", r.removed && !read(LIST).includes("related"), [r, read(LIST)])

  ;[, r] = await api("POST", "ops/web-viewer.style", { site: "https://www.YouTube.com/watch?v=1" })
  check("browser style of a site without one: none yet, and what a new one starts as", r.site === "youtube.com" && r.css === null && r.template.includes("--vault-background"), r)
  ;[, r] = await api("POST", "ops/web-viewer.style", { site: "youtube.com", css: "html { background: var(--vault-background) }" })
  check("… writes its file", r.written && read(`${SITES}/youtube.com.css`) === "html { background: var(--vault-background) }\n", r)
  const [code] = await api("POST", "ops/web-viewer.style", { site: "not a site" })
  check("… a site it can't be isn't one", code === 400, code)
  write(`${SITES}/notes.txt`, "not a style")
  const [, state] = await api("GET", "state")
  check("the store has the list's rules and each site's style (not other files there)",
    JSON.stringify(state.blockedElements.map((x: { rule: string }) => x.rule)) === JSON.stringify(["youtube.com##ytd-reel-shelf-renderer"])
    && JSON.stringify(state.siteStyles) === JSON.stringify([{ site: "youtube.com", path: `${SITES}/youtube.com.css`, css: "html { background: var(--vault-background) }\n" }]),
    [state.blockedElements, state.siteStyles])
  ;[, r] = await api("POST", "ops/web-viewer.style", {})
  check("browser style alone lists the sites with one", JSON.stringify(r.sites) === JSON.stringify(["youtube.com"]), r)
  ;[, r] = await api("POST", "ops/web-viewer.style", { site: "youtube.com", remove: true })
  check("… and --remove sends one to the trash", r.removed && !exists(`${SITES}/youtube.com.css`), r)
}
