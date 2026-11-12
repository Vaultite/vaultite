import { check, section } from "../lib.ts"

// ---------- Browser: when agents' browsing holds a restart (electron/browser/agentbusy.ts) ----------
await section("agents hold restarts", async () => {
  const { agentBusy, QUIET_AFTER } = await import("../../../electron/browser/agentbusy.ts")
  const now = 1_000_000_000
  check("a call under way holds either restart, however long ago the last action", agentBusy("server", { inFlight: 1, lastStep: 0, now }) === "an agent's call is under way"
    && agentBusy("app", { inFlight: 2, lastStep: 0, now }) !== null)
  check("the server's: held for a minute after the last action", agentBusy("server", { inFlight: 0, lastStep: now - 59_000, now }) === "an agent acted in a page in the last minute")
  check("…then let through (it keeps nothing an agent loses)", QUIET_AFTER.server === 60_000 && agentBusy("server", { inFlight: 0, lastStep: now - 60_000, now }) === null)
  check("the app's (its pages reload): held for 10 minutes", agentBusy("app", { inFlight: 0, lastStep: now - 9 * 60_000, now }) === "an agent acted in a page in the last 10 minutes"
    && agentBusy("app", { inFlight: 0, lastStep: now - 10 * 60_000, now }) === null)
})

// ---------- Browser: Google's sign-in sees Firefox (electron/browser/googleagent.ts) ----------
await section("google sign-in", async () => {
  const g = await import("../../../electron/browser/googleagent.ts")
  const mac = g.firefoxAgent("148.0.7778.97", "darwin"), win = g.firefoxAgent("148.0.7778.97", "win32"), linux = g.firefoxAgent("148.0.7778.97", "linux")
  check("google sign-in: a Firefox of Chromium's month on each platform", mac === "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:149.0) Gecko/20100101 Firefox/149.0"
    && win.includes("(Windows NT 10.0; Win64; x64; rv:149.0)") && linux.includes("(X11; Linux x86_64; rv:149.0)"), [mac, win, linux])
  const h = g.asFirefox({ "user-agent": "Mozilla/5.0 Chrome/148", "Sec-CH-UA": '"Chromium";v="148"', "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"macOS"',
    "Sec-CH-UA-Full-Version-List": "x", Cookie: "SID=1", "Sec-Fetch-Mode": "navigate" }, mac)
  check("google sign-in: requests carry Firefox's user agent, no client hints, the rest as they were",
    JSON.stringify(h) === JSON.stringify({ Cookie: "SID=1", "Sec-Fetch-Mode": "navigate", "User-Agent": mac }), h)
  check("google sign-in: only accounts.google.com", g.isSignIn("https://accounts.google.com/v3/signin/identifier") && g.isSignIn("https://accounts.google.com/gsi/iframe")
    && !g.isSignIn("https://mail.google.com/") && !g.isSignIn("https://accounts.google.com.evil.example/") && !g.isSignIn("http://accounts.google.com/"))
})
