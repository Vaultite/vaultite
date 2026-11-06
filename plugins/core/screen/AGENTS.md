## Screen
On a Mac with the desktop app open (its menu-bar helper running), agents can see what the user works on outside
Vaultite, only when there's a reason: they asked (a Talk key held, ⌃⌥: an ask to the companion with the window's text,
the display's picture and what's near the pointer), or you ask.
- `screen.front` (`vau screen`): the app and window in front, name and title only. `screen.text`: a window's
  Accessibility text (never a password field's). `screen.shot`: its picture, a PNG path to read.
- Point there: `vau companion say "This one" --ax a3` (an element the ask listed near the pointer), `--app
  com.apple.Safari --find "Sign in"` (one found by its words), or `--sx/--sy` (screen points: the picture is the screen around
  the pointer at a pixel a point, so a pixel's sx, sy is its x, y plus the picture's top left). The cursor flies there
  over the user's screen (it rides beside their pointer while they talk to it), its words in the box beside it.
- Its voice: an ask by voice (on screen or in a Vaultite window alike) is answered aloud as its say or draw's say is written (the companion's setting `voice`: `auto`, the
  default; `always`, a typed ask too; `off`), in ElevenLabs' voice (`elevenlabs_voice`, Brian) with this machine's ElevenLabs key (`vau voice key`), else Soniox's (`voice_name`, Adrian), else
  this Mac's. Write a say as you'd say it: the answer first, no lists, code or addresses. The Talk key, Esc or moving on
  stop it at once.
- Private apps (`private_apps`, names or bundle ids) are never read, pictured or titled: their calls are refused.
