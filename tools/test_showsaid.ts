import "./test/isolate.ts"
import { deviceOf, lostSaid, seeOn } from "../plugins/core/companion/showsaid.ts"
import { parseTour, type Played } from "../plugins/core/companion/tour.ts"

let passed = 0, failed = 0
function check(name: string, ok: boolean, info?: string) {
  if (ok) { passed++; return }
  failed++
  console.log(`FAIL ${name}${info === undefined ? "" : `\n     ${info}`}`)
}
const lost = (p: Partial<Played>) => lostSaid({ ended: "lost", steps: [{ n: 1, how: "played", ms: 1 }, { n: 2, how: "lost", ms: 1, ...p }] })

check("lost: not found, said as one sentence", lost({ why: "not found: New chat", missing: ["New chat"] }) === `I can't find "New chat" on your screen now, so I can't show you that part.`)
check("lost: out of view, never glued onto another line", lost({ why: "it didn't come into view", hidden: ["Terminals"] }) === `"Terminals" stays out of view on your screen, so I can't show you that part.`, lost({ hidden: ["Terminals"] }))
check("lost: two out of view", lost({ hidden: ["A", "B"] }) === `"A" or "B" stay out of view on your screen, so I can't show you that part.`)
check("lost: a step's action that failed", lost({ why: `click "Send": it didn't work` }) === `I got stuck at step 2 (click "Send": it didn't work), so I can't show you the rest.`)
check("lost: nothing said why", lost({}) === "I can't find what it changed on your screen now, so I can't show you that part.")

const tour = (text: string) => parseTour({ job: "j1" }, text, "x")[0]
const phone = tour(`1. On your phone, open any terminal [frame "Terminals"].\n2. Tap in it: the keyboard comes up and the screen holds still [point "Terminals"].`)
check("device: a phone-only change, by its first step", deviceOf(phone) === "your iPhone", deviceOf(phone))
check("device: where to see it, its steps for the phone, no scrolling asked",
  seeOn(phone, "your iPhone") === "That change is on your iPhone, so it doesn't show on this Mac. To see it there: Open any terminal. Tap in it: the keyboard comes up and the screen holds still.", seeOn(phone, "your iPhone"))
const ipad = tour("1. On your iPad, open Settings\n2. Turn on Split view")
check("device: another device, its steps ended as sentences", deviceOf(ipad) === "your iPad" && seeOn(ipad, deviceOf(ipad)).endsWith("To see it there: Open Settings. Turn on Split view."), seeOn(ipad, deviceOf(ipad)))
const minipc = tour("1. On the mini PC, open the Vaultite app.\n2. The tab bar fits the window.")
check("device: another machine", deviceOf(minipc) === "the mini PC" && deviceOf(tour("1. In the iPhone app, open Jobs.")) === "your iPhone" && deviceOf(tour("1. On the Windows VM: open a terminal.")) === "the Windows VM", deviceOf(minipc))
check("device: a tour on this Mac has none, whatever its later steps say",
  deviceOf(tour(`1. Open Settings [frame "Settings"].\n2. On your phone, scan the code [ring "Code"].`)) === "" && deviceOf(tour(`1. In Settings, turn it on [ring "Sync"].`)) === "")

console.log(`${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
