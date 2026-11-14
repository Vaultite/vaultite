import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, exists, read } = $
  // Web clipper (plugins/core/clipper): an X post's video, asked of video.save (the Videos plugin's, a stand-in here), lands
  // in the clip's own note when its note comes through inbox.add.
  {
    const { readPage, videoOnPage, withVideo, xPost } = await import("../../../plugins/core/clipper/plugin.ts")
    const { parseHTML } = await import("linkedom")

    check("clipper: an X post's address", xPost("https://x.com/alicepark/status/111?s=20")?.id === "111" && xPost("https://mobile.twitter.com/alicepark/status/111/video/1")?.user === "alicepark" &&
      xPost("https://x.com/alicepark") === null && xPost("https://lighthouse.example.com/alicepark/status/111") === null)

    // A post page as X draws it: the post asked for, then a reply.
    const post = (user: string, id: string, text: string, media = "") => `<article data-testid="tweet" role="article"><div data-testid="User-Name">` +
      `<a href="/${user}"><span>${user}</span></a><a href="/${user}/status/${id}"><time datetime="2026-11-03T10:00:00.000Z">Nov 3</time></a></div>` +
      `<div data-testid="tweetText" lang="en"><span>${text}</span></div>${media}</article>`
    const video = (poster = "https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg") => `<div data-testid="tweetPhoto"><div data-testid="videoPlayer">` +
      `<div data-testid="videoComponent"><video preload="auto" src="blob:https://x.com/abc" poster="${poster}"></video></div></div></div>`
    const page = (...posts: string[]) => `<html><head><title>Alice Park on X / X</title></head><body><main><section>${posts.join("")}</section></main></body></html>`
    const has = (html: string, id = "111") => videoOnPage(parseHTML(html).document as unknown as Document, id)
    const withVid = page(post("alicepark", "111", "Lighthouse in nine minutes: how it reads your plants", video()), post("bob", "222", "Great one"))
    check("clipper: the post's own video is seen", has(withVid) === true && (await readPage(withVid, "https://x.com/alicepark/status/111")).video === true)
    check("clipper: a reply's video isn't the post's", has(page(post("alicepark", "111", "Plants"), post("bob", "222", "Mine", video()))) === false)
    check("clipper: nor a quoted post's, nor a GIF", has(page(post("alicepark", "111", "Look", `<div role="link">${video()}</div>`))) === false &&
      has(page(post("alicepark", "111", "Ha", video("https://pbs.twimg.com/tweet_video_thumb/a.jpg")))) === false)
    check("clipper: a page without its post can't say (X's script shell)", has("<html><body><p>JavaScript is not available.</p></body></html>") === null &&
      (await readPage(withVid, "https://lighthouse.example.com/post")).video === null)

    const listed = (await readPage(page(post("alice_park", "111", "Lighthouse wants:\n\n- Water at dawn\n- Sun\n1. Moss\n> said nobody\nsnake_case")), "https://x.com/alice_park/status/111")).markdown
    check("clipper: a post's list and quote lines aren't escaped", ["- Water at dawn", "- Sun", "1. Moss", "> said nobody", "snake_case"].every((l) => listed.split("\n").includes(l)) && !listed.includes("\\"), listed)
    const { unescapeTurndownLists } = await import("../../../plugins/core/clipper/escapes.ts")
    check("clipper: a reply's quoted list too, but not code or text that isn't a list",
      unescapeTurndownLists("> \\- Ferns\n> > \\* Moss\n\\> quoted\n2024\\. a year\n\\-5 degrees\n\\---\n```\n\\- kept\n```\n`a\\_b` c\\_d \\_e") ===
        "> - Ferns\n> > * Moss\n> quoted\n2024\\. a year\n\\-5 degrees\n\\---\n```\n\\- kept\n```\n`a\\_b` c_d \\_e")

    const clipText = "---\ntype: note\nsource: https://x.com/alicepark/status/111\nupdated: '2026-11-01 10:00:00'\n---\n\nLighthouse in nine minutes.\n\n## Replies\n\nGreat one\n"
    const videoBody = "![[Alice Park - Lighthouse in nine minutes.mp4]]\n\nAlice Park, 2026-11-03, 9 minutes.\n\nLighthouse in nine minutes.\n\n## Transcript\n\n**0:00** Hello there"
    const merged = withVideo(clipText, videoBody, "2026-11-04 12:00:00")
    check("clipper: a video's note in its clip: the embed on top, the transcript at the end, its copy of the post left out",
      merged === "---\ntype: note\nsource: https://x.com/alicepark/status/111\nupdated: '2026-11-04 12:00:00'\n---\n\n![[Alice Park - Lighthouse in nine minutes.mp4]]\n\n" +
        "Lighthouse in nine minutes.\n\n## Replies\n\nGreat one\n\n## Transcript\n\n**0:00** Hello there\n", merged)
    check("clipper: the same video again changes nothing", withVideo(merged, videoBody, "2026-11-05 12:00:00") === merged)

    // A stand-in for the Videos plugin's video.save, on the clipper (the catalog has every plugin's ops).
    const clipper = app.plugins.find((p) => p.id === "clipper")!
    const asked: string[] = []
    let fails = false
    const stand = { id: "video.save", summary: "Save a video (a stand-in).", kind: "write" as const, params: { url: { type: "string" as const, required: true } },
      run: (p: Any) => { if (fails) throw new Error("yt-dlp isn't installed"); asked.push(p.url); return { saving: p.url } } }
    clipper.ops.push(stand)
    const made: string[] = []
    const clip = async (body: Any) => { const [s, b] = await api("POST", "clip", body); if (b?.path && !b.existing) made.push(b.path); return [s, b] as [number, Any] }
    const videoNote = async (source: string) => (await app.callOp("inbox.add", { title: "Alice Park - Lighthouse in nine minutes", body: videoBody, tldr: "Alice Park's video, 9 minutes.", source, from: "Videos" })).result as Any
    try {
      const url = "https://x.com/alicepark/status/111"
      let [s, r] = await clip({ url, html: withVid, inbox: true })
      check("clipper: an X post with a video clipped asks video.save for it, and says so", s === 201 && r.video === true && asked.join() === url && r.path.startsWith("Inbox/"), [s, r, asked])
      const before = read(r.path)
      const v = await videoNote(url)
      const now = read(r.path)
      check("clipper: the video's note lands in the clip, not a note of its own", v.path === r.path && !exists("Inbox/Alice Park - Lighthouse in nine minutes.md") &&
        now.includes("\n![[Alice Park - Lighthouse in nine minutes.mp4]]\n\nLighthouse in nine minutes") && now.includes("## Transcript\n\n**0:00** Hello there") &&
        now.includes("from: Web clipper") && !now.includes("Alice Park, 2026-11-03, 9 minutes."), [v, now])
      check("clipper: the clip's own keys stay", before.split("\n").filter((l) => /^(type|status|from|source|tags):/.test(l)).every((l) => now.includes(l)), [before, now])

      ;[s, r] = await clip({ url, html: withVid, update: true })
      const updated = read(r.path)
      check("clipper: update keeps the video and its transcript, and doesn't ask for it again", r.updated && !r.video && asked.length === 1 &&
        updated.includes("![[Alice Park - Lighthouse in nine minutes.mp4]]") && updated.includes("## Transcript"), [r, updated])

      // Into a folder: the video's note goes there too, none in the inbox.
      const url2 = "https://x.com/alicepark/status/333"
      const page2 = page(post("alicepark", "333", "Lighthouse, part two", video()))
      ;[s, r] = await clip({ url: url2, html: page2, folder: "Saved posts" })
      await videoNote(url2)
      check("clipper: a clip in a folder gets its video too", r.video === true && read(r.path).startsWith("---") && read(r.path).includes("![[Alice Park - Lighthouse in nine minutes.mp4]]") &&
        !fs.readdirSync(path.join(VAULT, "Inbox")).some((f) => f.startsWith("Alice Park - Lighthouse")), r)

      ;[s, r] = await clip({ url: "https://x.com/alicepark/status/444", html: page(post("alicepark", "444", "Just words")) })
      check("clipper: a post without a video asks for none", s === 201 && r.video === undefined && asked.length === 2, [r, asked])
      ;[s, r] = await clip({ url: "https://x.com/alicepark/status/555", html: page(post("alicepark", "555", "No video please", video())), video: false })
      check("clipper: video false asks for none", s === 201 && r.video === undefined && asked.length === 2, [r, asked])
      await api("PATCH", "config/plugin/clipper", { videos: false })
      ;[s, r] = await clip({ url: "https://x.com/alicepark/status/666", html: page(post("alicepark", "666", "Setting off", video())) })
      await api("PATCH", "config/plugin/clipper", { videos: null })
      check("clipper: the Save videos setting off asks for none", s === 201 && r.video === undefined && asked.length === 2, [r, asked])
      fails = true
      ;[s, r] = await clip({ url: "https://x.com/alicepark/status/777", html: page(post("alicepark", "777", "It fails", video())) })
      fails = false
      check("clipper: a video that can't be asked for leaves the clip, saying why", s === 201 && !r.video && /yt-dlp/.test(r.videoError), r)
    } finally {
      clipper.ops.splice(clipper.ops.indexOf(stand), 1)
    }
    const [s, r] = await clip({ url: "https://x.com/alicepark/status/888", html: page(post("alicepark", "888", "Nothing saves videos", video())) })
    check("clipper: without a plugin that saves videos, the clip alone", s === 201 && r.video === undefined && !r.videoError, r)
    for (const rel of made) fs.rmSync(path.join(VAULT, rel), { force: true })
    fs.rmSync(path.join(VAULT, "Saved posts"), { recursive: true, force: true })
  }
}
