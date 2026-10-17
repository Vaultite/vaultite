# Notes for `web/src/components/`

- Settings: the Settings page holds only the app's own; a plugin's options are its settings sheet
  (`PluginSettings.tsx`), which Settings' search also finds. Choices in a sheet unfold in place, no menus.
- A part that fails, fails alone: every tab, panel, header item and sheet draws in a `Guard` (`Guard.tsx`); smaller
  parts use `Catch`.
- Files a plugin draws (`FormatView.tsx`): the text is the only state, `onChange(text)` goes through autosave.
- Sidebars hold only plugins' panels, one model (`core/sidebars.ts`, shared with the CLI and Workspaces). A panel that
  wants room opens as a view, never tabs inside a sidebar. Panel heights go straight onto the boxes, no React render.
- Only a bounded box scrolls: `overflow-y-auto` on a box nothing bounds swallows the wheel. A component that may be
  either takes a prop (FileTree's `scroll`, a panel's `bounded`).
