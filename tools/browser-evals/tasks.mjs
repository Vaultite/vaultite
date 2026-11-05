// The eval tasks: what a user asks an agent to do in the browser, on the made-up sites (sites.mjs), and how to tell it
// worked, from the agent's last answer and what the site kept.
import { FACTS } from "./sites.mjs"

const has = (text, ...words) => words.every((w) => text.toLowerCase().includes(w.toLowerCase()))

export const TASKS = [
  {
    id: "mail-find",
    prompt: (site) => `My mail is open at ${site}/mail (use the agent browser). When did my Harbor student health plan coverage end? Answer with the date as YYYY-MM-DD and nothing else.`,
    check: (answer) => answer.includes(FACTS.coverageEnd),
  },
  {
    id: "drive-read",
    prompt: (site) => `In my drive at ${site}/drive (use the agent browser), find the notes from the 2026-11-03 check-in meeting. What were the action items, and who owns each? Be brief.`,
    check: (answer) => has(answer, "Ben", "Chloe", "Dev") && /announcement/i.test(answer) && /runbook/i.test(answer) && /status page/i.test(answer) && !/Grace/i.test(answer),
  },
  {
    id: "doc-edit",
    prompt: (site) => `In my drive at ${site}/drive (use the agent browser), open the doc "Outreach plan". Make its title "Outreach plan" a Heading 1 and the three section names (Goals, Audience, Timeline) Heading 2, and fix the typo "recieve" everywhere. Save it. Change nothing else.`,
    check: (_a, state) => {
      const b = state.outreach.blocks
      const style = (t) => b.find((x) => x.text.trim() === t)?.style
      return state.outreach.saves > 0 && style("Outreach plan") === "h1" && ["Goals", "Audience", "Timeline"].every((t) => style(t) === "h2")
        && !b.some((x) => /recieve/.test(x.text)) && b.filter((x) => /receive/.test(x.text)).length === 2 && b.length === 7
    },
  },
  {
    id: "billing",
    prompt: (site) => `My cloud console is at ${site}/billing (use the agent browser). Where did the $5.03 on my latest invoice come from? Give the breakdown in a few lines.`,
    check: (answer) => /5\.00/.test(answer) && /workers/i.test(answer) && /r2/i.test(answer) && /0\.0[23]/.test(answer),
  },
  {
    id: "settings-form",
    prompt: (site) => `At ${site}/settings (use the agent browser), set my notification email to alice@lighthouse.test, the time zone to America/Chicago, turn off the weekly digest, and save. Leave the rest as it is.`,
    check: (_a, state) => {
      const s = state.settings
      return s.saves > 0 && s.email === "alice@lighthouse.test" && s.timezone === "America/Chicago" && s.digest === false && s.sms === false && s.language === "English"
    },
  },
  {
    id: "orders-extract",
    prompt: (site) => `In my shop admin at ${site}/orders (use the agent browser), which orders are still Pending with an amount over $200? List their order ids only, one per line.`,
    check: (answer) => {
      const got = new Set(answer.match(/A-\d+/g) ?? [])
      return FACTS.pendingOver200.every((id) => got.has(id)) && got.size === FACTS.pendingOver200.length
    },
  },
]
