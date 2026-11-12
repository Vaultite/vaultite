import path from "node:path"
import { pathToFileURL } from "node:url"
import { check } from "../lib.ts"
import { type Any, plugin, type Props, ROOT, WEB } from "./lib.ts"

// ---------- Dictation: said words joined to what's before them (web/src/core/dictation.ts) ----------
{
  const { joinText } = await import(pathToFileURL(path.join(WEB, "..", "..", "core", "dictationtext.ts")).href)
  check("dictation: a space after a word", joinText("Shopping:", "Remember milk") === " Remember milk")
  check("dictation: none at a line's start or after a space", joinText("", "Hello") === "Hello" && joinText("one ", " two") === "two" && joinText("a\n", "b") === "b")
  check("dictation: none before punctuation, nor after an opening bracket", joinText("word", ", then") === ", then" && joinText("(", "aside") === "aside")
  check("dictation: an engine's leading space (Parakeet's words) taken as a word break", joinText("quick", " brown fox") === " brown fox")
  check("dictation: nothing said, nothing typed", joinText("x", "  ") === "")
  const { replacer } = await import(pathToFileURL(path.join(WEB, "..", "..", "core", "dictationtext.ts")).href)
  const swap = (t: string, lines = ["at Claude: @claude"]) => replacer(lines).reduce((x: string, [re, to]: [RegExp, string]) => x.replace(re, to), t)
  check("dictation: a replacement, whatever its case and spacing", swap("At Claude, can you look?") === "@claude, can you look?" && swap("ask at  claude now") === "ask @claude now")
  check("dictation: whole words only, and never twice", swap("chat Claude") === "chat Claude" && swap("@claude") === "@claude" && swap("at Claudette") === "at Claudette")
  check("dictation: a line without its colon is ignored; $ written as is", swap("at Claude", ["nonsense"]) === "at Claude" && swap("five dollars", ["five dollars: $5"]) === "$5")
}

// ---------- The companion's soft cues (web/src/core/cues.ts): an audio context stood in, nothing plays ----------
{
  const { playCue, cueLength, CUE_PEAK } = await import("../../../web/src/core/cues.ts")
  type Ev = [string, number, number]
  const param = (log: Ev[], name: string) => ({ setValueAtTime: (v: number, t: number) => log.push([`${name}=`, v, t]), linearRampToValueAtTime: (v: number, t: number) => log.push([`${name}~`, v, t]),
    exponentialRampToValueAtTime: (v: number, t: number) => log.push([`${name}^`, v, t]) })
  const fake = () => {
    const log: Ev[] = [], stops: number[] = []
    return { log, stops, currentTime: 10, destination: {}, createOscillator: () => ({ type: "", frequency: param(log, "f"), connect() {}, start() {}, stop: (t: number) => stops.push(t) }), createGain: () => ({ gain: param(log, "g"), connect() {} }) }
  }
  for (const name of ["listen", "sent", "answer", "missed"] as const) {
    const c = fake()
    playCue(c, name)
    const gains = c.log.filter((e) => e[0].startsWith("g")), peak = Math.max(...gains.map((e) => e[1])), end = Math.max(...c.stops) - 10
    check(`cues: ${name} is soft and short, rising from silence and fading out (no click)`, peak <= CUE_PEAK && peak > 0 && end <= 0.4 && Math.abs(end - cueLength(name) - 0.02) < 0.001 &&
      gains.filter((e) => e[0] === "g=").every((e) => e[1] === 0) && gains.filter((e) => e[0] === "g^").every((e) => e[1] <= 0.001), { peak, end, gains })
  }
}

