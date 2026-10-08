// Lessons (plugins/core/lessons): a lesson opens one step at a time and keeps where the user is in its `step`; a wrong
// answer still moves on, with its why; a finished lesson's recall question joins the cards; a review rates cards into
// reviews.json; the Learning page's block lists them. Writes a lesson and a cards file: throwaway server only.
//   node web/qa/lessons.mjs <base url> <vault path>
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const file = (rel) => path.join(VAULT, rel)
const read = (rel) => { try { return fs.readFileSync(file(rel), "utf8") } catch { return "" } }
const shot = (page, name) => page.screenshot({ path: path.join(os.tmpdir(), `qa-lessons-${name}.png`) })

fs.mkdirSync(file("Lessons"), { recursive: true })
fs.mkdirSync(file("Cards"), { recursive: true })
fs.writeFileSync(file("Lessons/Starters.md"), `---
type: lesson
---
How a sourdough starter works.

## What lives in it
Wild yeast and bacteria, fed flour and water.

> [!question] What makes the bread rise?
> - [x] Gas from the yeast
>   - Yeast gives off carbon dioxide.
> - [ ] Acid from the bacteria
>   - The acid gives the sour taste, not the rise.
> - [ ] Steam from the water
>   - Steam helps in the oven, but the rise starts before.

## Feeding it
> [!recall] Why discard part of the starter before feeding it?
> So the same food goes to fewer microbes.

Discarding keeps it strong.
`)
fs.writeFileSync(file("Cards/Baking.md"), `---
type: cards
---
## What gas makes bread rise?
Carbon dioxide.

## A starter is ready when it has ==doubled==.
`)
await wait(1500)

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 900 } }))
const text = (t) => page.getByText(t, { exact: false }).first()

await page.goto(`${B}#file/${encodeURIComponent("Lessons/Starters.md")}`)
check("a lesson opens on its first step", await until(async () => await text("1 of 2").isVisible().catch(() => false), 8000))
check("...and the next step is hidden", !(await text("Feeding it").isVisible().catch(() => false)))
await shot(page, "1-first")
await page.getByRole("button", { name: /Acid from the bacteria/ }).click()
check("a wrong answer says so", await until(async () => await text("Not quite.").isVisible(), 8000))
check("...with its why", await text("The acid gives the sour taste").isVisible())
await page.getByRole("button", { name: "Continue" }).click()
check("Continue keeps the step in the file", await until(() => /^step: 1$/m.test(read("Lessons/Starters.md")), 8000))
check("a step that opens on its question is a guess first", await until(async () => await text("Guess first").isVisible(), 8000))
check("...its text hidden until answered", !(await text("Discarding keeps it strong").isVisible().catch(() => false)))
await page.getByRole("button", { name: "Show answer" }).click()
check("...and shown after", await until(async () => await text("Discarding keeps it strong").isVisible(), 8000))
await shot(page, "2-second")
await page.getByRole("button", { name: "Continue" }).click()
check("the last Continue marks it done", await until(() => /^step: 2$/m.test(read("Lessons/Starters.md")), 8000))
check("...and says so", await until(async () => await text("Done: all 2 steps").isVisible(), 8000))
check("...its recall question joins the cards", await text("now in your cards").isVisible())

await page.goto(`${B}#file/${encodeURIComponent("Cards/Baking.md")}`)
check("a cards file lists its cards", await until(async () => await text("2 cards, 2 new").isVisible(), 8000))
await shot(page, "3-cards")
await page.getByRole("button", { name: "Review 2" }).click()
check("Review opens its cards", await until(async () => await text("2 left").isVisible(), 8000))
await page.keyboard.press("Space")
check("Space shows the answer and the ratings", await until(async () => await page.getByRole("button", { name: /^good/i }).isVisible(), 8000))
await shot(page, "4-review")
await page.keyboard.press("3")
check("3 rates it good and moves on", await until(async () => await text("1 left").isVisible(), 8000))
await page.getByRole("button", { name: "Show answer" }).click()
await page.getByRole("button", { name: /^again/i }).click()
check("again brings the card back in the session", await until(async () => await text("1 left").isVisible(), 8000))
await page.keyboard.press("Space")
await page.keyboard.press("4")
check("...until it's rated", await until(async () => await text("Done: 3 reviewed").isVisible(), 8000))
const reviews = JSON.parse(read(".vaultite/plugins/lessons/reviews.json") || "{}")
check("reviews.json has both cards", Object.keys(reviews["Cards/Baking"] ?? {}).length === 2)
check("...and the cards file is unchanged", !read("Cards/Baking.md").includes("due"))

const learning = fs.readdirSync(file("Dashboards")).includes("Learning.md") ? "Dashboards/Learning.md" : null
if (learning) {
  await page.goto(`${B}#file/${encodeURIComponent(learning)}`)
  check("the Learning page's block lists the lesson", await until(async () => await text("Starters").isVisible().catch(() => false), 8000))
  await shot(page, "5-learning")
}

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
fs.writeFileSync(file("Lessons/Starters.md"), read("Lessons/Starters.md").replace(/^step: 2\n/m, ""))
await phone.goto(`${B}#file/${encodeURIComponent("Lessons/Starters.md")}`)
check("on a phone too", await until(async () => await phone.getByText("1 of 2").first().isVisible().catch(() => false), 8000))
await shot(phone, "6-phone")
await done()
