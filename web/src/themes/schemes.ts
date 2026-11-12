import { LOOK } from "../../../core/look.ts"

export type SchemeInfo = { id: string; name: string; only?: "light" | "dark"; note?: string }

export const DEFAULT_SCHEME = LOOK.scheme

export const schemeId = (id: unknown) => (typeof id === "string" && id ? id : DEFAULT_SCHEME)

export const SCHEMES: SchemeInfo[] = [
  { id: "gruvbox", name: "Gruvbox", note: "The default" },
  { id: "default", name: "Classic", note: "Apple's colours" },
  { id: "catppuccin", name: "Catppuccin", note: "Latte and Mocha" },
  { id: "nord", name: "Nord" },
  { id: "dracula", name: "Dracula", only: "dark" },
  { id: "solarized", name: "Solarized" },
  { id: "tokyo-night", name: "Tokyo Night", note: "Day and Night" },
  { id: "rose-pine", name: "Rosé Pine", note: "Dawn and Main" },
  { id: "everforest", name: "Everforest" },
  { id: "kanagawa", name: "Kanagawa", note: "Lotus and Wave" },
  { id: "one", name: "One", note: "One Light and One Dark" },
  { id: "ayu", name: "Ayu" },
  { id: "github", name: "GitHub" },
  { id: "flexoki", name: "Flexoki" },
  { id: "amethyst", name: "Amethyst" },
  { id: "paper", name: "Paper" },
]
