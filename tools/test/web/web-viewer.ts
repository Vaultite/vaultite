import { check } from "../lib.ts"

// ---------- Browser: what's typed in the address bar (plugins/core/web-viewer/address.ts) ----------
{
  const { addressOf, guessedHttps, hostOf, httpFallback, siteName } = await import("../../../plugins/core/web-viewer/address.ts")
  check("Browser: a group of a site's tabs is named after it, none for this machine", siteName("https://www.github.com/a") === "Github"
    && siteName("https://news.bbc.co.uk/") === "Bbc" && siteName("http://localhost:3000/") === null && siteName("http://192.168.1.2/") === null)
  check("Browser: an address with its scheme as it is", addressOf(" https://example.com/a?b=1#c ") === "https://example.com/a?b=1#c")
  check("Browser: a host gets https", addressOf("example.com/posts") === "https://example.com/posts" && addressOf("sub.example.co.uk") === "https://sub.example.co.uk/")
  check("Browser: this machine and IP addresses get http", addressOf("localhost:3000/x") === "http://localhost:3000/x" && addressOf("127.0.0.1:8080") === "http://127.0.0.1:8080/")
  check("Browser: words are a search", addressOf("open source notes") === "https://duckduckgo.com/?q=open%20source%20notes"
    && addressOf("notes", "https://search.example/?s=%s") === "https://search.example/?s=notes")
  check("Browser: other schemes and nothing are refused", addressOf("file:///etc/hosts") === null && addressOf("javascript:alert(1)") === null && addressOf("  ") === null)
  check("Browser: a name with a port and the local network's names get http", addressOf("nas:5000") === "http://nas:5000/" && addressOf("home-macbook-air-m1:8080/x") === "http://home-macbook-air-m1:8080/x"
    && addressOf("printer.local") === "http://printer.local/" && addressOf("router.lan") === "http://router.lan/" && addressOf("box.home.arpa") === "http://box.home.arpa/" && addressOf("app.test") === "http://app.test/")
  check("Browser: a guessed https falls back to http only when it can't connect", guessedHttps("example.com") && !guessedHttps("https://example.com") && !guessedHttps("open notes") && !guessedHttps("nas:5000")
    && httpFallback("https://example.com/a", "ERR_CONNECTION_REFUSED") === "http://example.com/a" && httpFallback("https://example.com/", "ERR_CERT_AUTHORITY_INVALID") === "http://example.com/"
    && httpFallback("https://example.com/", "ERR_NAME_NOT_RESOLVED") === null)
  check("Browser: a tab's name before the page's title is its site", hostOf("https://www.example.com/a") === "example.com" && hostOf("nonsense") === "nonsense")
}

// ---------- Browser: where a page opens (plugins/core/web-viewer/where.ts) ----------
{
  const { containerNamed, linkChoice, whereIn } = await import("../../../plugins/core/web-viewer/where.ts")
  const list = [{ id: "personal", name: "Personal" }, { id: "work", name: "Work" }, { id: "agents", name: "PersonalAgents", sites: ["google.com"] }]
  const doc = "https://docs.google.com/document/d/1", at = (container?: string | null, own?: string | null) =>
    whereIn(list, doc, { from: null, fresh: true, chosen: linkChoice(list, container), own }).container
  check("Browser: a container is named by its id or its name in any case", containerNamed(list, "work")?.id === "work" && containerNamed(list, " personalagents ")?.id === "agents"
    && containerNamed(list, "Nope") === null && containerNamed(list, "") === null)
  check("Browser: a link's container beats its site's rule and the workspace's, none (null) too", at("Work") === "work" && at("work", "personal") === "work" && at(null) === null && at(null, "work") === null)
  check("Browser: a container no one is called leaves the link to the site's rule, then the workspace's", at("Nope") === "agents" && at(undefined) === "agents"
    && whereIn(list, "https://example.com/", { from: null, fresh: true, chosen: linkChoice(list, "nope"), own: "personal" }).container === "personal")
}

