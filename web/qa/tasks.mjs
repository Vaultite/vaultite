// Tasks ticked in a note being edited (live preview's checkboxes, editor/livePreview.ts): a click ticks its own line
// on disk (dash, star, numbered, nested, in a quote, a twin of the same text, the Tasks plugin's fields kept), again
// unticks it ([X] too), Undo puts it back, a line in code has none; one ticked on disk from outside shows ticked at
// once; a finger on a phone ticks too.
// WRITES "Qa tasks": throwaway server only.
//   node web/qa/tasks.mjs <base url> <vault path> [out dir]
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { SHOTS, apiAt, qa, until } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const api = apiAt(B)
const NOTE = "Qa tasks/Lighthouse week.md"
const TEXT = [
  "# Lighthouse week", "",
  "- [ ] Call Alice Park",
  "- [x] Buy rope",
  "* [ ] Paint the door 📅 2026-11-05 🔁 every week",
  "1. [ ] Check the lamp",
  "    - [ ] Clean the lens",
  "> - [ ] Ask about the tide",
  "- [ ] Call Alice Park",
  "- [X] Upper case done", "",
  "```", "- [ ] not a task, in code", "```", "",
].join("\n")
const disk = () => readFileSync(path.join(VAULT, NOTE), "utf8").split("\n").filter((l) => /\[[ xX]\]/.test(l) && !l.includes("in code"))
await api("DELETE", `file?path=${encodeURIComponent("Qa tasks")}`).catch(() => {})
await api("POST", "file", { path: NOTE, text: TEXT })
const lines = () => disk()

async function open(opts) {
  const page = watch(await (await browser.newContext({ colorScheme: "light", ...opts })).newPage())
  await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
  await page.waitForSelector(`article.file-view[data-path="${NOTE}"] input.cm-task`, { timeout: 30000 })
  return page
}
const boxes = (page) => page.locator(`article.file-view[data-path="${NOTE}"] input.cm-task`)
const ticks = (page) => boxes(page).evaluateAll((els) => els.map((e) => e.checked))
/** The task lines on disk, each ticked or not, once they read `want`. */
const settles = (want) => until(() => JSON.stringify(lines().map((l) => /\[[xX]\]/.test(l))) === JSON.stringify(want), 5000)

const page = await open({ viewport: { width: 1280, height: 800 } })
check("each task line has its checkbox, ticked as the file says ([X] too), none in code", JSON.stringify(await ticks(page)) === "[false,true,false,false,false,false,false,true]", await ticks(page))

// Each kind of task, ticked by a click: only its own line changes.
const want = [false, true, false, false, false, false, false, true]
for (const [i, kind] of [[0, "a dash"], [2, "a star, with the Tasks plugin's fields"], [3, "numbered"], [4, "nested"], [5, "in a quote"], [6, "the second of two alike"]]) {
  await boxes(page).nth(i).click()
  want[i] = true
  check(`${kind}: its line is ticked on disk, no other`, !!(await settles(want)), lines())
}
check("...the fields and the text after the box kept", lines()[2] === "* [x] Paint the door 📅 2026-11-05 🔁 every week" && lines()[3] === "1. [x] Check the lamp", lines())
await boxes(page).nth(1).click()
want[1] = false
check("a ticked one clicked: unticked", !!(await settles(want)), lines())
check("...drawn unticked", !!(await until(async () => (await ticks(page))[1] === false, 3000)), await ticks(page))
await page.keyboard.press("ControlOrMeta+z")
want[1] = true
check("Undo ticks it again", !!(await settles(want)), lines())
await boxes(page).nth(7).click()
want[7] = false
check("[X] clicked: unticked", !!(await settles(want)) && lines()[7] === "- [ ] Upper case done", lines())
check("...the code block's line untouched", readFileSync(path.join(VAULT, NOTE), "utf8").includes("```\n- [ ] not a task, in code\n```"))
await page.screenshot({ path: `${OUT}tasks-desktop.png` })

// From outside (an agent writing the file): the open note shows it at once.
writeFileSync(path.join(VAULT, NOTE), TEXT.replace("- [ ] Call Alice Park\n- [x] Buy rope", "- [x] Call Alice Park\n- [ ] Buy rope"))
check("ticked on disk: shown ticked, no reload", !!(await until(async () => JSON.stringify(await ticks(page)) === "[true,false,false,false,false,false,false,true]", 5000)), await ticks(page))

// A phone: a finger's tap ticks it.
const phone = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await boxes(phone).nth(2).tap()
check("phone: a tap ticks it", !!(await settles([true, false, true, false, false, false, false, true])), lines())
check("...and the computer's open note shows it", !!(await until(async () => (await ticks(page))[2] === true, 5000)), await ticks(page))

await api("DELETE", `file?path=${encodeURIComponent("Qa tasks")}`).catch(() => {})
await done()
