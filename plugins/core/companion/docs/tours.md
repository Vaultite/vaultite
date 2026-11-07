## Tours: walkthroughs the companion plays without the model
A tour is a recorded answer: its words, with the tags the companion already speaks, played a step at a time. Each
step finds its targets again where they are now (anchors), so a tour recorded last week still plays after the app
moved things. Only a step whose target can't be found goes to the model.
```yaml
type: tour
site: claude.ai              # or app: com.figma.Desktop (vaultite: the app itself), as guides say it
anchors:                     # optional, written by tour-save: what tells a target apart beyond its words
  "New chat": {"role": "button", "inside": ["Sidebar"]}
```
```
1. Your chats are down the left [frame "Chats"].
2. Start one here [ring "New chat"]. (wait: click)
3. Type your question [point "Ask anything"]. (wait: type and idle 1s)
4. (do: click "Send")
```
- A step is a numbered line (later lines indented under it): words said in the companion's voice, tags at what they
  name (`[point "…"]`, `[ring "…"]`, `[frame "…"]`, any mark of `draw`), by its words as the screen shows them.
- `(wait: …)` a condition (below); `(do: …)` `click "…"`, `type "…"` (`in "…"`), `press <key>`, `scroll up|down`, `;` between.
- Modes: `show` plays straight through; `guide` (the default) waits at each wait, and for him to do what a `do:` would;
  `do` does the `do:` steps and the clicks guide would wait for, through take-over (his yes first, as act asks).
- While a step is up its marks follow their things (a scroll, a moved window), hiding while one is off screen.
- A target off screen: "scroll down a bit", and the step plays once it shows. One not found: the model plays that
  step (an ask for it), and the tour goes on. A new ask, Esc, or `companion tour --stop` stops it.
- `vau companion tour <note> [--mode show|guide|do] [--wait]` plays one; `companion tour-save "<title>"` saves the last
  answer on screen as one ("save that as a tour"), or `--text` the steps given, to `Guides/<title>.md`.

### Conditions: what to wait for, what to check
`vau companion wait '<condition>'` watches one over time; `vau companion check '<state>'` tests one of the states below once.
- What happens: `click` (`click "Share"`: on the thing saying it), `type` (`type "Message"`: into it), `idle 1s` (nothing
  done or changed), `after 2s`.
- What shows (the ui model's checks, once): `shows "Saved"`, `gone "Loading"`, `expanded "Files"`, `collapsed`,
  `selected tab "Notes"`, `checked`, `focused`, `disabled`, `value textbox "Title" is "…"`, `changed` (since the wait began),
  `not …`; a target as `role "name" in "container"`.
- Joined: `and` binds tighter than `or`; `within 10s` at the end bounds a wait (five minutes otherwise).

### Anchors: things that last
An ask's ids (a3) mean only that ask's list. `vau companion anchor --keep a3` keeps one as k1: its app, role, words,
what it's in and where in its window, found again by those after a scroll, a move or a new label (then the same kind in
the same place), and said gone when it is. `vau companion anchor k1` says where it is now.

### Lessons: teach by showing
"Watch me add a deploy key" (the Talk key) starts a lesson: a chip under the menu bar counts its steps while it
listens hands-free; "that's it" (or the chip's Done) ends it. Each click, typing in a field (its value once still) and
shortcut is a step on the thing it acted on, kept as an anchor (role, words, what it's in, where in its window), so
it plays after the screen moved or relabelled; what they said as they did it is the step's words ("now I open
settings": "Now open settings."). Passwords and what looks like a key are never kept: that step waits for them to type it.
- What it becomes: what they asked for ("make it a skill", "as a tour"), else a tour when they explained what's where,
  else a skill: `Guides/<title>.md`, or `.agents/skills/<name>/SKILL.md` (its steps a tour: `companion tour <it> --mode
  do`). Either is a draft (`status: draft`) till it plays to the end with every step found, then it's kept (`tested:`).
- "Make what I just did a skill" (or a tour): from the timeline's last five minutes, back to a minute's pause; only
  while the setting Keep a timeline is on (else it says so). `vau companion teach [--as skill] [--title …]` does the same.
- A target not there yet (a page still loading) is looked for again a few seconds before the model is asked.