// ---------- Dictation into a terminal: a paste on one line, never an Enter (plugins/core/dictation/terminal.ts) ----------
{
  const { terminalTarget, oneLine } = await plugin("dictation/terminal.ts")
  /** A terminal stood in: what its line shows before the cursor (the echo of what's sent, once `echo` is on). */
  const term = (bracketed: boolean, line = "> ") => {
    const sent: string[] = [], shown: string[] = []
    const el = Object.assign(new EventTarget(), { isConnected: true })
    const t = { send: (d: string) => { sent.push(d) }, bracketed: () => bracketed, caret: () => ({ rect: null, before: line }), pending: (w: string) => { shown.push(w) } }
    return { el, sent, shown, target: terminalTarget(el, t), echo: (s: string) => { line += s } }
  }
  const a = term(true)
  a.target.pending("Remember to buy")
  a.target.final("Remember to buy milk\nand bread.\r\n")
  check("dictation in a terminal: words not settled drawn by the terminal, at its cursor", a.shown[0] === "Remember to buy", a.shown)
  check("dictation in a terminal: a settled chunk is a bracketed paste when the program asked, with no Enter, its line breaks spaces",
    a.sent.length === 1 && a.sent[0] === "\x1b[200~Remember to buy milk and bread. \x1b[201~" && !/[\r\n]/.test(a.sent[0]), a.sent)
  check("…and the pending words are cleared as it settles", a.shown.at(-1) === "", a.shown)
  a.target.final("Then call Alice.")
  check("dictation in a terminal: the next chunk follows after a space, before its echo is on screen", a.sent[1] === "\x1b[200~Then call Alice.\x1b[201~", a.sent)
  const b = term(false, "$ ls")
  b.target.final("minus la")
  check("dictation in a terminal: a plain paste when the program didn't ask for brackets, a space after what's on the line", b.sent[0] === " minus la", b.sent)
  b.el.dispatchEvent(new Event("keydown"))
  b.echo(" minus la\u2028")
  b.target.final("now")
  check("dictation in a terminal: after a key there, what's on screen is what it follows", b.sent[1] === "now", b.sent)
  b.target.end()
  check("dictation in a terminal: nothing but words goes in (controls, separators)", oneLine("a\tb\x1bc\u2029d\x7fe") === "a b c d e" && oneLine("one\n\n two") === "one two")
  const c = term(true)
  c.target.final("  \n ")
  check("dictation in a terminal: nothing said, nothing sent", !c.sent.length, c.sent)
}

