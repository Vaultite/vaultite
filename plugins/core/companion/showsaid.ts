import type { Result, Tour } from "./tour.ts"

const quoted = (a: string[]) => a.map((m) => JSON.stringify(m)).join(" or ")

export function lostSaid(r: Result): string {
  const last = r.steps.at(-1)
  if (last?.missing?.length) return `I can't find ${quoted(last.missing)} on your screen now, so I can't show you that part.`
  if (last?.hidden?.length) return `${quoted(last.hidden)} ${last.hidden.length > 1 ? "stay" : "stays"} out of view on your screen, so I can't show you that part.`
  if (last?.why) return `I got stuck at step ${last.n} (${last.why}), so I can't show you the rest.`
  return "I can't find what it changed on your screen now, so I can't show you that part."
}

const ON = /^(?:on|in) (your (?:iphone|phone|ipad)|the (?:iphone|phone|ipad) app|the mini ?pc|the (?:windows|linux) (?:vm|pc|machine))\s*[,:]\s*/i

export function deviceOf(t: Pick<Tour, "steps">): string {
  const named = ON.exec(t.steps[0]?.said.trim() ?? "")?.[1] ?? ""
  if (/i?phone/i.test(named) && !/ipad/i.test(named)) return "your iPhone"
  return named.replace(/^\p{Lu}/u, (c) => c.toLowerCase()).replace(/\bipad\b/i, "iPad").replace(/\bmini ?pc\b/i, "mini PC")
}

export function seeOn(t: Pick<Tour, "steps">, device: string): string {
  const steps = t.steps.map((s, i) => (i === 0 ? s.said.trim().replace(ON, "") : s.said.trim()).replace(/^\p{Ll}/u, (c) => c.toUpperCase()))
    .filter(Boolean).map((x) => (/[.!?…]$/.test(x) ? x : `${x}.`))
  const how = steps.length ? `To see it there: ${steps.join(" ")}` : `Open it on ${device} to see it.`
  return `That change is on ${device}, so it doesn't show on this Mac. ${how}`
}
