// Block an element, in the page (picker.ts runs this in an isolated world: the page's scripts never see it). The element
// under the pointer is outlined; a click picks it; Wider and Narrower (↑ ↓) walk to its parent and back; what its
// selector matches is hidden as a preview, the selector editable. Answers { selector } (Block, Enter) or null (Esc).
// `at`: a point (CSS px) whose element starts picked (the page's right-click menu, Block element).
function picker({ site, at }) {
  globalThis.__vaultitePicker?.cancel()
  return new Promise((resolve) => {
    const doc = document, root = doc.documentElement

    // ---------- stable selectors: a custom element's name, an id, a semantic attribute; never a generated class ----------

    const STATE = /^(active|selected|focus|focused|hover|hovered|open|opened|show|shown|hidden|visible|invisible|disabled|enabled|expanded|collapsed|loaded|loading|current|checked|sticky|fixed|animated|animating|fade|in|out|ng-\w+)$|^(is|has)[-_]|--/i
    const GENERIC = /^(style-scope|x-scope|notranslate|clearfix|container|wrapper|wrap|inner|outer|content|row|col|flex|grid|block|inline|relative|absolute|clickable)$/i
    /** A class or id written by a person, not made by a tool (css-modules' `title__a1b2c`, `css-1x2y3z`, `x1n2onr6`). */
    function stable(t) {
      if (!t || t.length < 2 || t.length > 48 || !/^[a-zA-Z][\w-]*$/.test(t)) return false
      if (/\d{3,}/.test(t) || (t.match(/\d/g)?.length ?? 0) > 2) return false
      if (/^(css|sc|jsx|jss|emotion|styled|svelte|astro|tw|chakra|mui|ember|react|ng|v|r)[-_]/i.test(t) && /\d|[A-Z]{2}/.test(t)) return false
      if (/__[\w-]{5,}$/.test(t) && /\d/.test(t)) return false
      if (/\d/.test(t) && !/[-_]/.test(t)) return false
      if (!/[-_]/.test(t) && t.length <= 8 && /[A-Z].*[A-Z]/.test(t)) return false
      return true
    }
    const q = (s) => `"${s.replace(/["\\]/g, "\\$&")}"`
    const TEST = ["data-testid", "data-test-id", "data-test", "data-qa", "data-cy", "data-component"]
    const ROLES = /^(banner|complementary|contentinfo|dialog|alertdialog|navigation|search|region|feed|form|log|marquee|status|toolbar|tooltip)$/
    const LANDMARKS = /^(aside|nav|header|footer|dialog|iframe|form|section|article|video|figure)$/

    /** An element's own selector, and how much it says alone: 3 a custom element or an id, 2 a semantic attribute or
     *  stable classes, 1 only its tag. */
    function seg(el) {
      const tag = el.localName, custom = tag.includes("-")
      if (el.id && stable(el.id) && !STATE.test(el.id)) return { text: `${custom ? tag : ""}#${CSS.escape(el.id)}`, score: 3 }
      for (const a of TEST) {
        const v = el.getAttribute(a)
        if (v && v.length <= 60 && !/\d{4,}/.test(v)) return { text: `[${a}=${q(v)}]`, score: 3 }
      }
      if (custom) {
        // (flags that name a kind, `[is-shorts]`; not ones that say where it is or what state it's in)
        const flags = [...el.attributes].filter((a) => /^is-[a-z-]+$/.test(a.name) && a.value === "" && !/first|last|column|row|index|empty|active|selected|hover|focus|load|render|visible|hidden|dismiss|expand|collapse|open/.test(a.name))
        return { text: tag + flags.slice(0, 1).map((a) => `[${a.name}]`).join(""), score: 3 }
      }
      if (tag === "iframe") {
        try { const h = new URL(el.src).hostname; if (h) return { text: `iframe[src*=${q(h)}]`, score: 3 } } catch { /* no address */ }
      }
      const role = el.getAttribute("role")
      if (role && ROLES.test(role)) return { text: `${LANDMARKS.test(tag) ? tag : ""}[role=${q(role)}]`, score: 2 }
      const scoped = new Set()
      for (let a = el.parentElement; a; a = a.parentElement) if (a.localName.includes("-")) scoped.add(a.localName)
      const classes = [...el.classList].filter((c) => stable(c) && !STATE.test(c) && !GENERIC.test(c) && !scoped.has(c)).slice(0, 2)
      if (classes.length) return { text: tag + classes.map((c) => `.${CSS.escape(c)}`).join(""), score: 2 }
      const label = el.getAttribute("aria-label")
      if (label && label.length <= 40 && !/\d{2,}/.test(label)) return { text: `${tag}[aria-label=${q(label)}]`, score: 2 }
      return { text: tag, score: LANDMARKS.test(tag) ? 2 : 1 }
    }
    const count = (sel) => { try { return doc.querySelectorAll(sel).length } catch { return -1 } }
    const top = (el) => !el || el === root || el === doc.body || el === doc.head

    /** A selector for `el` that lasts: its own when that says enough, else under the nearest ancestor that does. */
    function selectorFor(el) {
      const s = seg(el)
      let sel = s.text
      if (s.score < 3 && !(s.score === 2 && count(sel) <= 3)) {
        let anchored = ""
        for (let a = el.parentElement, i = 0; !top(a) && i < 10; a = a.parentElement, i++) {
          const as = seg(a)
          if (as.score === 3) { anchored = `${as.text} ${sel}`; break }
        }
        if (!anchored) {
          // No landmark above: its place under its nearest parents.
          const chain = [sel]
          for (let a = el.parentElement, i = 0; !top(a) && i < 3; a = a.parentElement, i++) chain.unshift(seg(a).text)
          anchored = chain.join(" > ")
        }
        sel = anchored
      }
      try { if (el.matches(sel)) return sel } catch { /* falls back below */ }
      return pathOf(el)
    }
    function pathOf(el) {
      const parts = []
      for (let e = el; !top(e); e = e.parentElement) {
        const same = [...(e.parentElement?.children ?? [])].filter((x) => x.localName === e.localName)
        parts.unshift(same.length > 1 ? `${e.localName}:nth-of-type(${same.indexOf(e) + 1})` : e.localName)
      }
      return parts.join(" > ") || el.localName
    }

    // ---------- what's picked ----------

    const boxOf = (el) => el.getBoundingClientRect()
    const sameBox = (a, b) => { const x = boxOf(a), y = boxOf(b); return Math.abs(x.left - y.left) < 2 && Math.abs(x.top - y.top) < 2 && Math.abs(x.width - y.width) < 2 && Math.abs(x.height - y.height) < 2 }
    /** Of an element and the wrappers drawn exactly over it, the one whose selector says most (the outermost, on a tie). */
    function best(el) {
      let pick = el, score = seg(el).score
      for (let a = el.parentElement, i = 0; !top(a) && i < 6 && sameBox(a, el); a = a.parentElement, i++) {
        const s = seg(a).score
        if (s >= score) { pick = a; score = s }
      }
      return pick
    }
    /** The outermost of the wrappers drawn exactly over `el`. */
    function outer(el) {
      let o = el
      while (!top(o.parentElement) && sameBox(o.parentElement, o)) o = o.parentElement
      return o
    }
    let host = null, x = 0, y = 0
    const under = (px, py) => doc.elementsFromPoint(px, py).find((e) => e !== host && !top(e)) ?? null

    let hovered = null, picked = null, selector = "", trail = [], previewing = true

    // ---------- the overlay: outlines, and a panel (in a closed shadow root, styled through the CSSOM: no page CSP) ----------

    host = doc.createElement("vaultite-picker")
    host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block;"
    const shadow = host.attachShadow({ mode: "closed" })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(`
      :host { all: initial; }
      * { box-sizing: border-box; }
      .catch { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; background: transparent; }
      .box { position: fixed; pointer-events: none; border-radius: 3px; outline: 2px solid rgba(10, 132, 255, 0.95); outline-offset: -1px;
        background: rgba(10, 132, 255, 0.12); transition: all 60ms ease-out; }
      .box.next { outline: 1.5px dashed rgba(10, 132, 255, 0.7); background: transparent; }
      .panel { position: fixed; right: 16px; bottom: 16px; width: 380px; max-width: calc(100vw - 32px); pointer-events: auto;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1d1d1f;
        background: rgba(252, 252, 253, 0.97); border: 0.5px solid rgba(0, 0, 0, 0.14); border-radius: 12px;
        box-shadow: 0 10px 36px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.08); padding: 12px; -webkit-font-smoothing: antialiased; }
      .panel.left { right: auto; left: 16px; }
      .head { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
      .head span { flex: 1; }
      .sub { margin-top: 4px; color: rgba(60, 60, 67, 0.75); }
      input { margin-top: 10px; width: 100%; height: 30px; padding: 0 8px; border-radius: 6px; border: 0.5px solid rgba(0, 0, 0, 0.18);
        background: rgba(0, 0, 0, 0.04); color: inherit; font: 12px/1 ui-monospace, "SF Mono", Menlo, monospace; outline: none; }
      input:focus { background: #fff; border-color: rgba(10, 132, 255, 0.8); box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.18); }
      .status { margin-top: 6px; min-height: 18px; color: rgba(60, 60, 67, 0.75); font-size: 12px; }
      .status.bad { color: #d70015; }
      .row { display: flex; align-items: center; gap: 4px; margin-top: 10px; }
      .row .grow { flex: 1; }
      button { all: unset; box-sizing: border-box; height: 26px; padding: 0 9px; border-radius: 6px; cursor: pointer; font: 12px/26px inherit;
        font-family: inherit; color: inherit; white-space: nowrap; }
      button:hover { background: rgba(0, 0, 0, 0.06); }
      button:disabled { opacity: 0.4; cursor: default; background: transparent; }
      button[aria-pressed="true"] { background: rgba(0, 0, 0, 0.08); }
      button.main { background: #0a84ff; color: #fff; font-weight: 500; }
      button.main:hover { background: #0077ed; }
      button.main:disabled { background: #0a84ff; }
      kbd { font: 11px ui-monospace, "SF Mono", Menlo, monospace; opacity: 0.6; margin-left: 4px; }
      @media (prefers-color-scheme: dark) {
        .panel { color: #f5f5f7; background: rgba(40, 40, 44, 0.97); border-color: rgba(255, 255, 255, 0.12); }
        .sub, .status { color: rgba(235, 235, 245, 0.6); }
        .status.bad { color: #ff6961; }
        input { background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.16); }
        input:focus { background: rgba(0, 0, 0, 0.3); }
        button:hover { background: rgba(255, 255, 255, 0.08); }
        button[aria-pressed="true"] { background: rgba(255, 255, 255, 0.12); }
      }
    `)
    shadow.adoptedStyleSheets = [sheet]
    const el = (tag, props = {}, ...kids) => { const e = doc.createElement(tag); Object.assign(e, props); e.append(...kids); return e }
    const catcher = el("div", { className: "catch" })
    const boxes = el("div")
    const title = el("span", { textContent: "Block an element" })
    const close = el("button", { textContent: "Cancel", title: "Esc" })
    const sub = el("div", { className: "sub", textContent: `Point at what to hide${site ? ` on ${site}` : ""} and click it.` })
    const input = el("input", { spellcheck: false, placeholder: "CSS selector", ariaLabel: "Selector" })
    const status = el("div", { className: "status" })
    const wider = el("button", { title: "The element around it (↑)" }, "Wider", el("kbd", { textContent: "↑" }))
    const narrower = el("button", { title: "Back to a smaller one (↓)" }, "Narrower", el("kbd", { textContent: "↓" }))
    const preview = el("button", { textContent: "Preview", title: "Hide what it matches while you choose" })
    const block = el("button", { className: "main", textContent: "Block" })
    const tools = el("div", { className: "row" }, wider, narrower, preview, el("span", { className: "grow" }), block)
    const panel = el("div", { className: "panel" }, el("div", { className: "head" }, title, close), sub, input, status, tools)
    shadow.append(catcher, boxes, panel)
    root.append(host)

    // ---------- the preview: what the selector matches, hidden (a sheet of the page's, taken off as it ends) ----------

    const hide = new CSSStyleSheet()
    const setHidden = (sel) => {
      try { hide.replaceSync(sel ? `${sel} { display: none !important; }` : "") } catch { /* not a selector */ }
      const has = doc.adoptedStyleSheets.includes(hide)
      if (sel && !has) doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, hide]
      else if (!sel && has) doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== hide)
    }

    /** Outlined: what's pointed at before a pick; after, what the selector matches (unless hidden as a preview), and
     *  dashed, what a click would pick instead. */
    function draw() {
      const want = []
      if (!picked) { if (hovered) want.push([hovered, ""]) }
      else {
        if (!previewing) { try { for (const e of [...doc.querySelectorAll(selector)].slice(0, 200)) want.push([e, ""]) } catch { /* not a selector */ } }
        if (hovered && hovered !== picked) want.push([hovered, "next"])
      }
      while (boxes.children.length > want.length) boxes.lastChild.remove()
      while (boxes.children.length < want.length) boxes.append(el("div"))
      want.forEach(([e, kind], i) => {
        const r = boxOf(e), b = boxes.children[i]
        b.className = kind ? `box ${kind}` : "box"
        b.style.cssText = `left: ${r.left}px; top: ${r.top}px; width: ${r.width}px; height: ${r.height}px;${r.width || r.height ? "" : " display: none;"}`
      })
    }
    let raf = requestAnimationFrame(function frame() { draw(); raf = requestAnimationFrame(frame) })

    function show() {
      const on = !!picked
      input.hidden = status.hidden = tools.hidden = !on
      sub.hidden = on
      if (!on) { setHidden(""); return }
      const n = count(selector)
      const bad = n < 0, none = n === 0
      status.className = bad ? "status bad" : "status"
      status.textContent = bad ? "Not a valid selector" : none ? "Matches nothing on this page"
        : `${previewing ? "Hides" : "Matches"} ${n === 1 ? "1 element" : `${n} elements`}${site ? ` on ${site}` : ""}`
      block.disabled = bad || !selector.trim()
      wider.disabled = top(outer(picked).parentElement)
      preview.setAttribute("aria-pressed", String(previewing))
      setHidden(previewing && !bad ? selector : "")
    }
    function pick(e, keepTrail) {
      picked = e
      if (!keepTrail) trail = []
      selector = selectorFor(e)
      input.value = selector
      show()
    }

    const widen = () => {
      if (!picked) { if (hovered) pick(hovered); else return }
      const up = outer(picked).parentElement
      if (top(up)) return
      trail.push(picked)
      pick(best(up), true)
    }
    const narrow = () => {
      if (!picked) return
      let down = trail.pop()
      if (!down) {
        // The child of it under the pointer, or its first that's drawn.
        const deepest = doc.elementsFromPoint(x, y).find((e) => e !== host && picked.contains(e) && e !== picked)
        let c = deepest
        while (c && c.parentElement !== picked) c = c.parentElement
        down = c ?? [...picked.children].find((k) => { const r = boxOf(k); return r.width > 0 && r.height > 0 })
        if (!down) return
        down = best(down)
        if (down === picked) return
      }
      pick(down, true)
    }

    // ---------- input ----------

    const stop = (e) => { e.stopPropagation(); e.stopImmediatePropagation() }
    catcher.addEventListener("pointermove", (e) => {
      stop(e)
      x = e.clientX; y = e.clientY
      const t = under(x, y)
      hovered = t ? best(t) : null
      // (the panel steps aside from what's being pointed at, when the other side is clear of it)
      const r = panel.getBoundingClientRect(), near = (left) => x > left - 40 && x < left + r.width + 40 && y > r.top - 40 && y < r.bottom + 40
      const otherLeft = panel.classList.contains("left") ? innerWidth - 16 - r.width : 16
      if (!picked && near(r.left) && !near(otherLeft)) panel.classList.toggle("left")
    })
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick", "contextmenu"]) {
      catcher.addEventListener(type, (e) => { e.preventDefault(); stop(e) })
    }
    catcher.addEventListener("click", (e) => {
      e.preventDefault()
      stop(e)
      const t = under(e.clientX, e.clientY)
      if (t) pick(best(t))
    })
    catcher.addEventListener("wheel", (e) => {
      // (scrolls what's under the pointer: the page itself scrolls past the overlay)
      let s = under(e.clientX, e.clientY)
      while (s && !top(s) && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll|overlay)/.test(getComputedStyle(s).overflowY))) s = s.parentElement
      if (s && !top(s)) { s.scrollBy(e.deltaX, e.deltaY); e.preventDefault() }
    }, { passive: false })
    const scrolled = () => { const t = under(x, y); hovered = t ? best(t) : null }
    addEventListener("scroll", scrolled, { capture: true, passive: true })

    input.addEventListener("input", () => { selector = input.value.trim(); show() })
    close.addEventListener("click", () => end(null))
    wider.addEventListener("click", widen)
    narrower.addEventListener("click", narrow)
    preview.addEventListener("click", () => { previewing = !previewing; show() })
    block.addEventListener("click", () => { if (!block.disabled) end({ selector }) })
    for (const type of ["keydown", "keyup", "keypress", "pointerdown", "mousedown", "click", "wheel"]) panel.addEventListener(type, stop)

    const keys = (e) => {
      const inPanel = e.composedPath().includes(host)
      const typing = inPanel && e.composedPath()[0] === input
      if (e.type !== "keydown") { if (inPanel || ["Escape", "ArrowUp", "ArrowDown", "Enter"].includes(e.key)) stop(e); return }
      if (e.key === "Escape") { e.preventDefault(); stop(e); return end(null) }
      if (e.key === "Enter" && picked && (typing || !inPanel)) { e.preventDefault(); stop(e); if (!block.disabled) end({ selector }); return }
      if (!typing && (e.key === "ArrowUp" || e.key === "ArrowDown") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); stop(e)
        return e.key === "ArrowUp" ? widen() : narrow()
      }
      if (inPanel) stop(e)
    }
    for (const type of ["keydown", "keyup", "keypress"]) addEventListener(type, keys, true)

    let done = false
    function end(answer) {
      if (done) return
      done = true
      cancelAnimationFrame(raf)
      for (const type of ["keydown", "keyup", "keypress"]) removeEventListener(type, keys, true)
      removeEventListener("scroll", scrolled, { capture: true })
      host.remove()
      // (kept a moment when blocked: the rule reaches the page's own styles as the app saves it, with no flash between)
      if (answer) setTimeout(() => setHidden(""), 2000)
      else setHidden("")
      delete globalThis.__vaultitePicker
      resolve(answer)
    }
    // (`state`: what QA reads, web/qa/elements.mjs)
    globalThis.__vaultitePicker = { cancel: () => end(null), state: () => ({ picked: !!picked, hovered: !!hovered, selector, status: status.textContent }) }
    const first = at && under(x = at.x, y = at.y)
    if (first) pick(best(first)); else show()
  })
}
