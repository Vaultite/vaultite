import { z } from "zod"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, app, check, exists, read, vault, write } = $
  {
    // The desktop app's own windows (electron/apppermissions.ts): what each page may do in the browser engine.
    const { permissionFor, whose } = await import("../../../electron/apppermissions.ts")
    const remotes = ["https://studio.tail1234.ts.net:8447"], dist = "/App/web/dist"
    const at = (u: string, perm: string) => permissionFor(perm, whose(u, remotes, dist, [8793]))
    check("desktop permissions: the app's page gets the microphone and pasting, another machine's asks, anyone else's nothing",
      at("http://127.0.0.1:8793/", "media") === "allow" && at("http://127.0.0.1:8793/", "clipboard-read") === "allow" && at("file:///App/web/dist/onboarding.html", "clipboard-sanitized-write") === "allow" &&
      at("https://studio.tail1234.ts.net:8447/", "media") === "ask" && at("https://studio.tail1234.ts.net:8447/", "geolocation") === "ask" && at("https://studio.tail1234.ts.net:8447/", "notifications") === "allow" &&
      at("https://evil.example/", "media") === "deny" && at("https://www.youtube.com/embed/x", "clipboard-read") === "deny" && at("https://www.youtube.com/embed/x", "fullscreen") === "allow" && at("file:///Users/a/x.html", "media") === "deny" &&
      at("http://127.0.0.1:8793/", "display-capture") === "deny" && at("http://127.0.0.1:8793/", "hid") === "deny" && at("https://studio.tail1234.ts.net:8447.evil.example/", "media") === "deny")
    check("desktop permissions: another program's page on this machine is anyone's, not the app's",
      at("http://127.0.0.1:3000/", "media") === "deny" && at("http://localhost:5000/", "clipboard-read") === "deny" && at("http://localhost:8793/", "media") === "allow")
    // What agents get of a page (electron/browser/axlines.ts, plugins/core/web-viewer/find.ts): a control that changed once,
    // new lines before gone ones; a new page's content without its navigation; a tree's lines with a word, and what holds them.
    const { changes, mainLines, oneLineLists, saysPending } = await import("../../../electron/browser/axlines.ts")
    const { within } = await import("../../../plugins/core/web-viewer/find.ts")
    const diff = changes(["- textbox \"Email\" [ref=e2]: old", "- text \"Saving\"", "- button \"Save\" [ref=e3]"], ["- textbox \"Email\" [ref=e2]: new", "  - button \"Save\" [ref=e3]", "- status \"Saved\""])
    check("browser agents: an act's diff says a control changed once, new lines first, a moved line not at all",
      JSON.stringify(diff) === JSON.stringify(["~ textbox \"Email\" [ref=e2]: new", "+ status \"Saved\"", "- text \"Saving\""]), diff)
    const page = ["- RootWebArea \"Shop\" [ref=e1]", "  - navigation \"Site\"", "    - link \"Home\" [ref=e2]", "  - heading \"Orders\"", "  - contentinfo", "    - link \"Terms\" [ref=e3]"]
    const withMain = ["- RootWebArea \"Shop\" [ref=e1]", "  - banner", "    - link \"Home\" [ref=e2]", "  - main", "    - heading \"Orders\"", "    - row: \"A-1\" | \"$5\""]
    check("browser agents: a new page's content is its main part, else the page without navigation, header and footer",
      JSON.stringify(mainLines(withMain)) === JSON.stringify(["- heading \"Orders\"", "- row: \"A-1\" | \"$5\""]) && JSON.stringify(mainLines(page)) === JSON.stringify(["- heading \"Orders\""]), [mainLines(withMain), mainLines(page)])
    const oneLine = ["- RootWebArea \"Billing\"", "  - navigation", "    - link \"Home\" [ref=e1]", "  - main: heading \"Billing\" | \"Balance: $0.00\""]
    const footed = ["- main", "  - heading \"Inbox\"", "  - sectionfooter: link \"Terms\" [ref=e2]", "  - article", "    - sectionfooter: \"Sent by Ben\""]
    check("browser agents: a main of one line is the content, and the main's own footer is left out (an article's stays)",
      JSON.stringify(mainLines(oneLine)) === JSON.stringify(["- main: heading \"Billing\" | \"Balance: $0.00\""])
        && JSON.stringify(mainLines(footed)) === JSON.stringify(["- heading \"Inbox\"", "- article", "  - sectionfooter: \"Sent by Ben\""]), [mainLines(oneLine), mainLines(footed)])
    const form = ["- form", "  - combobox \"Plan\" [ref=e1]: Pro", "    - option \"Free\" [ref=e2]", "    - option \"Pro\" [ref=e3] [selected]", "  - combobox \"Size\" [ref=e4]: S",
      "    - option \"S\" [ref=e5] [selected]", "    - … 20 more options", "  - combobox \"Search\" [ref=e6]", "    - listbox", "      - option \"Recent\" [ref=e7]", "  - button \"Go\" [ref=e8]"]
    check("browser agents: a <select>'s options are one line of names, a custom combobox's stay to click",
      JSON.stringify(oneLineLists(form)) === JSON.stringify(["- form", "  - combobox \"Plan\" [ref=e1]: Pro", "    - options: \"Free\" | \"Pro\"", "  - combobox \"Size\" [ref=e4]: S",
        "    - options: \"S\" | … 20 more", ...form.slice(7)]), oneLineLists(form))
    check("browser agents: an act waits on a line saying the page is still at it, not on other text with an ellipsis",
      ["+ text \"Saving…\"", "- main: heading \"Billing\" | \"Loading usage...\"", "- status: \"Uploading 2 files…\""].every(saysPending)
        && !["- link \"Read more…\" [ref=e4]", "- text \"And then...\"", "- button \"Loading dock\" [ref=e5]", `- text "${"so much text before it ".repeat(4)}loading…"`].some(saysPending))
    const { anywhere, HAS } = await import("../../../electron/browser/historyrows.ts")
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(":memory:")
    db.exec("CREATE TABLE u (url TEXT)")
    for (const u of ["https://GitHub.com/a", "https://shop.test/50%_off", "https://shop.test/50xxoff", "https://a.test/x\\y"]) db.prepare("INSERT INTO u VALUES (?)").run(u)
    const like = (w: string) => db.prepare(`SELECT url FROM u WHERE ${HAS("url")}`).all(anywhere(w)).map((r) => String(r.url))
    check("browser history: a word is found anywhere in any ASCII case, and %, _ and \\ in it are only themselves",
      JSON.stringify([like("github"), like("50%_"), like("x\\y")]) === JSON.stringify([["https://GitHub.com/a"], ["https://shop.test/50%_off"], ["https://a.test/x\\y"]]), [like("github"), like("50%_"), like("x\\y")])
    const tree = ["- main", "  - form \"Settings\"", "    - textbox \"Email\" [ref=e2]", "    - button \"Save settings\" [ref=e3]", "  - link \"Help\" [ref=e4]"].join("\n")
    check("browser agents: snapshot --find keeps the lines with it and what they're in",
      within(tree, "save") === ["- main", "  - form \"Settings\"", "    - button \"Save settings\" [ref=e3]"].join("\n") && within(tree, "/e[24]\\]/") === ["- main", "  - form \"Settings\"", "    - textbox \"Email\" [ref=e2]", "  - link \"Help\" [ref=e4]"].join("\n"), within(tree, "save"))
    // An extension's offscreen document (electron/browser/extapi.ts) is one of its own pages, as in Chrome.
    const { extensionPage } = await import("../../../electron/browser/crx.ts")
    const id = "abcdefghijklmnopabcdefghijklmnop"
    check("extensions: an offscreen document is only the extension's own page",
      extensionPage(id, "offscreen.html") === `chrome-extension://${id}/offscreen.html` && extensionPage(id, "/a/b.html?x=1") === `chrome-extension://${id}/a/b.html?x=1` &&
      extensionPage(id, `chrome-extension://${id}/o.html`) === `chrome-extension://${id}/o.html` && extensionPage(id, "https://example.com/") === null &&
      extensionPage(id, "//example.com/x") === null && extensionPage(id, `chrome-extension://${"b".repeat(32)}/o.html`) === null &&
      extensionPage(id, `chrome-extension://${id}@example.com/`) === null && extensionPage(id, "file:///etc/hosts") === null && extensionPage(id, "javascript:alert(1)") === null,
      [extensionPage(id, "//example.com/x"), extensionPage(id, "https://example.com/")])
  }
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

  {
    const wv = (await import("../../../plugins/core/web-viewer/plugin.ts")).plugin, was = wv.desktopWaiting
    wv.desktopWaiting = async (_ms: number, name: string) => {
      if (name !== "agent:sites") throw new Error("no such call")
      return [{ container: "agents", access: "act", home: true, sites: [{ site: "cloudflare.com", account: "alice@example.com" }, { site: "google.com", with: ["youtube.com"] }] },
        { container: "work", access: "read", home: false, sites: [{ site: "github.com", account: "alicepark" }] }]
    }
    try {
      const sites = async (params: { site?: string }) => { const r = await app.runOp("web-viewer.sites", params); return { text: String(r.op.text?.(r.result, r.params)), result: z.array(z.object({ container: z.string() })).parse(r.result) } }
      const all = await sites({}), one = await sites({ site: "https://www.youtube.com/feed" }), none = await sites({ site: "example.org" })
      check("browser sites: each container agents may use, its signed-in sites and accounts, the one open uses first",
        all.text.includes("--container agents") && all.text.includes("cloudflare.com  as alice@example.com") && all.text.includes("google.com (with youtube.com)") &&
        all.text.includes("read only") && all.text.indexOf("cloudflare.com") < all.text.indexOf("github.com"), all.text)
      check("browser sites: a site asked for by any address finds the login that covers it, else says none",
        JSON.stringify(one.result.map((c) => c.container)) === '["agents"]' && /no site that matches/.test(none.text), [one, none])
    } finally { wv.desktopWaiting = was }
  }

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
  ;[, r] = await api("GET", `file?path=${SITES}/youtube.com.css`)
  check("… which opens by its path, as Edit its style does, with hidden files off", r.text === "html { background: var(--vault-background) }\n", r)
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

  // The live view (liveroutes.ts): the owner's only, the desktop app's engine asked, a tab's steps the engine's.
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
    const was = wv.desktopWaiting
    wv.desktopWaiting = async (_ms: number, name: string, ...args: unknown[]) => {
      asked.push([name, ...args])
      if (name === "agent:act") return { tab: args[0], url: "https://example.com/", title: "Example", navigated: false }
      if (name === "agent:live:tabs") return [{ tab: 3, url: "https://example.com/", title: "Example" }]
      if (name === "agent:live:steps") return []
      return { tab: args[0] }
    }
    try {
      ;[code, body] = await api("GET", "web-viewer/tabs")
      check("live view: the owner gets the engine's tabs", code === 200 && body.tabs[0]?.tab === 3, [code, body])
      ;[code] = await api("POST", "web-viewer/tabs/3/pause", { on: false })
      check("… resuming agents asks the engine so", code === 200 && JSON.stringify(asked.at(-1)) === JSON.stringify(["agent:live:pause", 3, false]), asked.at(-1))
      ;[code] = await api("POST", "web-viewer/tabs/x/done", {})
      check("… a tab is its number", code === 400, code)
      ;[code] = await api("POST", "web-viewer/tabs/3/done", { cant: true, note: "No access to that inbox" })
      check("… I can't goes to the engine with its reason", code === 200 && JSON.stringify(asked.at(-1)) === JSON.stringify(["agent:live:done", 3, { cant: true, note: "No access to that inbox" }]), asked.at(-1))
      let steps: Any
      ;[code, steps] = await api("GET", "web-viewer/tabs/3/steps?since=5")
      check("live view: a tab's steps are the engine's, asked since when", code === 200 && JSON.stringify(asked.at(-1)) === JSON.stringify(["agent:live:steps", 3, 5]), [code, steps, asked.at(-1)])
    } finally { wv.desktopWaiting = was }
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