// ---------- Dictation that learns: a misheard word's fix, in a note, a terminal or a field (core/desktop/dictationlearn.ts) ----------
{
  const { corrections, TypedLine } = await import(pathToFileURL(path.join(ROOT, "core", "desktop", "dictationlearn.ts")).href)
  const fix = (a: string, b: string) => JSON.stringify(corrections(a, b))
  check("learn: one misheard word fixed", fix("We're going to the Olympicos tomorrow", "We're going to the Olimpicos tomorrow") === '[{"word":"Olimpicos","said":"Olympicos"}]')
  check("learn: several words heard for one, and two fixes in a sentence", fix("I couldn't pronounce for saint here", "I couldn't pronounce Vorssaint here") === '[{"word":"Vorssaint","said":"for saint"}]' &&
    fix("can you ask clawed about the tea mux setup", "can you ask Claude about the tmux setup") === '[{"word":"Claude","said":"clawed"},{"word":"tmux","said":"tea mux"}]')
  check("learn: a name that only sounds alike (Kyle for Kaio, Fox for phoXiv)", fix("talk to Kyle", "talk to Kaio") === '[{"word":"Kaio","said":"Kyle"}]' && fix("Fox is up", "phoXiv is up") === '[{"word":"phoXiv","said":"Fox"}]')
  check("learn: a name's capital is a word to learn, a sentence's isn't", fix("open the vaultite app", "open the Vaultite app") === '[{"word":"Vaultite"}]' && fix("hello world", "Hello world") === "[]")
  check("learn: a sentence retyped teaches nothing", fix("I want to go home now", "Let's head back to the house later") === "[]" && fix("The cat sat on the mat and then left", "The dog sat on the rug and then ran") === "[]")
  check("learn: grammar and homophones teach nothing", fix("run the test now", "run the tests now") === "[]" && fix("put it over their", "put it over there") === "[]" && fix("so I go there", "so I went there") === "[]")
  check("learn: words only added or taken out teach nothing", fix("send it", "send it to Alice today") === "[]" && fix("send it to Alice today", "send it") === "[]")
  const type = (said: string, keys: (string | [string, Record<string, boolean>])[]) => {
    const t = new TypedLine(said)
    const named = new Set(["Backspace", "Delete", "Enter", "End", "ArrowLeft", "ArrowRight", "ArrowUp"])
    for (const k of keys) for (const key of typeof k === "string" ? (named.has(k) ? [k] : [...k]) : [k[0]]) t.key({ key, ...(Array.isArray(k) ? k[1] : {}) })
    return t
  }
  const back = type("ask for saint to", ["Backspace", "Backspace", "Backspace", ["Backspace", { altKey: true }], ["Backspace", { altKey: true }], "Vorssaint to"])
  check("learn in a terminal: backspaces and a word retyped, followed key by key", back.text === "ask Vorssaint to" && !back.lost && corrections("ask for saint to", back.text)[0]?.word === "Vorssaint", back)
  const moved = type("ping Matt Bocak today", [["ArrowLeft", { altKey: true }], "ArrowLeft", ["Backspace", { altKey: true }], "Pocock"])
  check("learn in a terminal: the cursor moved back by a word, a word taken out and typed", moved.text === "ping Matt Pocock today" && fix("ping Matt Bocak today", moved.text) === '[{"word":"Pocock","said":"Bocak"}]', moved.text)
  const lost = type("one two", ["ArrowUp"]), past = type("ab", ["Backspace", "Backspace", "Backspace"]), pasted = type("x", [["v", { metaKey: true }]])
  check("learn in a terminal: a key it can't follow, a backspace past the words, a paste: the line isn't known", lost.lost && past.lost && pasted.lost)
  const enter = new TypedLine("hi")
  check("learn in a terminal: Enter ends the line", enter.key({ key: "Enter" }) === false)

  const { readDictionary, addEntry, removeEntry, hintOf } = await plugin("dictation/words.ts")
  const note = "Words I say.\n\n- Vorssaint\n- Olympicos: Olimpicos\n- [ ] not a word\n\nMore notes."
  const d = readDictionary(note)
  check("dictionary: a word a line, or said: written; the rest is the user's", JSON.stringify(d) === '{"words":["Vorssaint"],"replacements":[["Olympicos","Olimpicos"]]}', d)
  const added = addEntry(note, { word: "Kaio" })
  check("dictionary: a word goes after the last one, once, in any case", added.did && added.body.includes("- Olympicos: Olimpicos\n- Kaio\n- [ ]") && !addEntry(added.body, { word: "kaio" }).did, added.body)
  check("dictionary: the first one starts a list", addEntry("", { word: "Vorssaint" }).body === "- Vorssaint\n" && addEntry("Intro", { word: "a", said: "b" }).body === "Intro\n\n- b: a\n")
  const removed = removeEntry(added.body, { word: "Olimpicos", said: "olympicos" })
  check("dictionary: a line taken out, the rest as it was", removed.did && removed.body === "Words I say.\n\n- Vorssaint\n- Kaio\n- [ ] not a word\n\nMore notes." && !removeEntry(removed.body, { word: "Nope" }).did, removed.body)
  check("dictionary: a replacement's hint is what's written when it's words, else what's said", hintOf(["Olympicos", "Olimpicos"]) === "Olimpicos" && hintOf(["at Claude", "@claude"]) === "at Claude")

  // What a fix teaches reaches the dictionary through its ops, said with a toast and its Undo (learning.ts)
  const learnt = { toasts: [] as Any[], calls: [] as [string, Props][], op: async (id: string, p: Props) => { learnt.calls.push([id, p]); return id === "dictation.add" ? { added: { word: p.word, ...(p.said && p.word === "Kaio" ? { said: p.said } : {}) } } : {} } }
  ;(globalThis as Any).__learn = learnt
  const { watchFix } = await plugin("dictation/learning.ts")
  let now = "we met Kyle today"
  const w = watchFix(now, () => now)
  now = "we met Kaio today"
  w.edited(); w.done()
  await new Promise((r) => setTimeout(r, 20))
  const toast = learnt.toasts[0]
  check("learn: a fix adds the word (fixed: the misheard words with it), with a toast to undo it", learnt.calls[0]?.[0] === "dictation.add" && learnt.calls[0][1].fixed === true && learnt.calls[0][1].said === "Kyle" &&
    toast?.[0] === "Added “Kaio” to your dictionary" && toast[1].action.label === "Undo" && toast[1].duration === 6000, { calls: learnt.calls, toast })
  await toast[1].action.run()
  check("learn: Undo takes it out", JSON.stringify(learnt.calls.at(-1)) === '["dictation.remove",{"word":"Kaio","said":"Kyle"}]', learnt.calls)
  learnt.calls.length = 0
  let typing = "ask for saint now"
  const half = watchFix(typing, () => typing)
  typing = "ask Vorss now"; half.edited(); half.done()
  await new Promise((r) => setTimeout(r, 20))
  const unchanged = watchFix("a b", () => "a b"); unchanged.done()
  check("learn: words never changed teach nothing", learnt.calls.every(([, p]) => p.word !== "a"))
  ;(globalThis as Any).__learn = undefined

  // In a note: words dictated keep their place as the user edits around and in them; the next chunk isn't theirs
  const { EditorState } = await import("@codemirror/state")
  const ed = await plugin("dictation/editor.ts")
  const quiet = { edited() {}, done() {} }
  let st = EditorState.create({ doc: "Notes: ", extensions: [ed.saids] })
  st = st.update({ changes: { from: 7, insert: "I like for saint" }, effects: ed.said.of({ from: 7, to: 23, watch: quiet }), userEvent: "input.dictation" }).state
  st = st.update({ changes: { from: 23, insert: " a lot" }, userEvent: "input.dictation" }).state
  const span = () => { const s = (st.field(ed.saids) as { from: number; to: number }[])[0]; return st.sliceDoc(s.from, s.to) }
  check("learn in a note: the next chunk dictated isn't part of the words before it", span() === "I like for saint", span())
  st = st.update({ changes: { from: 14, to: 23, insert: "Vors" }, userEvent: "input.type" }).state
  st = st.update({ changes: { from: 18, insert: "saint" }, userEvent: "input.type" }).state
  st = st.update({ changes: { from: 0, insert: "My " }, userEvent: "input.type" }).state
  check("learn in a note: a word replaced and typed on is read as the fix, an edit elsewhere isn't", span() === "I like Vorssaint" && fix("I like for saint", span()) === '[{"word":"Vorssaint","said":"for saint"}]', span())
}

