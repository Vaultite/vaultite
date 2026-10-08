// Pages are files: the app's part is how a file looks where it's listed (`icon`, `tint`) and what makes it a page in
// a tab (a plugin draws it as one, or it's a page's tab). Pinning and dashboards are plugins'.
import {
  AppWindow, Banknote, Calculator, ChartColumn, ChartLine, ChartPie, PiggyBank, Receipt, Sheet,
  Activity, Apple, Bike, BookOpen, Bot, Brain, Briefcase, Gem, Layers, Package, Server, SquareTerminal, CalendarDays, Camera, Code2, Coffee, Compass, Dumbbell, Flag, FolderGit2,
  Footprints, Globe, GraduationCap, Heart, HeartPulse, House, Inbox, Leaf, Lightbulb, ListChecks, LayoutDashboard, Map, Moon,
  Mountain, Music, NotebookText, Palette, PenLine, Plane, Rocket, Sparkles, Star, Sun, Target, Trophy, Users, Wallet,
  Archive, Blend, Check, Circle, CircleCheck, CircleDashed, CircleDot, CircleHelp, CircleX, Clock, Eye, Pencil, TriangleAlert,
  User, UserCheck, X, type LucideIcon,
} from "lucide-react"
import type { ComponentType } from "react"
import { getStore, type Store } from "@/core/data"
import { anyIcon, markIcon } from "@/core/icons"
import type { VaultFile } from "@/core/files"
import { fileViewFor, iconNamed, isEnabled, pluginById } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { tabHead } from "../../../core/tabs.ts"

/** Icons a file can name in its frontmatter (`icon: sun`), lucide names; plugins add their own (`icons` in their
 *  definition: Claude Code's `claude`). */
export const ICONS: Record<string, LucideIcon> = {
  activity: Activity, apple: Apple, bike: Bike, "book-open": BookOpen, book: BookOpen, brain: Brain, briefcase: Briefcase,
  calendar: CalendarDays, "calendar-days": CalendarDays, camera: Camera, code: Code2, coffee: Coffee, compass: Compass,
  dumbbell: Dumbbell, flag: Flag, "folder-git-2": FolderGit2, footprints: Footprints, globe: Globe,
  "graduation-cap": GraduationCap, heart: Heart, "heart-pulse": HeartPulse, house: House, home: House, inbox: Inbox,
  leaf: Leaf, lightbulb: Lightbulb, "list-checks": ListChecks, "layout-dashboard": LayoutDashboard, dashboard: LayoutDashboard,
  map: Map, moon: Moon, mountain: Mountain, music: Music, "notebook-text": NotebookText, palette: Palette, pen: PenLine,
  "pen-line": PenLine, plane: Plane, rocket: Rocket, sparkles: Sparkles, star: Star, sun: Sun, target: Target, trophy: Trophy,
  users: Users, wallet: Wallet, "app-window": AppWindow, banknote: Banknote, calculator: Calculator,
  "chart-column": ChartColumn, "chart-line": ChartLine, "chart-pie": ChartPie, "piggy-bank": PiggyBank, receipt: Receipt, sheet: Sheet,
  bot: Bot, gem: Gem, layers: Layers, package: Package, server: Server, terminal: SquareTerminal,
  archive: Archive, blend: Blend, check: Check, circle: Circle, "circle-check": CircleCheck, "circle-dashed": CircleDashed,
  "circle-dot": CircleDot, "circle-help": CircleHelp, "circle-x": CircleX, clock: Clock, eye: Eye, pencil: Pencil,
  "triangle-alert": TriangleAlert, user: User, "user-check": UserCheck, x: X,
}

/** An icon by its name (`dumbbell`): one of ICONS, one a plugin adds, any other of Lucide's, or an emoji; null for none. */
export const namedIcon = (name?: string | null): LucideIcon | null => {
  const n = name?.trim()
  if (!n) return null
  return ICONS[n.toLowerCase()] ?? iconNamed(n.toLowerCase()) ?? anyIcon(n.toLowerCase())
}

