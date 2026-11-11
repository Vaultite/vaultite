// A spoken yes or no to an offer (take-over's, the timeline's: electron/timelineoffer.ts), for the companion's server
// and the desktop app's helper alike.

/** Their spoken answer to an offer: no at any no word in it ("please stop", "sure, not that one"), yes only when it's
 *  yes words alone, else neither (an ask of its own). */
const NO = /\b(no|nope|nah|don'?t|do not|not|stop|wait|never ?mind|cancel|hold on|later|não)\b/
const YES = /^((yes|yeah|yep|yup|sure|ok|okay|please|go ahead|go for it|do it|let'?s do it|sounds good|alright|all right|absolutely|of course|thanks|thank you|sim|claro|pode)\s*)+$/
export function answerOf(words: string): boolean | null {
  const w = words.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()
  if (!w || w.split(" ").length > 8) return null
  if (NO.test(w)) return false
  return YES.test(w) ? true : null
}
