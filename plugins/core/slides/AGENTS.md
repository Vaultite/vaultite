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

---

![[chart.png]]
```
