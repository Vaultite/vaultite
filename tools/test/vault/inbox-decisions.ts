import type { VaultTest } from "./harness.ts"

// What a decision's answer tells the agent that asked it (decisions.ts): no server, no files.
export default async ($: VaultTest) => {
  const { check } = $
  const { decidedText, linkTo, listOf, optionsText, toldOf } = await import("../../../plugins/core/inbox/decisions.ts")
  const waits = { question: "Ship the Lighthouse sidebar?", options: ["Ship", "Wait"], default: "Wait", blocking: true }
  const took = { ...waits, blocking: false }
  check("decision answers told: one it waits on says the answer, a default it took and the user changed says so, a default kept says nothing",
    toldOf(waits, "Wait") === "\"Ship the Lighthouse sidebar?\": Wait" &&
    toldOf(took, "Ship") === "\"Ship the Lighthouse sidebar?\": you went with \"Wait\"; the user wants \"Ship\" instead, so change it" && toldOf(took, "Wait") === "")
  check("decision answers told: several to one session are one reply, numbered; one alone isn't",
    decidedText(["\"A?\": Yes", "\"B?\": No"]) === "The user decided 2 of your questions: 1. \"A?\": Yes 2. \"B?\": No" && decidedText(["\"A?\": Yes"]) === "The user decided: \"A?\": Yes")
  check("decision options as text: the default marked, each with what it causes when it says",
    optionsText({ options: ["Keep", "Go back"], effects: ["the island stays quiet"], default: "Keep" }) === "Keep (default): the island stays quiet · Go back" &&
    optionsText({ options: ["A", "B"], default: "B" }, " / ") === "A / B (default)" && optionsText({}) === "")
  check("decision files: a list kept is read as given, anything else is none; a link's page by its wikilink",
    listOf(["a", "b"]).join() === "a,b" && listOf(null).length === 0 && listOf("a").length === 0 &&
    linkTo("[[Inbox/Fix done · A|the fix]]") === "Inbox/Fix done · A" && linkTo(" Inbox/B.md ") === "Inbox/B.md")
}
