## Live answers (```genui, ```chart)
- **```genui** holds an interactive answer in ChatGPT's Intelligent UI markup (DIL), exactly as the model wrote it:
  Markdown with tags (`<box>`, `<row>`, `<grid>`, `<title>`, `<text>`, `<select>`, `<slider>`, `<button>`...),
  `{@body js}` (`DIL.useState`, `useMemo`, `useEffect`), `{expr}`, `{#each list as item, i}`, `{#if}{:else}{/if}`,
  `GenUI.copy` / `openUrl` / `issueNewTurn`, and `<AppBlock bind={{...}}>` with HTML and a script. The app runs it
  sandboxed (no network, no vault) and draws it with its own controls and colours.
  - Save it whole: from its first `{@body}` or tag to its last closing tag, in one fence; the prose around it stays
    Markdown. Never rewrite it as HTML or a separate file, and use a longer fence (````) if it holds ``` itself.
  - Its last line `{@state {...}}` is the app's: the values the user picked (by their useState names). Leave it.
  - Writing one yourself: the same markup; keep it small and data in `{@body}`.
- **```chart** draws a chart from JSON or YAML: `type` (bar, line, area, pie, donut, scatter), `data` as rows
  (`- {month: Jan, sales: 3}`), `x` (the label key; the first text key when left out), `y` (a key or a list; every
  number key when left out), `title`, `stacked`, `unit` (`$`, `%`, `kg`), `height`. Chart.js' `labels` and
  `datasets: [{label, data}]` work too.
- `/api/render` and search read both as text: a genui's prose and labels, a chart's data as a table.
