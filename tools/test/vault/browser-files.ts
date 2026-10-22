import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, app, check, exists, read, sleep, vault, write } = $
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

  // The live view (liveroutes.ts): the owner's only, the desktop app's engine asked, a tab's steps from Activity.
  {
    const stranger = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "127.0.0.1" } } as Any
    let [code] = await api("GET", "web-viewer/tabs", undefined, stranger)
    check("live view: someone else on the tailnet is refused the tabs", code === 403, code)
    ;[code] = await api("POST", "web-viewer/tabs/3/pause", { on: true }, stranger)
    check("… and pausing agents in one", code === 403, code)
    let body: Any
    ;[code, body] = await api("GET", "web-viewer/tabs")
    check("… with no desktop app, says so", code === 409 && /desktop app/.test(body.error), [code, body])
    const { LOADED } = await import("../../../core/plugins.ts")
    const wv = LOADED.find((p) => p.id === "web-viewer")!
    const asked: unknown[][] = []
    const was = wv.desktop
    wv.desktop = async (name: string, ...args: unknown[]) => {
      asked.push([name, ...args])
      if (name === "agent:act") return { tab: args[0], url: "https://example.com/", title: "Example", navigated: false }
      if (name === "agent:live:tabs") return [{ tab: 3, url: "https://example.com/", title: "Example" }]
      return { tab: args[0] }
    }
    try {
      ;[code, body] = await api("GET", "web-viewer/tabs")
      check("live view: the owner gets the engine's tabs", code === 200 && body.tabs[0]?.tab === 3, [code, body])
      ;[code] = await api("POST", "web-viewer/tabs/3/pause", { on: false })
      check("… resuming agents asks the engine so", code === 200 && JSON.stringify(asked.at(-1)) === JSON.stringify(["agent:live:pause", 3, false]), asked.at(-1))
      ;[code] = await api("POST", "web-viewer/tabs/x/done", {})
      check("… a tab is its number", code === 400, code)
      const since = Date.now() - 1
      await app.callOp("web-viewer.act", { tab: 3, action: "click", ref: "e5" }, undefined, { report: "test" })
      await app.callOp("web-viewer.act", { tab: 4, action: "press", key: "Enter" }, undefined, { report: "test" })
      let steps: Any[] = []
      for (let i = 0; i < 20 && !steps.length; i++) { await sleep(100); steps = (await api("GET", `web-viewer/tabs/3/steps?since=${since}`))[1].steps }
      check("live view: a tab's steps are what Activity kept of agents' ops in it, and only its", steps.length === 1 && steps[0].text === "Clicked e5", steps)
    } finally { wv.desktop = was }
    // What the desktop app tells the server unasked reaches who listens (core/desktopapp.ts).
    const { onDesktopEvent } = await import("../../../core/desktopapp.ts")
    const heard: unknown[] = []
    const stop = onDesktopEvent((name, data) => heard.push([name, data]))
    const tell = (data: unknown) => (process.emit as (e: string, m: unknown) => boolean)("message", { type: "desktop:event", name: "live:state", data })
    tell({ tab: 3 })
    stop()
    tell({ tab: 4 })
    check("desktop events reach a listener till it stops", JSON.stringify(heard) === JSON.stringify([["live:state", { tab: 3 }]]), heard)
  }
}
