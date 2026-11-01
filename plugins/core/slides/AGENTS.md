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
- `note:` or `notes:` at the start of a line: from there to the slide's end are speaker notes, off the slide; the
  notes button shows them beside it. S opens the presenter view, a window of its own with the slide, the next step, the
  notes, a timer and the clock, moving with the presentation both ways (on a phone, with no second window, S shows the
  notes).
- `<!-- slide bg="..." -->` (a colour, an image's address or `[[image.png]]`, with `data-background-opacity`, `-size`,
  `-position`): the slide's background; the text takes a tone that reads on a colour. `<!-- .slide: class="..."
  style="..." -->` styles the slide.
- `<!-- element class="..." style="..." -->` (or `<!-- .element: ... -->`) annotates the element before it, else the
  one it's in. Class `fragment` (and reveal's `fade-out`, `fade-up`, `highlight-red`... with `data-fragment-index`)
  steps it in; list items marked `+` or `1)` come in one at a time.
- `<style>` blocks apply to the whole deck while it's presented, never to the app (`.reveal`, `:root` mean the deck;
  `--r-code-font`, `--r-main-color`, `--r-background-color` count; with a named theme every `--r-*`, over the
  theme's). A `%% comment %%` hides what's in it.
- `<!-- slide template="[[tpl-footer]]" -->` (or frontmatter `defaultTemplate: "[[tpl-footer]]"` for every slide): a
  note whose `<% content %>` is the slide and each `<% name %>` the slide's `::: name` … `:::` block (`<%? name %>`:
  left out when the slide has none). A template can name a template.
- `css: [deck.css]` (a list, or names split by commas; beside the note, else from the vault's root) and a `theme:`
  that's a CSS file (`css/my-theme.css`, also found in `.obsidian/plugins/obsidian-advanced-slides/`) or an https
  address: stylesheets kept to the deck like its `<style>`, before it, shown again when one changes.
- "Export slides as HTML" (the palette, the note's menu) saves the deck as one HTML file that presents itself in any
  browser (keys, clicks, swipes, fragments; S its notes), its images inside it.
- Frontmatter `width` and `height` (960 × 700): the shape of a slide with placed grids, and what their px are of;
  `margin`, `minScale`, `maxScale` (reveal's: 1 is the deck's width) bound how it's scaled; `center: false` puts
  slides at the top.
- Frontmatter: `separator`, `verticalSeparator`, `notesSeparator` (regexes for a line), `bg` (every slide's background),
  `theme` (reveal's and Advanced Slides' by name: `black` (`default`), `white`, `league`, `beige`, `sky`, `night`,
  `serif`, `simple`, `solarized`, `blood`, `moon`, `dracula`, `black-contrast`, `white-contrast`, `consult`,
  `mattropolis`: each its fonts, case and tone in the app's colours, laid out as reveal.js lays it out: every slide the
  deck's `width` × `height`, scaled as a whole, with the theme's text and heading sizes, centred; without one, the
  app's look, its text laid out 720 wide), `showNotes: true` (notes open).
- Layouts: `<split even gap="2" left="2" right="1" wrap="3" no-margin>` puts what's in it side by side (each block, or
  image line, a column); `<grid drag="w h" drop="x y">` (percents of a 960 x 700 slide, px, negative from the right
  and bottom, or `topleft`, `center`, `bottom`...; with `flow`, `align`, `justify-content`, `pad`, `bg`, `border`,
  `animate`, `opacity`, `rotate`, `filter`, `frag`) places a box, the slide then fixed at that shape; an element
  annotation's `drag`/`drop`/`bg` do the same. `::: block` (or `::: <class>`, with an annotation for its style) to
  `:::` is a box. They nest, and what's in them is Markdown, at the box's text size (a `font-size` annotation).
- Transitions as reveal.js draws them: frontmatter `transition` (`none`, `fade`, `slide`, `convex`, `concave`, `zoom`,
  or a pair like `fade-in slide-out`), `transitionSpeed` (`default`, `fast`, `slow`), `backgroundTransition`; per slide
  `<!-- slide data-transition="zoom" data-transition-speed="fast" data-background-transition="fade" -->`. Vertical
  slides move up and down. Off when the system asks for less motion.
- Auto-animate: `<!-- slide data-auto-animate -->` on two consecutive slides (frontmatter `autoAnimate: false` turns
  it off, as in reveal.js): what matches (the same heading or text, image, code, or an element annotation's `data-id`)
  moves from where it was; the rest fades in (`data-auto-animate-duration`, `-easing`, `-id`, `-restart`, `-unmatched`).
- Not drawn: chalkboard, other reveal options.
