import { check } from "../lib.ts"

// ---------- Browser: who's signed in to a site (electron/siteaccounts.ts), on made-up answers ----------
const sa = await import("../../../electron/siteaccounts.ts")
const read = (site: string, body: unknown, cookies: Record<string, string> = {}, url = "") => sa.ACCOUNTS[site].read!(body, async (_d, name) => cookies[name] ?? "", url)
const name = async (...a: Parameters<typeof read>) => { const v = await read(...a); return (typeof v === "string" ? v : v?.account) || null } // (as electron/webaccounts.ts askWho: "" names nobody)
const look = (site: string, v: unknown) => sa.ACCOUNTS[site].look!.read(v)
const list = '["gaia.l.a.r",[["gaia.l.a",1,"Alice Park","alice.park@example.com","https://lh3.example.com/a.png",1,1,0,null,1,"1001",null,null,null,0,1],' +
  '["gaia.l.a",1,"Lighthouse","studio@example.com","",1,1,0,null,1,"1002",null,null,null,0,1],["gaia.l.a",1,"Old","old@example.com","",1,1,0,null,1,"1003",null,null,null,1,1]]]'
check("accounts: Google's list, the first signed in, the others beside it, a signed-out one left out",
  JSON.stringify(sa.googleAccounts(list)) === JSON.stringify({ account: "alice.park@example.com", more: ["studio@example.com"], avatar: "https://lh3.example.com/a.png" }), sa.googleAccounts(list))
const wrapped = `<html><body><script>window.parent.postMessage('${list.replace(/"/g, "\\x22")}', 'https://accounts.google.com')</script></body></html>`
check("accounts: Google's list inside the page it sometimes answers", sa.googleAccounts(wrapped)?.account === "alice.park@example.com", sa.googleAccounts(wrapped))
check("accounts: Google, nobody signed in", sa.googleAccounts('["gaia.l.a.r",[]]') === null && sa.googleAccounts("<html>Sign in</html>") === null)
check("accounts: Reddit's name, its picture's address unescaped",
  JSON.stringify(await read("reddit.com", { data: { name: "alice_park", icon_img: "https://styles.example.com/a.png?s=1&amp;b=2" } })) === JSON.stringify({ account: "u/alice_park", avatar: "https://styles.example.com/a.png?s=1&b=2" }))
check("accounts: GitHub's login from its page, none signed out",
  (await read("github.com", '<meta name="user-login" content="alicepark">') as { account: string })?.account === "alicepark" && await read("github.com", '<meta name="user-login" content="">') === null)
const x = '{"users":{"7":{"id_str":"7","screen_name":"someone"},"42":{"id_str":"42","name":"Alice","screen_name":"alicepark","profile_image_url_https":"https:\\/\\/pbs.example.com\\/a.jpg"}}}'
const xWho = await read("x.com", x, { twid: "u%3D42" }) as { account: string; avatar: string } | null
check("accounts: X, the user whose id the twid cookie has, not another on the page", xWho?.account === "@alicepark" && xWho.avatar === "https://pbs.example.com/a.jpg", xWho)
check("accounts: X, no twid cookie: nobody", await read("x.com", x) === null)
check("accounts: claude.ai's email", await read("claude.ai", { account: { email_address: "alice@example.com" } }) === "alice@example.com")
check("accounts: X's handle and picture from an open page's sidebar, nothing from a page without it",
  JSON.stringify(sa.xLooked({ handle: "alicepark", avatar: "https://pbs.example.com/a.jpg" })) === JSON.stringify({ account: "@alicepark", avatar: "https://pbs.example.com/a.jpg" }) && sa.xLooked(null) === null && sa.xLooked({ handle: "i/flow/login" }) === null)
check("accounts: Hacker News's name from its login cookie, none without one",
  await read("ycombinator.com", null, { user: "alicepark&k3yH4sh" }) === "alicepark" && await read("ycombinator.com", null) === null)
check("accounts: Instagram's handle, none signed out", await name("instagram.com", { form_data: { username: "alice.park" } }) === "@alice.park" && await name("instagram.com", { message: "login_required" }) === null)
const fb = '<script>{"define":[["CurrentUserInitialData",[],{"ACCOUNT_ID":"4242","USER_ID":"4242","NAME":"Alice Park \\u00c9","SHORT_NAME":"Alice"},270]]}</script>'
check("accounts: Facebook's name for the user its c_user cookie has, none for another or without it",
  await name("facebook.com", fb, { c_user: "4242" }) === "Alice Park \u00c9" && await name("facebook.com", fb, { c_user: "7" }) === null && await name("facebook.com", fb) === null)
check("accounts: LinkedIn's handle from the profile /in/me/ took it to, none when it stayed",
  await name("linkedin.com", "", {}, "https://www.linkedin.com/in/alice-park-1a2b/") === "alice-park-1a2b" && await name("linkedin.com", "", {}, "https://www.linkedin.com/in/me/") === null &&
  await name("linkedin.com", "", {}, "https://www.linkedin.com/login") === null)
check("accounts: Cloudflare's, Cursor's, Apple's and GitLab's emails or names from their own answers",
  await name("cloudflare.com", { success: true, result: { email: "alice@example.com" } }) === "alice@example.com" && await name("cloudflare.com", { success: false, result: null }) === null &&
  await name("cursor.com", { email: "alice@example.com", name: "Alice" }) === "alice@example.com" && await name("apple.com", { user: { fullName: "Alice Park", emailAddress: "alice@example.com" } }) === "alice@example.com" &&
  await name("gitlab.com", { id: 1, username: "alicepark" }) === "alicepark" && await name("gitlab.com", { message: "401 Unauthorized" }) === null)
check("accounts: Wikipedia's user, none for an IP address signed out",
  await name("wikipedia.org", { query: { userinfo: { id: 12, name: "Alice Park" } } }) === "Alice Park" && await name("wikipedia.org", { query: { userinfo: { id: 0, name: "192.0.2.1", anon: "" } } }) === null)
check("accounts: Perplexity's email", await name("perplexity.ai", { user: { email: "alice@example.com" } }) === "alice@example.com" && await name("perplexity.ai", {}) === null)
check("accounts: Slack's email from its workspace's settings page, none at its sign-in page",
  await name("slack.com", '<h2>Email Address</h2><p class="no_bottom_margin">Your email address is <strong>alice@example.com</strong></p>') === "alice@example.com" &&
  await name("slack.com", "<html><title>Sign in to Slack | Slack</title></html>") === null)
check("accounts: WhatsApp's number off its open app, signed in unnamed without it, out at its QR code",
  JSON.stringify(look("whatsapp.com", { phone: '"5511987654321:12@c.us"' })) === '{"account":"+5511987654321"}' && JSON.stringify(look("whatsapp.com", { phone: "" })) === '{"account":""}' &&
  look("whatsapp.com", { out: true }) === false && sa.phoneOf("12@c.us") === "")
check("accounts: a rule's answer at a dotted path, only a string", sa.at({ a: { b: " x " } }, "a.b") === "x" && sa.at({ a: { b: 3 } }, "a.b") === "" && sa.at(null, "a.b") === "")
check("accounts: Google's login covers YouTube and google.<country>, not other sites",
  sa.covers("youtube.com", "youtube.com") && sa.covers("google.*", "google.com.br") && sa.covers("google.*", "google.co.uk") && !sa.covers("google.*", "google.com") && !sa.covers("google.*", "googleapis.com") && !sa.covers("youtube.com", "youtu.be"))