// ---------- Audio recorder: the transcript under the recording (plugins/core/audio-recorder/transcript.ts) ----------
{
  const t = await import("../../../plugins/core/audio-recorder/transcript.ts")
  const paras = t.paragraphs([{ start: 0, end: 2, text: " Hello there." }, { start: 2.2, end: 4, text: " Second part." }, { start: 7, end: 9, text: " After a pause." }])
  check("transcript: whisper's segments as paragraphs, split at pauses", paras.length === 2 && paras[0] === "Hello there. Second part." && paras[1] === "After a pause.", paras)
  const note = "Intro\n![[Recording 2026-10-01 14.03.12.webm]]\nAfter it\n"
  const once = t.withTranscript(note, "Attachments/Recording 2026-10-01 14.03.12.webm", paras)
  check("transcript: a folded callout right under the embed, a blank line before the text after it",
    once === "Intro\n![[Recording 2026-10-01 14.03.12.webm]]\n> [!quote]- Transcript\n> Hello there. Second part.\n>\n> After a pause.\n\nAfter it\n", once)
  const twice = t.withTranscript(once, "Attachments/Recording 2026-10-01 14.03.12.webm", ["Again."])
  check("transcript: transcribing again replaces it", twice === "Intro\n![[Recording 2026-10-01 14.03.12.webm]]\n> [!quote]- Transcript\n> Again.\n\nAfter it\n", twice)
  const md = t.withTranscript("![](Attachments/memo%201.m4a)\r\n", "Attachments/memo 1.m4a", ["Hi."])
  check("transcript: a Markdown-link embed too, line endings kept", md === "![](Attachments/memo%201.m4a)\r\n> [!quote]- Transcript\r\n> Hi.\r\n", md)
  const none = t.withTranscript("Text\n", "a/memo.m4a", [])
  check("transcript: a note without the embed gets it at the end, and silence says so", none === "Text\n\n![[memo.m4a]]\n> [!quote]- Transcript\n> (Nothing was heard.)\n", none)
  check("transcript: plain output as paragraphs", JSON.stringify(t.textParagraphs("one\ntwo\n\nthree\n")) === '["one two","three"]')
}