// ---------- Browser: which container another app's link opens in, and a tab moved mid sign-in (where.ts, core/signin.ts, electron/webpages.ts) ----------
{
  const { byLogins, linkRuleIn, movedFrom, ruleSiteOf } = await import("../../../plugins/core/web-viewer/where.ts")
  const { signInOf } = await import("../../../core/signin.ts")
  const { flowOn } = await import("../../../electron/webpages.ts")
  const auth = "https://accounts.google.com/o/oauth2/v2/auth?client_id=1.apps.example&redirect_uri=https%3A%2F%2Fapi.lighthouse.app%2Fauth%2Fcallback&response_type=code&state=x"
  check("sign-in: an OAuth request, SAML's and OpenID's, by their fields alone; a page with a stray client_id isn't one",
    JSON.stringify(signInOf(auth)) === JSON.stringify({ host: "accounts.google.com", back: "https://api.lighthouse.app/auth/callback" })
    && signInOf("https://login.example.com/saml?SAMLRequest=abc")?.host === "login.example.com"
    && signInOf("https://id.example.org/server?openid.mode=checkid_setup&openid.return_to=https%3A%2F%2Fa.example.com%2F")?.back === "https://a.example.com/"
    && signInOf("https://shop.example.com/item?client_id=7") === null && signInOf("https://api.lighthouse.app/auth/start?lighthouse_state=1") === null
    && signInOf("https://idp.example.com/a?client_id=1&redirect_uri=javascript:alert(1)")?.back === "" && signInOf("not a url") === null)
  const list = [{ id: "personal", name: "Personal" }, { id: "alt", name: "Alternative", sites: ["lighthouse.app"] }, { id: "agents", name: "Agents", sites: ["google.com"] }]
  check("link from an app: a sign-in's rule is the site it signs in to's, before the identity provider's own; else the link's site's",
    linkRuleIn(list, auth) === "alt" && ruleSiteOf(auth) === "lighthouse.app"
    && linkRuleIn(list, "https://accounts.google.com/o/oauth2/v2/auth?client_id=1&redirect_uri=https://other.example.com/cb") === "agents"
    && linkRuleIn(list, "https://docs.lighthouse.app/a") === "alt" && linkRuleIn(list, "https://example.com/") === null && ruleSiteOf("https://www.example.com/a") === "example.com")
  check("link from an app: one set of logins signed in opens there (none, the workspace's, too), several ask in their order, none leaves it to the rules",
    JSON.stringify(byLogins(["alt"])) === JSON.stringify({ open: "alt" }) && JSON.stringify(byLogins([null])) === JSON.stringify({ open: null })
    && JSON.stringify(byLogins([null, "personal", "alt", "alt"])) === JSON.stringify({ ask: [null, "personal", "alt"] }) && JSON.stringify(byLogins([])) === "{}")
  const site = (h: string) => h.split(".").slice(-2).join(".")
  const start = "https://api.lighthouse.app/auth/start?lighthouse_state=1"
  let f = flowOn({ opened: start }, start, false, site)
  f = flowOn(f, auth, false, site)
  check("flow: an app's auth start reaching another site's sign-in by redirects notes its identity provider, its start kept",
    f.opened === start && f.signIn === "google.com", f)
  check("flow: the user pressing in the page before it moves on ends it; a sign-in on its own site isn't another's; no flow stays none",
    JSON.stringify(flowOn(f, "https://accounts.google.com/signin/next", true, site)) === "{}"
    && flowOn({ opened: "https://app.example.com/" }, "https://auth.example.com/authorize?client_id=1&response_type=code", false, site).signIn === undefined
    && JSON.stringify(flowOn({}, auth, false, site)) === "{}")
  check("moved to another container: from where its flow began while the user hasn't moved it on, else where it is",
    movedFrom({ url: "https://accounts.google.com/v3/signin", opened: start }, "x") === start && movedFrom({ url: "https://a.example.com/" }, "x") === "https://a.example.com/"
    && movedFrom({ url: "" }, "https://b.example.com/") === "https://b.example.com/")
}

