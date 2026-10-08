## Books (`Books/<Title>.md`)
`type: book`, `author`, `status` (want | reading | done | dropped), optional `total_pages`, `current_page`, `started`,
`finished`, `rating` (1-5), then notes (its ```` ```block-book ```` is drawn on top). `POST /api/books`; progress:
`PUT /api/books/<title> {"current_page": 120}`.

````
---
type: book
author: Andy Weir
status: reading
total_pages: 476
current_page: 120
started: 2026-09-27
rating: 4
created: '2026-09-28 05:16:50' # UTC, set by the app
---

Notes about it.
````
The `book` block is drawn on top of every book file; `books` is on the Learning page.
