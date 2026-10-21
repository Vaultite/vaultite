// The colours a user names things by (a browser container, a tab group): one palette, each a theme token (index.css),
// so a scheme recolours them all. Shared by the server and the app.
export const COLORS = ["blue", "orange", "green", "red", "purple", "pink", "yellow", "teal", "indigo", "gray"] as const
export type Color = (typeof COLORS)[number]
export const COLOR_NAMES: Record<Color, string> = { blue: "Blue", orange: "Orange", green: "Green", red: "Red", purple: "Purple",
  pink: "Pink", yellow: "Yellow", teal: "Teal", indigo: "Indigo", gray: "Gray" }
export const isColor = (c: unknown): c is Color => typeof c === "string" && (COLORS as readonly string[]).includes(c)
/** The CSS colour of one (an unknown one is gray). */
export const colorVar = (c: string) => `var(--${isColor(c) ? c : "gray"})`