// ---------- Browser: the bookmarks note (plugins/core/web-viewer/bookmarks.ts) ----------
{
  const { addBookmarks, addFolder, editBookmark, matchBookmarks, readBookmarks, readFolders, removeBookmark, removeFolder, renameFolder } = await import("../../../plugins/core/web-viewer/bookmarks.ts")
  const note = "# Links\n\n- [Top](https://top.example.com/)\n\n## Reading\n* <https://bare.example.com/a>\n\n```\n## Not a folder\n- [No](https://no.example.com/)\n```\n\n### Later\n- [x] [Done \\] it](https://later.example.com/)\n"
  const read = readBookmarks(note)
  check("bookmarks: links by their folders (a # title isn't one), a code block's ignored", JSON.stringify(read.map((b) => [b.folder, b.title, b.url])) === JSON.stringify([
    ["", "Top", "https://top.example.com/"], ["Reading", "", "https://bare.example.com/a"], ["Reading/Later", "Done ] it", "https://later.example.com/"]]), read)
  const added = addBookmarks(note, [{ url: "https://top.example.com/", title: "Again", folder: "" }, { url: "https://new.example.com/", title: "New", folder: "Reading/Later" },
    { url: "https://deep.example.com/", title: "Deep", folder: "Reading/Later/Deeper" }, { url: "javascript:alert(1)", title: "Bad", folder: "" }])
  check("bookmarks: added under their folders, a missing one made, nothing changed, no repeats", added.added === 2
    && added.body.includes("[x] [Done \\] it](https://later.example.com/)\n- [New](https://new.example.com/)\n\n#### Deeper\n- [Deep](https://deep.example.com/)\n")
    && added.body.startsWith(note.slice(0, -1)), added)
  check("bookmarks: matched by title and address", matchBookmarks(read, "later")[0]?.url === "https://later.example.com/" && !matchBookmarks(read, "nothing").length)
  const gone = removeBookmark(note, "https://bare.example.com/a")
  check("bookmarks: removed, only its line (its folder stays, a code block's look-alike too)", gone.removed === 1 && gone.body === note.replace("* <https://bare.example.com/a>\n", ""), gone)
  const renamed = editBookmark(note, "https://later.example.com/", { title: "Kept [for] later" })
  check("bookmarks: renamed in its line, its list mark and tick kept", renamed.changed && renamed.body === note.replace("[Done \\] it]", "[Kept \\[for\\] later]"), renamed)
  const moved = editBookmark(note, "https://top.example.com/", { folder: "Reading" })
  check("bookmarks: moved to another folder, under its heading", moved.changed && JSON.stringify(readBookmarks(moved.body).find((b) => b.url === "https://top.example.com/")) === JSON.stringify({ url: "https://top.example.com/", title: "Top", folder: "Reading" })
    && readBookmarks(moved.body).length === 3, moved.body)
  check("bookmarks: an edit of nothing, or of an address not there, changes nothing", !editBookmark(note, "https://top.example.com/", { title: "Top", folder: "" }).changed
    && !editBookmark(note, "https://none.example.com/", { title: "X" }).changed && removeBookmark(note, "https://none.example.com/").removed === 0)
  const flat = "- [A](https://a.example.com/)\n- [B](https://b.example.com/)\n- [C](https://c.example.com/)\n\n## Tools\n- [T](https://t.example.com/)\n"
  check("bookmarks: folders are headings, empty ones too", JSON.stringify(readFolders(note)) === JSON.stringify(["Reading", "Reading/Later"]))
  check("bookmarks: a folder made at the end, or in its parent; there already, nothing", addFolder(flat, "Work").body === `${flat}\n## Work\n`
    && addFolder(flat, "Tools/Later").body === `${flat}\n### Later\n` && !addFolder(flat, "tools").added && addFolder("", "Work").body === "## Work\n")
  check("bookmarks: a folder renamed in its heading; a sibling's name refused", renameFolder(note, "Reading", "Articles").body === note.replace("## Reading", "## Articles")
    && !!renameFolder(addFolder(note, "Tools").body, "Reading", "tools").taken)
  const gone2 = removeFolder(flat, "Tools")
  check("bookmarks: a folder removed with what's in it", gone2.found && gone2.removed === 1 && gone2.body === "- [A](https://a.example.com/)\n- [B](https://b.example.com/)\n- [C](https://c.example.com/)\n", gone2)
  const order = (b: string) => readBookmarks(b).map((x) => x.title).join("")
  check("bookmarks: moved before another (a drag), last with \"\", into a folder before its link", order(editBookmark(flat, "https://c.example.com/", { before: "https://a.example.com/" }).body) === "CABT"
    && order(editBookmark(flat, "https://a.example.com/", { before: "" }).body) === "BCAT"
    && editBookmark(flat, "https://a.example.com/", { folder: "Tools", before: "https://t.example.com/" }).body.includes("## Tools\n- [A](https://a.example.com/)\n- [T]")
    && !editBookmark(flat, "https://a.example.com/", { before: "https://b.example.com/" }).changed)
}

