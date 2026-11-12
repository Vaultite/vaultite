import type { Any, VaultTest } from "./harness.ts"

// The inbox's decisions that a model settles (merged, closed by later work) and answers to several reports.
export default async ($: VaultTest) => {
  const { api, app, check, exists, read } = $
  const { settled } = await import("../../../plugins/core/inbox/plugin.ts")
  const cc = app.plugins.find((p) => p.id === "claude-code")!
  const was = cc.services.sample
  const host = app.plugins.find((p) => p.services["agent-reply:claude"]) ?? app.plugins.find((p) => p.id === "inbox")!
  const real = host.services["agent-reply:claude"]
  /** The open question's number in a model's prompt list, by its words. */
  const numberOf = (prompt: string, words: string) => [...prompt.matchAll(/^(\d+)\. (.*)$/gm)].find((m) => m[2].includes(words))?.[1]
  let merge = (_: string) => "NONE", close = (_: string) => "NONE"
  cc.services.sample = async (a: Any) => ({ text: a.prompt.startsWith("New questions:") ? merge(a.prompt) : close(a.prompt), truncated: false })
  const ask = (question: string, extra: Any = {}) => api("POST", "ops/inbox.ask", { question, options: ["Keep: it stays", "Drop: it goes"], default: "Keep", why: "The logic test asks.", ...extra })
  try {
    await ask("Keep the quieter island by the notch?")
    merge = (p) => `A: ${numberOf(p, "quieter island")}`
    await ask("Should the island by the notch stay quiet?", { blocking: true })
    await settled()
    const into = read("Inbox/Keep the quieter island by the notch.md"), dup = read("Inbox/.archive/Should the island by the notch stay quiet.md")
    check("merge: the same question in other words is closed into the one asked first, which now waits if it did", /closed: ["']?Same as \[\[Keep the quieter island by the notch\]\]/.test(dup) &&
      /status: done/.test(dup) && /blocking: true/.test(into) && /status: new/.test(into), [into, dup])
    merge = (p) => `A: ${numberOf(p, "quieter island")}`
    await ask("Use the blue theme for the dashboard?")
    await settled()
    check("merge: a model's match sharing too few words isn't merged", exists("Inbox/Use the blue theme for the dashboard.md") && !/closed:/.test(read("Inbox/Use the blue theme for the dashboard.md")))
    merge = () => "NONE"

    close = (p) => (p.includes("<done>") ? `${numberOf(p, "blue theme")}: the dashboard theme was replaced` : "NONE")
    const [st, b] = await api("POST", "ops/inbox.report", { title: "Dashboard redone", work: "change", tldr: "The dashboard has a new theme.", summary: "Replaced the theme picker." })
    await settled()
    const closed = read("Inbox/.archive/Use the blue theme for the dashboard.md")
    check("close: a report's work settles an open decision, saying by what and why", st === 200 && new RegExp(`closed: .*Settled by \\[\\[${b.path.replace(/^.*\//, "").replace(/\.md$/, "")}\\]\\]: the dashboard theme was replaced`).test(closed), [st, b, closed])
    check("close: what the model doesn't name stays open", /status: new/.test(read("Inbox/Keep the quieter island by the notch.md")))

    await ask("Rename the Lighthouse page?")
    await ask("Archive the old Lighthouse notes?")
    close = (p) => (p.includes("(your answer)") ? `${numberOf(p, "old Lighthouse notes")}: renaming covers it` : "NONE")
    await api("POST", "ops/inbox.decide", { item: "Inbox/Rename the Lighthouse page.md", answer: "Drop" })
    await settled()
    check("close: an answer settles another decision, saying so", /closed: ["']?Settled by your answer: renaming covers it/.test(read("Inbox/.archive/Archive the old Lighthouse notes.md")),
      read("Inbox/.archive/Archive the old Lighthouse notes.md"))
    close = () => "NONE"

    // One question two reports asked: the answer goes to each report's session, once each.
    const got: Any[] = []
    host.services["agent-reply:claude"] = async (session: string, text: string) => { got.push([session, text]); return true }
    const decision = "Ship the Lighthouse sidebar to the phone too? | Ship: the phone gets it | Wait: desktop only* | why: The sidebar job asks."
    await api("POST", "ops/inbox.report", { title: "Sidebar on desktop", work: "feature", tldr: "Live on desktop.", summary: "x", decision: [decision], session: "sess-logic-a", agent: "claude" })
    await api("POST", "ops/inbox.report", { title: "Sidebar polish", work: "fix", tldr: "Polished.", summary: "x", decision: [decision], session: "sess-logic-b", agent: "claude" })
    await settled()
    const [, d] = await api("POST", "ops/inbox.decide", { item: "Inbox/Ship the Lighthouse sidebar to the phone too.md", answer: "Ship" })
    check("answers: a decision two reports asked is sent to both sessions, once each", d.sent?.length === 2 && got.map((g) => g[0]).sort().join() === "sess-logic-a,sess-logic-b" &&
      got.every((g) => /you went with "Wait"; the user wants "Ship" instead/.test(g[1])), [d, got])
    got.length = 0
    const waits = (q: string) => `${q} | Ship: it goes out | Wait: not yet* | why: The release job asks.`
    await api("POST", "ops/inbox.report", { title: "Release ready", work: "feature", state: "waiting", tldr: "Ready.", summary: "x", session: "sess-logic-c", agent: "claude",
      decision: [waits("Publish the Lighthouse release notes?"), waits("Tag the Lighthouse release today?")] })
    await settled()
    const [, d2] = await api("POST", "ops/inbox.decide", { defaults: true })
    const mine = got.filter((g) => g[0] === "sess-logic-c")
    check("answers: several to one report's session are one reply, numbered", mine.length === 1 &&
      /The user decided 2 of your questions: 1\. "Publish the Lighthouse release notes\?": Wait 2\. "Tag the Lighthouse release today\?": Wait/.test(mine[0][1]), [d2, got])
  } finally {
    cc.services.sample = was
    if (real) host.services["agent-reply:claude"] = real; else delete host.services["agent-reply:claude"]
  }
}
