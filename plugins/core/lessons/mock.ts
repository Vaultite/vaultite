// Made-up lessons and cards for previews.
import type { Deck, Lesson } from "./types.ts"

const lesson = `How a sourdough starter works, in three steps.

## What lives in it
Wild yeast and lactic acid bacteria, fed flour and water.

> [!question] What makes the bread rise?
> - [x] Gas from the yeast
>   - Yeast eats sugars and gives off carbon dioxide.
> - [ ] The acid from the bacteria
>   - The acid gives the sour taste, not the rise.
> - [ ] Steam from the water

## Feeding it
> [!recall] Why discard part of the starter before feeding it?
> So the new flour isn't spread too thin: the same food for fewer microbes keeps it strong.

## Ready to bake
It's ready when it has doubled and a spoonful floats.`

const cards = `## What gas makes bread rise?
Carbon dioxide, from the yeast.

## A starter is ready when it has ==doubled== and a spoonful ==floats==.`

export const mockLessons = () => ({
  lessons: [{ id: "Lessons/Sourdough starters", title: "Sourdough starters", step: 1, steps: 3, source: null, created: null, notes: lesson }] as Lesson[],
  decks: [{ id: "Cards/Baking", title: "Baking", cards: 3, source: null, created: null, notes: cards }] as Deck[],
})
