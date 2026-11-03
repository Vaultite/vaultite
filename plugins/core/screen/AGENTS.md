## Screen
On a Mac with the desktop app open (its menu-bar helper running), agents can see what the user works on outside
Vaultite, only when there's a reason: they asked (fn with no text field: an ask to the companion with the window's
text and picture), dropped the companion's cursor on a window (a point, then its changes as they settle), or you ask.
- `screen.front` (`vau screen`): the app and window in front, name and title only. `screen.text`: a window's
  Accessibility text (never a password field's). `screen.shot`: its picture, a PNG path to read.
- Point there: `vau companion say "This one" --app com.apple.Safari --find "Sign in"` (the element's frame), or
  `--sx/--sy` (screen points) when Accessibility has nothing; the cursor and bubble show over the user's screen.
- Private apps (`private_apps`, names or bundle ids) are never read, pictured or titled: their calls are refused.
