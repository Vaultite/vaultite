## Slides
Any note can be presented ("Start presentation" in the palette or the note's menu): its body, without frontmatter, is
split into slides at lines of three or more dashes on their own (`---`, not inside code), each drawn as the note reads
(images, embeds, blocks, math, code). A slide of only headings is centred (a title slide). To write a deck, put `---`
between slides, with a blank line before it (a `---` right under a line of text also makes that line a heading when the
note is read):

```
# Launch plan

---

## Why now
- Point one
- Point two

note: what to say here; the slide doesn't show it.

---

<!-- slide bg="#101820" -->
![[chart.png|400]]
```

It reads Obsidian Advanced Slides' syntax, so its decks present as they do there:
- `--` on its own line: a vertical slide, below the one before (↑ ↓ and Space go through every slide, ← → a column at a
  time).
- `note:` or `notes:` at the start of a line: from there to the slide's end are speaker notes, off the slide; S or the
  notes button shows them beside it.
- `<!-- slide bg="..." -->` (a colour, an image's address or `[[image.png]]`, with `data-background-opacity`, `-size`,
  `-position`): the slide's background; the text takes a tone that reads on a colour. `<!-- .slide: class="..."
  style="..." -->` styles the slide.
- `<!-- element class="..." style="..." -->` (or `<!-- .element: ... -->`) annotates the element before it, else the
  one it's in. Class `fragment` (and reveal's `fade-out`, `fade-up`, `highlight-red`... with `data-fragment-index`)
  steps it in; list items marked `+` or `1)` come in one at a time.
- `<style>` blocks apply to the whole deck while it's presented, never to the app (`.reveal`, `:root` mean the deck;
  `--r-code-font`, `--r-main-color` and `--r-background-color` count). A `%% comment %%` hides what's in it.
- Frontmatter: `separator`, `verticalSeparator`, `notesSeparator` (regexes for a line), `bg` (every slide's background),
  `theme` (only light or dark: `black`, `night`... or `white`, `beige`...), `showNotes: true` (notes open).
- Not drawn: `<split>` and `<grid>` layouts and `::: block`s (their content shows in order, without the layout),
  transitions, auto-animate, chalkboard, other reveal options, and HTML export.
