
export type Tone = "light" | "dark"
export type RevealTheme = { name: string; tone: Tone; vars: Record<string, string> }

const mix = (a: string, b: string, pct: number) => `color-mix(in oklab, ${a} ${100 - pct}%, ${b})`
const T = (t: string) => `var(--${t})`
const TEXT = "var(--font-text, var(--font-sans))"
const GOTHIC = "'League Gothic', 'Bebas Neue', Impact, 'Avenir Next Condensed', 'Arial Narrow', sans-serif"
const SOURCE = `'Source Sans Pro', 'Source Sans 3', ${TEXT}`
const SERIF = "'Palatino Linotype', 'Book Antiqua', Palatino, 'URW Palladio L', ui-serif, Georgia, serif"
const g = (pct: number) => mix(T("gray"), "white", pct)
const EXTRUDE = `0 1px 0 ${g(60)}, 0 2px 0 ${g(56)}, 0 3px 0 ${g(48)}, 0 4px 0 ${g(46)}, 0 5px 0 ${g(36)}, 0 6px 1px rgb(0 0 0 / .1), 0 0 5px rgb(0 0 0 / .1), 0 1px 3px rgb(0 0 0 / .3), 0 3px 5px rgb(0 0 0 / .2), 0 5px 10px rgb(0 0 0 / .25), 0 20px 20px rgb(0 0 0 / .15)`

// reveal.js' heading sizes (em of the text): its template's, black and white's, consult's.
const SIZES = { template: [3.77, 2.11, 1.55, 1, 0.8, 0.6], sans: [2.5, 1.6, 1.3, 1, 0.8, 0.6], consult: [3.75, 1.875, 1.5, 1, 0.75, 0.625] }

type Spec = {
  tone: Tone; bg: string; link: string
  main?: string; heading?: string
  head?: string; upper?: boolean; weight?: number | string; spacing?: string; sizes?: keyof typeof SIZES
  font?: string; size?: number; textWeight?: number
  glow?: number; shadow?: string; lineHeight?: string
  extra?: Record<string, string>
}

const blackish = (pct: number) => mix(T("background"), "black", pct)
const whitish = (pct: number) => mix(T("card"), "white", pct)
const SANS = { head: SOURCE, font: SOURCE, weight: 600, sizes: "sans", size: 42 } as const