/** A plugin's icon as its manifest says it (core/pluginmeta.ts iconOf): a name, or its SVG mark as a data address. */
export const pluginIcon = (icon?: string | null): LucideIcon | null =>
  icon?.startsWith("data:image/svg+xml,") ? markIcon(icon) : namedIcon(icon)

/** A command's icon (core/commands.ts: a component or a name), or `named` over it (a new tab button's, newtab.json). */
export const commandIcon = (c: { icon?: ComponentType<{ className?: string; strokeWidth?: number }> | string }, named?: string | null): ComponentType<{ className?: string; strokeWidth?: number }> | null =>
  namedIcon(named) ?? (typeof c.icon === "string" ? namedIcon(c.icon) : c.icon ?? null)

/** A file's own icon (its `icon:`), or the icon of the plugin that brought it, or
 *  of the plugin whose kind of file it is (a dashboard's, a person's), or the core's for its own kind (Me), if any. */
export function iconOf(f?: Pick<VaultFile, "icon" | "plugin" | "type" | "path"> | null): LucideIcon | null {
  if (!f) return null
  return namedIcon(f.icon) || (f.plugin && pluginById(f.plugin)?.icon) || fileViewFor(f, getPrefs().disabled)?.view.icon || null
}

/** `tint: people` -> var(--people): a colour token (never a hex, so schemes recolour it). */
export function tintOf(t?: string | null) {
  return t && /^[a-z][a-z-]*$/.test(t) ? `var(--${t})` : undefined
}

/** Left out of lists of pages (the sidebar's, a page's tabs): a page whose plugin (its `plugin:`, the one that brought
 *  it) is off. */
export const offPlugin = (f: Pick<VaultFile, "plugin"> | undefined, disabled = getPrefs().disabled) => !!f?.plugin && !!pluginById(f.plugin) && !isEnabled(f.plugin, disabled)

/** The head of the page `path` is a tab of (core/tabs.ts' tabHead: People for People map), once per file list and path:
 *  it looks tabs up by name through every file, and the app asks on every draw. */
const heads = new WeakMap<VaultFile[], globalThis.Map<string, VaultFile | null>>()
export function headOf(files: VaultFile[], path: string): VaultFile | null {
  let known = heads.get(files)
  if (!known) heads.set(files, (known = new globalThis.Map()))
  if (!known.has(path)) known.set(path, tabHead(files, path) as VaultFile | null)
  return known.get(path)!
}

/** The vault's files by path, once per file list (the sidebar and the tabs ask on every draw). */
const paths = new WeakMap<{ path: string }[], globalThis.Map<string, { path: string }>>()
export function fileAt<F extends { path: string }>(files: F[], path: string): F | undefined {
  let byPath = paths.get(files)
  if (!byPath) paths.set(files, (byPath = new globalThis.Map(files.map((f) => [f.path, f]))))
  return byPath.get(path) as F | undefined
}

/** How the plugin that's on draws this file as a page (FileView.page: a dashboard's grid), or null. */
export function pageView(path: string, store: Store | null = getStore(), disabled = getPrefs().disabled) {
  const f = store ? fileAt(store.files.files, path) : undefined
  return f ? fileViewFor(f, disabled)?.view.page ?? null : null
}

/** A page: a file a plugin draws as one (a dashboard), or one of a page's tabs. In a tab, a file opened from it opens
 *  beside it (core/workspace.ts go()), and a phone's tab list calls it a page. */
export function isPage(path: string, store: Store | null = getStore()) {
  return !!pageView(path, store) || (!!store && !!headOf(store.files.files, path))
}

/** A page a plugin brought, by its file name ("Activity"), wherever the user keeps it (core/pages.ts finds them there
 *  too), or undefined. */
export const pageOf = (store: Store | null | undefined, plugin: string, name: string) =>
  store?.files.files.find((f) => f.plugin === plugin && f.type === "dashboard" && f.path.split("/").pop() === `${name}.md`)
