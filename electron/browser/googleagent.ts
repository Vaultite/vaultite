// Google's sign-in is told this browser is Firefox: it refuses embedded ones, finding Electron by its client hints
// (Chromium's brands, no Google Chrome's) behind a plain Chrome's user agent; Firefox sends none. accounts.google.com only.

/** Where Google signs in: its pages and the frames other sites embed ("Sign in with Google"). */
export const SIGN_IN = "https://accounts.google.com/"
export const isSignIn = (url: string) => url.startsWith(SIGN_IN)

/** A current Firefox's user agent on this platform: about the version of the month Chromium's `chrome` came out. */
export function firefoxAgent(chrome: string, platform: string) {
  const v = `${(Number(chrome.split(".")[0]) || 140) + 1}.0`
  const os = platform === "darwin" ? "Macintosh; Intel Mac OS X 10.15" : platform === "win32" ? "Windows NT 10.0; Win64; x64" : "X11; Linux x86_64"
  return `Mozilla/5.0 (${os}; rv:${v}) Gecko/20100101 Firefox/${v}`
}

/** A request's headers as Firefox sends them: its user agent, no client hints. */
export function asFirefox(headers: Record<string, string>, agent: string) {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) if (!/^(user-agent|sec-ch-ua(-.*)?)$/i.test(k)) out[k] = v
  out["User-Agent"] = agent
  return out
}
