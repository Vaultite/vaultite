export const ACCENTS = new Map<string, string>([
  ['"', "̈"], ["'", "́"], ["`", "̀"], ["^", "̂"], ["~", "̃"], ["=", "̄"], [".", "̇"],
  ["u", "̆"], ["v", "̌"], ["H", "̋"], ["c", "̧"], ["k", "̨"], ["r", "̊"], ["d", "̣"],
  ["b", "̱"], ["t", "͡"], ["G", "̏"], ["U", "̎"],
])

export const SYMBOLS = new Map<string, string>([
  ["ss", "ß"], ["SS", "SS"], ["o", "ø"], ["O", "Ø"], ["ae", "æ"], ["AE", "Æ"], ["oe", "œ"], ["OE", "Œ"], ["aa", "å"],
  ["AA", "Å"], ["l", "ł"], ["L", "Ł"], ["i", "ı"], ["j", "ȷ"], ["dh", "ð"], ["DH", "Ð"], ["th", "þ"], ["TH", "Þ"],
  ["ng", "ŋ"], ["NG", "Ŋ"], ["dj", "đ"], ["DJ", "Đ"], ["textendash", "–"], ["textemdash", "—"], ["ldots", "…"],
  ["dots", "…"], ["textellipsis", "…"], ["textquoteleft", "‘"], ["textquoteright", "’"], ["textquotedblleft", "“"],
  ["textquotedblright", "”"], ["guillemotleft", "«"], ["guillemotright", "»"], ["copyright", "©"], ["textcopyright", "©"],
  ["textregistered", "®"], ["texttrademark", "™"], ["textdegree", "°"], ["S", "§"], ["P", "¶"], ["pounds", "£"],
  ["euro", "€"], ["texteuro", "€"], ["textbackslash", "\\"], ["textasciitilde", "~"], ["textasciicircum", "^"],
  ["textunderscore", "_"], ["textbar", "|"], ["textless", "<"], ["textgreater", ">"], ["textbullet", "•"],
  ["textperiodcentered", "·"], ["textexclamdown", "¡"], ["textquestiondown", "¿"], ["LaTeX", "LaTeX"], ["TeX", "TeX"],
  ["BibTeX", "BibTeX"], ["alpha", "α"], ["beta", "β"], ["gamma", "γ"], ["delta", "δ"], ["epsilon", "ε"], ["lambda", "λ"],
  ["mu", "μ"], ["pi", "π"], ["sigma", "σ"], ["tau", "τ"], ["omega", "ω"], ["Omega", "Ω"], ["times", "×"], ["pm", "±"],
  ["leq", "≤"], ["geq", "≥"], ["neq", "≠"], ["infty", "∞"], ["quad", " "], ["qquad", " "], ["relax", ""],
  ["noopsort", ""], ["newline", " "], ["par", " "], ["break", " "], ["linebreak", " "], ["allowbreak", ""],
])

export const ESCAPES = new Map<string, string>([
  ["&", "&"], ["%", "%"], ["$", "$"], ["_", "_"], ["#", "#"], ["{", "{"], ["}", "}"], [" ", " "], ["\\", " "],
  [",", " "], [";", " "], [":", " "], ["!", ""], ["-", ""], ["/", ""], ["@", ""], ["\n", " "], ["\t", " "],
])

const SMALL_CAPS = (t: string) => `<span style="font-variant:small-caps;">${t}</span>`
const ITALIC = (t: string) => `<i>${t}</i>`
const BOLD = (t: string) => `<b>${t}</b>`
const SAME = (t: string) => t

export const FORMATS = new Map<string, (text: string) => string>([
  ["textit", ITALIC], ["emph", ITALIC], ["textsl", ITALIC], ["mkbibemph", ITALIC], ["mkbibitalic", ITALIC],
  ["textbf", BOLD], ["mkbibbold", BOLD], ["textsc", SMALL_CAPS], ["textsuperscript", (t) => `<sup>${t}</sup>`],
  ["mkbibsuperscript", (t) => `<sup>${t}</sup>`], ["textsubscript", (t) => `<sub>${t}</sub>`],
  ["textup", SAME], ["textrm", SAME], ["textnormal", SAME], ["texttt", SAME], ["textsf", SAME], ["textmd", SAME],
  ["mbox", SAME], ["hbox", SAME], ["text", SAME], ["mathrm", SAME], ["mathit", SAME], ["ensuremath", SAME],
  ["mkbibquote", (t) => `“${t}”`], ["enquote", (t) => `“${t}”`], ["nocase", SAME], ["NoCaseChange", SAME],
])

export const SWITCHES = new Map<string, (text: string) => string>([
  ["it", ITALIC], ["itshape", ITALIC], ["em", ITALIC], ["sl", ITALIC], ["slshape", ITALIC], ["bf", BOLD],
  ["bfseries", BOLD], ["sc", SMALL_CAPS], ["scshape", SMALL_CAPS], ["rm", SAME], ["tt", SAME], ["sf", SAME],
  ["upshape", SAME], ["normalfont", SAME], ["small", SAME], ["footnotesize", SAME], ["large", SAME], ["Large", SAME],
])

export const PUNCTUATION: [string, string][] = [
  ["---", "—"], ["--", "–"], ["``", "“"], ["''", "”"], ["`", "‘"], ["'", "’"], ["~", " "], ["$", ""], ["!`", "¡"], ["?`", "¿"],
]

export const DOTLESS = new Map<string, string>([["ı", "i"], ["ȷ", "j"]])