const SPECS: Record<string, Spec> = {
  black: { tone: "dark", bg: mix(T("background"), T("card"), 55), link: T("blue"), ...SANS },
  white: { tone: "light", bg: whitish(70), link: T("blue"), ...SANS },
  "black-contrast": { tone: "dark", bg: blackish(85), main: mix(T("foreground"), "white", 70), heading: mix(T("foreground"), "white", 70), link: T("blue"), ...SANS },
  "white-contrast": { tone: "light", bg: "white", main: mix(T("foreground"), "black", 70), heading: mix(T("foreground"), "black", 70), link: T("blue"), ...SANS },
  league: { tone: "dark", bg: mix(T("background"), T("gray"), 20), glow: 24, link: T("teal"), shadow: EXTRUDE, extra: { "--r-heading-text-shadow": "0 0 6px rgb(0 0 0 / .2)" } },
  beige: { tone: "light", bg: mix(T("card"), T("yellow"), 22), glow: 75, link: mix(T("orange"), T("foreground"), 45), shadow: EXTRUDE },
  sky: { tone: "light", bg: mix(T("card"), T("blue"), 30), glow: 85, link: mix(T("blue"), T("foreground"), 25), head: "Quicksand, var(--font-rounded)", spacing: "-0.06em", font: `'Open Sans', ${TEXT}` },
  night: { tone: "dark", bg: blackish(55), link: mix(T("orange"), T("yellow"), 45), head: `Montserrat, 'Avenir Next', Futura, ${TEXT}`, weight: 800, spacing: "-0.03em", upper: false, font: `'Open Sans', ${TEXT}` },
  serif: { tone: "light", bg: mix(T("card"), T("gray"), 12), link: mix(T("orange"), T("foreground"), 70), heading: mix(T("foreground"), T("background"), 18), head: SERIF, font: SERIF, upper: false },
  simple: { tone: "light", bg: whitish(80), link: mix(T("indigo"), T("foreground"), 40), head: `'News Cycle', 'Arial Narrow', 'Helvetica Neue', ${TEXT}`, weight: 700, upper: false, font: `Lato, ${TEXT}` },
  solarized: { tone: "light", bg: mix(T("card"), T("yellow"), 9), main: mix(T("foreground"), T("background"), 22), link: T("blue") },
  moon: { tone: "dark", bg: mix(T("background"), T("blue"), 22), main: mix(T("foreground"), T("background"), 28), link: T("blue") },
  blood: { tone: "dark", bg: mix(T("card"), "black", 25), link: mix(T("red"), "black", 15), head: `Ubuntu, ${TEXT}`, font: `Ubuntu, ${TEXT}`, weight: 700, textWeight: 300,
    extra: { "--r-heading-text-shadow": "2px 2px 2px rgb(0 0 0 / .5)", "--r-selection-background-color": mix(T("red"), "black", 15), "--r-selection-color": "white" } },
  dracula: { tone: "dark", bg: mix(T("card"), T("purple"), 12), heading: T("purple"), link: T("pink"), head: TEXT, weight: 600, upper: false,
    extra: { "--r-bold-color": T("orange"), "--r-italic-color": T("yellow"), "--r-inline-code-color": T("green"), "--r-list-bullet-color": T("teal") } },
  mattropolis: { tone: "dark", bg: mix(T("background"), T("gray"), 20), glow: 24, link: mix(T("orange"), T("yellow"), 45), lineHeight: "1", font: `Lato, ${TEXT}`, size: 24 },
  consult: { tone: "light", bg: mix(T("card"), T("gray"), 20), main: mix(T("foreground"), T("background"), 25), heading: mix(T("foreground"), T("background"), 25), link: T("blue"), head: `Calibri, Carlito, ${TEXT}`, font: `Calibri, Carlito, ${TEXT}`, weight: 600, upper: false, sizes: "consult", size: 16 },
}

export function revealTheme(name: unknown): RevealTheme | null {
  const raw = typeof name === "string" ? name.trim().toLowerCase() : "", key = raw === "default" ? "black" : raw
  const s = Object.hasOwn(SPECS, key) ? SPECS[key] : null
  if (!s) return null
  const sizes = SIZES[s.sizes ?? "template"], weight = String(s.weight ?? "normal")
  const vars: Record<string, string> = {
    "--r-background-color": s.bg,
    "--r-main-font": s.font ?? TEXT,
    "--r-main-font-size": `${s.size ?? 40}px`,
    "--r-main-font-weight": String(s.textWeight ?? "normal"),
    "--r-main-color": s.main ?? T("foreground"),
    "--r-heading-font": s.head ?? GOTHIC,
    "--r-heading-color": s.heading ?? T("foreground"),
    "--r-heading-line-height": s.lineHeight ?? "1.2",
    "--r-heading-letter-spacing": s.spacing ?? "normal",
    "--r-heading-text-transform": s.upper === false ? "none" : "uppercase",
    "--r-heading-text-shadow": "none",
    "--r-heading1-text-shadow": s.shadow ?? "none",
    "--r-heading-margin": "0 0 20px",
    "--r-block-margin": "20px",
    "--r-link-color": s.link,
    "--r-selection-background-color": mix(s.link, "transparent", 55),
    "--r-selection-color": "inherit",
  }
  sizes.forEach((em, i) => { vars[`--r-heading${i + 1}-size`] = `${em}em`; vars[`--r-heading${i + 1}-font-weight`] = weight })
  if (s.glow) vars["--deck-glow"] = `${s.glow}%`
  return { name: key, tone: s.tone, vars: { ...vars, ...s.extra } }
}

export const THEME_NAMES = Object.keys(SPECS)
