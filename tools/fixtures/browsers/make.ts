// Makes the made-up Brave profiles electron/browser/import.ts reads in web/qa/history.mjs (VAULTITE_TEST_BROWSERS):
// a History database with Chrome's tables and transitions, Bookmarks and Local State.   node tools/fixtures/browsers/make.ts
import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"

const root = path.join(import.meta.dirname, "brave")
const chrome = (iso: string) => (Date.parse(iso) + 11_644_473_600_000) * 1000
const LINK = 0, TYPED = 1, BOOKMARK = 2, SUBFRAME = 3, RELOAD = 8, CHAIN_START = 0x10000000, CHAIN_END = 0x20000000

function history(dir: string, urls: [string, string, number][], visits: [number, string, number][]) {
  fs.mkdirSync(dir, { recursive: true })
  fs.rmSync(path.join(dir, "History"), { force: true })
  const db = new DatabaseSync(path.join(dir, "History"))
  db.exec(`CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    INSERT INTO meta VALUES ('version', '70');
    CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL,
      typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL);
    CREATE TABLE visits(id INTEGER PRIMARY KEY AUTOINCREMENT, url INTEGER NOT NULL, visit_time INTEGER NOT NULL, from_visit INTEGER,
      external_referrer_url TEXT, transition INTEGER DEFAULT 0 NOT NULL, segment_id INTEGER, visit_duration INTEGER DEFAULT 0 NOT NULL,
      incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL, opener_visit INTEGER);`)
  const u = db.prepare("INSERT INTO urls (url, title, hidden, last_visit_time) VALUES (?, ?, ?, 0)")
  for (const [url, title, hidden] of urls) u.run(url, title, hidden)
  const v = db.prepare("INSERT INTO visits (url, visit_time, transition) VALUES (?, ?, ?)")
  for (const [url, at, t] of visits) v.run(url, chrome(at), t)
  db.close()
}

// Default: Alice's. 7 visits it shows: the typed ones, a link, a bookmark's, the end of a redirect; not a frame's, a
// reload, a redirect's start, a hidden address or a file.
history(path.join(root, "Default"), [
  ["https://lighthouse.example/", "Lighthouse", 0],
  ["https://lighthouse.example/docs/start", "Getting started · Lighthouse", 0],
  ["https://news.example.org/", "The Harbor News", 0],
  ["https://ads.example.net/frame", "", 0],
  ["http://old.example.org/", "", 0],
  ["https://hidden.example.com/", "Hidden", 1],
  ["file:///Users/alice/notes.txt", "notes.txt", 0],
], [
  [1, "2026-10-01T09:00:00Z", TYPED | CHAIN_START | CHAIN_END],
  [1, "2026-10-02T09:00:00Z", TYPED | CHAIN_START | CHAIN_END],
  [1, "2026-10-03T09:00:00Z", TYPED | CHAIN_START | CHAIN_END],
  [2, "2026-10-03T09:05:00Z", LINK | CHAIN_START | CHAIN_END],
  [3, "2026-10-04T18:30:00Z", BOOKMARK | CHAIN_START | CHAIN_END],
  [4, "2026-10-04T18:30:01Z", SUBFRAME],
  [3, "2026-10-04T18:31:00Z", RELOAD | CHAIN_START | CHAIN_END],
  [5, "2026-10-05T08:00:00Z", TYPED | CHAIN_START],
  [3, "2026-10-05T08:00:01Z", TYPED | CHAIN_END],
  [6, "2026-10-05T08:10:00Z", LINK | CHAIN_START | CHAIN_END],
  [7, "2026-10-05T08:20:00Z", TYPED | CHAIN_START | CHAIN_END],
  [2, "2026-10-06T10:00:00Z", LINK | CHAIN_START | CHAIN_END],
])
fs.writeFileSync(path.join(root, "Default", "Bookmarks"), JSON.stringify({
  checksum: "", version: 1,
  roots: {
    bookmark_bar: { type: "folder", name: "Bookmarks bar", children: [
      { type: "url", name: "Lighthouse", url: "https://lighthouse.example/" },
      { type: "folder", name: "Reading", children: [
        { type: "url", name: "The Harbor News", url: "https://news.example.org/" },
        { type: "url", name: "A local file", url: "file:///Users/alice/notes.txt" },
      ] },
    ] },
    other: { type: "folder", name: "Other bookmarks", children: [{ type: "url", name: "Tide tables", url: "https://tides.example.com/today" }] },
    synced: { type: "folder", name: "Mobile bookmarks", children: [] },
  },
}, null, 2) + "\n")

// Profile 1: Work, history only.
history(path.join(root, "Profile 1"), [["https://tracker.example.com/board", "Board · Tracker", 0]], [[1, "2026-10-07T14:00:00Z", TYPED]])
fs.writeFileSync(path.join(root, "Local State"), JSON.stringify({ profile: { info_cache: { "Default": { name: "Alice" }, "Profile 1": { name: "Work" } } } }, null, 2) + "\n")
