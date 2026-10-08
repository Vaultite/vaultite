## Tags
A file's tags are its frontmatter `tags` (a list, or text split on commas) and the `#tags` in its text (letters, digits,
`_ - /`, not only digits; not in code, `%%comments%%`, links or URLs). `#project/lighthouse` nests under `#project`. The
Tags panel lists them with counts; a tag opens its files. As JSON: `GET /api/tags` (`[{tag, count}]`, parents counted)
and `GET /api/tags?tag=project` (`[{path, tags}]`, nested ones included).
