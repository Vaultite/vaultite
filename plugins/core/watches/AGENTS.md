## Watches
A watch keeps an eye on something for the user, checked by the server, not a model: a check that sees no change (the
same text) wakes no one. A change becomes a moment to the companion (`watch`, with what changed), or an inbox event
when it isn't running. Add them with `vau watches add`, never by hand unless asked.

A file of `type: watch`, in the folder of the setting `folder` (Watches/ by default):
```yaml
type: watch
source: terminal:claude-k3j2h1g0   # note:<path>, terminal:<id>, site:<url>, group:<tab group id>
every: live                        # live (as it changes), or 5m, 2h, 1d
until: "Build succeeded"           # optional: only a change with these words (or a /regular expression/) counts, and the watch ends
status: active                     # active or paused
by: Claude                         # who asked for it
```
Its body says what to do on a hit, in the user's words ("tell me when the order ships"). A terminal is read as its
screen (its new output and its agent's state), a page as its text (in the user's tab showing it, else one opened in
the background), a note as its file. Private notes, sites and containers (the companion's setting `private`) are never
read. Ended ones (their `until` happened) show as done in `vau watches`: remove them, or keep them paused.
