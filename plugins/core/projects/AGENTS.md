## Projects (`Projects/<Name>.md`)
`type: project`, `status` (live | building | idea | paused), `tagline`, optional `repo` (`you/lighthouse` on GitHub),
`path` (the checkout on the Mac), `links: [{label, url}]`, `sort`; other plugins' blocks if wanted, then notes: what's
next, decisions. Live numbers (stars, commits) are never written.

````
---
type: project
status: live
tagline: Read-only macOS disk space visualizer
repo: you/lighthouse      # drawn as the GitHub mark after the links (no GitHub link needed)
path: ~/Projects/lighthouse
links:
- {label: lighthouse.app, url: 'https://lighthouse.app'}
sort: 0                     # order on the page; the first gets the full row
---

```block-project
```

Notes: what's next, decisions.
````
Other plugins draw live numbers where the file has their blocks (`vau blocks` lists them). A project's file has its
`project` block's fence (the API writes it in a new one); `projects` is on the Projects page.
