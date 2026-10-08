## Lessons (`Lessons/<Title>.md`)
A lesson teaches one thing (a note, a PR, a topic) a step at a time: each `## ` heading is a step, shown once the last
one's question is answered. `step` is where the user is: the app keeps it, leave it out.

````
---
type: lesson
source: "[[The note it teaches]]"   # optional: what it's about
---
One or two lines: why this matters to the user.

## A short step title
One idea, 50 to 150 words: prose, a list, code or a mermaid diagram.

> [!question] A question that checks the step was understood?
> - [ ] A plausible wrong answer
>   - Why it's wrong (shown when picked).
> - [x] The right one
>   - Why it's right.
> - [ ] Another plausible wrong answer
>   - Why it's wrong.

## Another step
> [!recall] A question to answer in your head first?
> The answer, shown when they ask. Once the lesson is done, recall questions become cards.

## A process
> [!order] Put these in order
> 1. First
> 2. Second
> 3. Third
> Why this order (after the numbered list).
````

## Cards (`Cards/<Title>.md`)
`type: cards`, optional `source`. Each `## ` heading is a card's prompt and what's under it the answer; a heading with
==highlights== is a cloze card per highlight. What the user remembers is kept by the app (FSRS), never in the file;
changing a prompt makes it a new card.

````
---
type: cards
source: "[[The note it's from]]"
---
## Why does Claude see the vault rules twice?
They come through CLAUDE.md and again in the terminal's appended prompt.

## Dispatch's prompt is in ==.vaultite/plugins/dispatch/data.json==.
````

## Writing them
- Teach from what the user has, tied to it: their note, their PR, their project (link it in `source`).
- Lessons: 4 to 8 steps, each with a question. A step whose question comes before its text opens on a guess (the text
  shows after): a guess before learning helps it stick; use it once or twice. Questions check understanding (why,
  what happens if, which one), never trivia. Code: ask what it does or which change matters.
- Choice: 3 or 4 options, each with a one-line why; wrong ones are real misconceptions of the same length and shape.
  No true or false, "all of the above", trick or negative questions. The app shuffles them.
- Cards: one fact each, a precise question with one short answer (a few words). No lists: one card per item, or a
  cloze. Important ideas from more than one side (why, an example, when to use it). Only what they've already read.
