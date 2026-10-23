// A page's login form as logins.ts fills it: which of its inputs takes the username, the password or a one-time code.
// Decided from what the DOM says of each (read over the DevTools protocol, never by the page's scripts).

export type Input = { id: number; type: string
  /** Its name, id, aria-label and placeholder, together. */
  hint: string
  autocomplete: string
  /** Its form's node (0: none). */
  form: number
  visible: boolean; disabled: boolean
  /** -1: none. */
  maxLength: number
  inputMode?: string }
export type LoginForm =
  | { kind: "password"; password: Input; username: Input | null }
  | { kind: "username"; username: Input }
  | { kind: "otp"; otp: Input[] }
  | { kind: "none" }

const TEXT = new Set(["", "text", "email", "tel", "number"])
const USER = /user|e-?mail|login|account|identifier|phone|signin/i
const CODE = /one[-_ ]?time|\botp\b|totp|2fa|mfa|two[-_ ]?factor|verification|verify|security[-_ ]?code|auth\w*[-_ ]?code|passcode|\bcode\b|token/i
const SEARCH = /search|query|\bq\b/i

/** What the page asks for, in this order: a password (and the username before it), else a one-time code, else a
 *  username alone (a username-first sign-in). A form with two passwords is a sign-up or a change: none. */
export function loginForm(all: Input[]): LoginForm {
  const usable = all.filter((i) => i.visible && !i.disabled)
  const passwords = usable.filter((i) => i.type === "password")
  const texts = usable.filter((i) => TEXT.has(i.type) && !SEARCH.test(i.hint))
  if (passwords.length) {
    const password = passwords[0]
    if (passwords.some((p) => p !== password && p.form === password.form)) return { kind: "none" }
    const before = texts.filter((i) => all.indexOf(i) < all.indexOf(password) && (!password.form || i.form === password.form))
    const username = before.find((i) => /username|email/.test(i.autocomplete)) ?? before.at(-1) ?? null
    return { kind: "password", password, username }
  }
  const named = (i: Input) => i.autocomplete.includes("one-time-code") || CODE.test(i.hint)
  // (a box per digit: four or more one-character fields in a row)
  const boxes = texts.filter((i) => i.maxLength === 1)
  if (boxes.length >= 4 && boxes.every((b, k) => k === 0 || all.indexOf(b) === all.indexOf(boxes[k - 1]) + 1)) return { kind: "otp", otp: boxes }
  const code = texts.find(named)
  if (code) return { kind: "otp", otp: [code] }
  const username = texts.find((i) => /username|email/.test(i.autocomplete)) ?? texts.find((i) => i.type === "email" || USER.test(i.hint))
  return username ? { kind: "username", username } : { kind: "none" }
}