// ---------- Browser: the blocked elements note (plugins/core/web-viewer/elements.ts) ----------
{
  const { addRule, makeRule, readRules, removeRule } = await import("../../../plugins/core/web-viewer/elements.ts")
  const note = "Things I hid.\n\n## youtube.com\n\n- `youtube.com##ytd-reel-shelf-renderer` Shorts\n- youtube.com##ytd-comments#comments\n\n## Notes\n\nA paragraph.\n\n```\nexample.com##.ad\n```\n"
  check("blocked elements: rules as list items, bare or in backticks (words after them a note), a pasted block's too; headings aren't",
    JSON.stringify(readRules(note).map((r) => [r.site, r.selector])) === JSON.stringify([["youtube.com", "ytd-reel-shelf-renderer"], ["youtube.com", "ytd-comments#comments"], ["example.com", ".ad"]]), readRules(note))
  const a = addRule(note, makeRule("#related", "https://www.youtube.com/watch")!)
  check("blocked elements: a rule added under its site's heading, after its last, nothing else changed", a.added
    && a.body.includes("- youtube.com##ytd-comments#comments\n- `youtube.com###related`\n\n## Notes"), a.body)
  const b = addRule(a.body, makeRule("news.example.com,~old.news.example.com##div[class*=\"promo\"]")!)
  check("blocked elements: a new site gets its heading at the end; a rule there already isn't added again",
    b.body.endsWith("```\n\n## news.example.com\n\n- `news.example.com,~old.news.example.com##div[class*=\"promo\"]`\n") && !addRule(b.body, makeRule("youtube.com##ytd-reel-shelf-renderer")!).added, b.body)
  const c = removeRule(b.body, "news.example.com,~old.news.example.com##div[class*=\"promo\"]")
  check("blocked elements: a rule removed takes its heading when nothing's left under it", c.removed && c.body === a.body, c.body)
  const d = removeRule(c.body, "youtube.com##ytd-comments#comments")
  check("blocked elements: … and leaves it with others", d.body.includes("## youtube.com\n\n- `youtube.com##ytd-reel-shelf-renderer` Shorts\n- `youtube.com###related`\n"), d.body)
  check("blocked elements: what isn't a rule isn't made one", makeRule("a\nb") === null && makeRule(".x", "not a site!") === null && makeRule("## heading") === null)
}

// ---------- Browser: site styles win over the site's own (plugins/core/web-viewer/sitestyles.ts) ----------
{
  const { winning } = await import("../../../plugins/core/web-viewer/sitestyles.ts")
  const out = winning(`/* a; {comment} */ @import url("a;b.css");
@media (prefers-color-scheme: dark) { body { background: var(--vault-background); background-image: none } a:link { color: red !important } }
@keyframes spin { from { opacity: 0 } to { opacity: 1 } }
@font-face { font-family: X; src: url("x;y.woff") }
.box { color: blue; &:hover { color: green; } content: "a;}b" }`)
  check("Browser: a site style's declarations are !important, a shorthand with a var() kept as written",
    out.includes("background: var(--vault-background) !important;") && out.includes("background-image: none !important}")
    && out.includes("color: red !important }") && !out.includes("!important !important"), out)
  check("Browser: a site style's keyframes, font faces, imports and comments are left as they may be",
    out.includes("from { opacity: 0 }") && out.includes(`src: url("x;y.woff") }`) && out.includes(`@import url("a;b.css");`) && !out.includes("comment"), out)
  check("Browser: a site style's nested rules and strings with braces",
    out.includes("color: blue !important;") && out.includes("color: green !important;") && out.includes(`content: "a;}b" !important}`), out)
}
