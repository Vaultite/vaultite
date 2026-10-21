// Chrome's extension APIs Electron lacks, in extensions' own pages and workers (a session preload: elsewhere it does
// nothing). Sandboxed CommonJS; extapi.ts answers. Content scripts it can't reach: storageShim is written for them.

/** chrome.storage's sync and managed areas, which Electron refuses: sync is kept in the local area under a prefix,
 *  hidden from what the local area shows. Self-contained: it's also written into each extension (extensions.ts). */
function storageShim() {
  const s = globalThis.chrome && globalThis.chrome.storage
  if (!s || !s.local || s.__vaultite) return
  const P = "__vaultite_sync__:", local = s.local, changed = s.onChanged
  const own = (k) => typeof k === "string" && k.startsWith(P)
  const pick = (o, sync) => {
    const out = {}
    for (const k of Object.keys(o || {})) if (own(k) === sync) out[sync ? k.slice(P.length) : k] = o[k]
    return out
  }
  // Callback or promise, as Chrome's own.
  const both = (fn) => (...args) => {
    const cb = typeof args[args.length - 1] === "function" ? args.pop() : null
    const p = Promise.resolve().then(() => fn(...args))
    if (!cb) return p
    p.then((v) => cb(v), (e) => { console.error(e); cb() })
  }
  const keysOf = (keys) => (keys == null ? null : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys))
  const defaults = (keys) => (keys && typeof keys === "object" && !Array.isArray(keys) ? keys : {})
  const event = (filter) => {
    const wrapped = new Map()
    return {
      addListener(fn) {
        if (wrapped.has(fn)) return
        const w = (changes, area) => { for (const [c, a] of filter(changes, area)) if (Object.keys(c).length) fn(c, a) }
        wrapped.set(fn, w)
        changed.addListener(w)
      },
      removeListener(fn) { const w = wrapped.get(fn); if (w) { changed.removeListener(w); wrapped.delete(fn) } },
      hasListener: (fn) => wrapped.has(fn),
      hasListeners: () => wrapped.size > 0,
    }
  }
  const sync = {
    QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512, MAX_WRITE_OPERATIONS_PER_HOUR: 1800, MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
    get: both(async (keys) => {
      const ks = keysOf(keys)
      const got = await local.get(ks ? ks.map((k) => P + k) : null)
      return { ...defaults(keys), ...pick(got, true) }
    }),
    getKeys: both(async () => Object.keys(pick(await local.get(null), true))),
    set: both((items) => local.set(Object.fromEntries(Object.entries(items || {}).map(([k, v]) => [P + k, v])))),
    remove: both((keys) => local.remove((keysOf(keys) || []).map((k) => P + k))),
    clear: both(async () => local.remove(Object.keys(await local.get(null)).filter(own))),
    getBytesInUse: both(async (keys) => {
      const got = pick(await local.get(null), true), ks = keysOf(keys)
      return JSON.stringify(ks ? Object.fromEntries(ks.filter((k) => k in got).map((k) => [k, got[k]])) : got).length
    }),
    setAccessLevel: both(() => {}),
    onChanged: event((c, area) => (area === "local" ? [[pick(c, true), "sync"]] : [])),
  }
  const localArea = {
    QUOTA_BYTES: local.QUOTA_BYTES || 10485760,
    get: both(async (keys) => (keys == null ? pick(await local.get(null), false) : local.get(keys))),
    getKeys: both(async () => Object.keys(pick(await local.get(null), false))),
    set: both((items) => local.set(items)),
    remove: both((keys) => local.remove(keys)),
    clear: both(async () => local.remove(Object.keys(await local.get(null)).filter((k) => !own(k)))),
    getBytesInUse: both((keys) => local.getBytesInUse(keys)),
    setAccessLevel: both((o) => local.setAccessLevel && local.setAccessLevel(o)),
    onChanged: event((c, area) => (area === "local" ? [[pick(c, false), "local"]] : [])),
  }
  const managed = { get: both(async (keys) => ({ ...defaults(keys) })), getBytesInUse: both(() => 0), onChanged: event(() => []) }
  const storage = {
    __vaultite: true, local: localArea, sync, managed,
    onChanged: event((c, area) => (area === "local" ? [[pick(c, false), "local"], [pick(c, true), "sync"]] : [[c, area]])),
  }
  // Into Chromium's own object, which `browser` shares: it puts that back on `chrome` as any extension loads.
  for (const [k, v] of Object.entries(storage)) Object.defineProperty(s, k, { value: v, enumerable: k !== "__vaultite", configurable: true, writable: true })
}

/** The APIs, in the extension's own world: `bridge` reaches extapi.ts. */
function extensionApis(bridge) {
  const chrome = globalThis.chrome
  if (!chrome || !chrome.runtime || !chrome.runtime.id) return
  const manifest = chrome.runtime.getManifest()
  const listeners = new Map()
  bridge.onEvent((name, args) => {
    for (const fn of [...(listeners.get(name) || [])]) { try { fn(...args) } catch (e) { console.error(e) } }
  })
  class Ev {
    constructor(name) { this.name = name }
    addListener(fn) {
      let set = listeners.get(this.name)
      if (!set) { set = new Set(); listeners.set(this.name, set); bridge.listen(this.name) }
      set.add(fn)
    }
    removeListener(fn) { listeners.get(this.name)?.delete(fn) }
    hasListener(fn) { return !!listeners.get(this.name)?.has(fn) }
    hasListeners() { return !!listeners.get(this.name)?.size }
  }
  const call = (name, prep) => (...args) => {
    const cb = typeof args[args.length - 1] === "function" ? args.pop() : null
    const p = Promise.resolve(prep ? prep(...args) : args).then((a) => bridge.call(name, a))
    if (!cb) return p
    p.then((v) => cb(v), (e) => { console.error(e); cb() })
  }
  /** An icon's pictures (ImageData) as PNG bytes, which IPC carries; paths stay paths. */
  const icon = async (details) => {
    const png = async (img) => {
      const c = new OffscreenCanvas(img.width, img.height)
      c.getContext("2d").putImageData(img, 0, 0)
      return new Uint8Array(await (await c.convertToBlob()).arrayBuffer())
    }
    const d = { ...details }
    if (d.imageData) {
      const all = typeof ImageData !== "undefined" && d.imageData instanceof ImageData ? { 32: d.imageData } : d.imageData
      d.imageData = Object.fromEntries(await Promise.all(Object.entries(all).map(async ([k, v]) => [k, await png(v)])))
    }
    return [d]
  }
  const set = (obj, props) => {
    for (const [k, v] of Object.entries(props)) {
      try { Object.defineProperty(obj, k, { value: v, enumerable: true, configurable: true, writable: true }) } catch { /* left as Electron has it */ }
    }
    return obj
  }
  // On `chrome` and Chromium's own `browser` (another object; its APIs mostly the same ones), into the API's own object
  // when it has one: Chromium puts its objects back on `chrome` as any extension loads, but keeps what's in them.
  const roots = [chrome, globalThis.browser].filter((r, i, all) => r && typeof r === "object" && all.indexOf(r) === i)
  const api = (name, props) => {
    let made = null
    for (const root of roots) {
      const had = root[name] && typeof root[name] === "object" ? root[name] : null
      if (!had) set(root, { [name]: (made ??= {}) })
      set(root[name], props)
    }
  }

  const action = {
    setTitle: call("action.setTitle"), getTitle: call("action.getTitle"), setIcon: call("action.setIcon", icon),
    setBadgeText: call("action.setBadgeText"), getBadgeText: call("action.getBadgeText"),
    setBadgeBackgroundColor: call("action.setBadgeBackgroundColor"), getBadgeBackgroundColor: call("action.getBadgeBackgroundColor"),
    setBadgeTextColor: call("action.setBadgeTextColor"), getBadgeTextColor: call("action.getBadgeTextColor"),
    setPopup: call("action.setPopup"), getPopup: call("action.getPopup"),
    enable: call("action.enable"), disable: call("action.disable"), isEnabled: call("action.isEnabled"),
    getUserSettings: call("action.getUserSettings"), openPopup: call("action.openPopup"),
    onClicked: new Ev("action.onClicked"), onUserSettingsChanged: new Ev("action.onUserSettingsChanged"),
  }
  api(manifest.manifest_version >= 3 ? "action" : "browserAction", action)
  api("tabs", {
    create: call("tabs.create"), query: call("tabs.query"), get: call("tabs.get"), getCurrent: call("tabs.getCurrent"),
    update: call("tabs.update"), remove: call("tabs.remove"), highlight: call("tabs.highlight"),
    onCreated: new Ev("tabs.onCreated"), onUpdated: new Ev("tabs.onUpdated"), onRemoved: new Ev("tabs.onRemoved"),
    onActivated: new Ev("tabs.onActivated"), onReplaced: new Ev("tabs.onReplaced"), onHighlighted: new Ev("tabs.onHighlighted"),
    TAB_ID_NONE: -1,
  })
  api("windows", {
    WINDOW_ID_NONE: -1, WINDOW_ID_CURRENT: -2,
    get: call("windows.get"), getAll: call("windows.getAll"), getCurrent: call("windows.getCurrent"), getLastFocused: call("windows.getLastFocused"),
    create: call("windows.create"), update: call("windows.update"), remove: call("windows.remove"),
    onCreated: new Ev("windows.onCreated"), onRemoved: new Ev("windows.onRemoved"), onFocusChanged: new Ev("windows.onFocusChanged"),
    onBoundsChanged: new Ev("windows.onBoundsChanged"),
  })
  api("permissions", {
    contains: call("permissions.contains"), getAll: call("permissions.getAll"), request: call("permissions.request"), remove: call("permissions.remove"),
    onAdded: new Ev("permissions.onAdded"), onRemoved: new Ev("permissions.onRemoved"),
  })
  api("webNavigation", {
    getFrame: call("webNavigation.getFrame"), getAllFrames: call("webNavigation.getAllFrames"),
    ...Object.fromEntries(["onBeforeNavigate", "onCommitted", "onDOMContentLoaded", "onCompleted", "onErrorOccurred", "onHistoryStateUpdated",
      "onReferenceFragmentUpdated", "onCreatedNavigationTarget", "onTabReplaced"].map((e) => [e, new Ev(`webNavigation.${e}`)])),
  })
  // Menus of its own in pages' context menus aren't drawn: what makes them answers, so the rest goes on.
  let menuId = 0
  const menus = {
    create: (props, cb) => { const id = props?.id ?? ++menuId; if (typeof cb === "function") queueMicrotask(cb); return id },
    update: call("contextMenus.noop"), remove: call("contextMenus.noop"), removeAll: call("contextMenus.noop"), onClicked: new Ev("contextMenus.onClicked"),
    ContextType: { ALL: "all", PAGE: "page", FRAME: "frame", SELECTION: "selection", LINK: "link", EDITABLE: "editable", IMAGE: "image", VIDEO: "video", AUDIO: "audio", ACTION: "action" },
  }
  if (manifest.permissions?.includes("contextMenus") || manifest.optional_permissions?.includes("contextMenus")) { api("contextMenus", menus); api("menus", menus) }
  api("commands", { getAll: call("commands.getAll"), onCommand: new Ev("commands.onCommand") })
  api("fontSettings", { getFontList: call("fontSettings.getFontList") })
  api("cookies", {
    get: call("cookies.get"), getAll: call("cookies.getAll"), set: call("cookies.set"), remove: call("cookies.remove"),
    getAllCookieStores: call("cookies.getAllCookieStores"), onChanged: new Ev("cookies.onChanged"),
  })
  // A hidden page of its own (extapi.ts): what MV3 extensions use for the DOM their worker lacks.
  api("offscreen", {
    createDocument: call("offscreen.createDocument"), closeDocument: call("offscreen.closeDocument"), hasDocument: call("offscreen.hasDocument"),
    Reason: Object.fromEntries(["TESTING", "AUDIO_PLAYBACK", "IFRAME_SCRIPTING", "DOM_SCRAPING", "BLOBS", "DOM_PARSER", "USER_MEDIA", "DISPLAY_MEDIA",
      "WEB_RTC", "CLIPBOARD", "LOCAL_STORAGE", "WORKERS", "BATTERY_STATUS", "MATCH_MEDIA", "GEOLOCATION"].map((r) => [r, r])),
  })
  api("notifications", {
    create: call("notifications.create"), clear: call("notifications.clear"), getAll: call("notifications.getAll"), update: call("notifications.update"),
    getPermissionLevel: call("notifications.getPermissionLevel"), onClicked: new Ev("notifications.onClicked"), onClosed: new Ev("notifications.onClosed"),
    onButtonClicked: new Ev("notifications.onButtonClicked"),
  })
  // Native messaging (a password manager's app): a port whose messages go through extapi.ts to the app it names.
  const connectNative = (app) => {
    const onMessage = new Set(), onDisconnect = new Set()
    let id = "", open = true
    const pending = []
    const port = {
      name: app,
      onMessage: { addListener: (fn) => onMessage.add(fn), removeListener: (fn) => onMessage.delete(fn), hasListener: (fn) => onMessage.has(fn) },
      onDisconnect: { addListener: (fn) => onDisconnect.add(fn), removeListener: (fn) => onDisconnect.delete(fn), hasListener: (fn) => onDisconnect.has(fn) },
      postMessage: (m) => { if (!open) throw new Error("Attempting to use a disconnected port object"); if (id) bridge.call("runtime.nativePost", [id, m]); else pending.push(m) },
      disconnect: () => { if (!open) return; open = false; if (id) bridge.call("runtime.nativeClose", [id]) },
    }
    const ev = new Ev(`native.${Math.random().toString(36).slice(2)}`)
    ev.addListener((kind, m) => {
      if (kind === "message") for (const fn of [...onMessage]) fn(m, port)
      else if (open) { open = false; for (const fn of [...onDisconnect]) fn(port) }
    })
    bridge.call("runtime.connectNative", [app, ev.name]).then((got) => {
      id = got
      for (const m of pending.splice(0)) bridge.call("runtime.nativePost", [id, m])
      if (!open) bridge.call("runtime.nativeClose", [id])
    }, () => { if (open) { open = false; for (const fn of [...onDisconnect]) fn(port) } })
    return port
  }
  api("runtime", {
    openOptionsPage: call("runtime.openOptionsPage"), connectNative, sendNativeMessage: call("runtime.sendNativeMessage"),
    setUninstallURL: call("runtime.noop"),
    // (Electron never sends these: extapi.ts does, as each session first loads the extension)
    onInstalled: new Ev("runtime.onInstalled"), onStartup: new Ev("runtime.onStartup"),
  })
  if (chrome.extension) {
    set(chrome.extension, { isAllowedIncognitoAccess: call("runtime.false"), isAllowedFileSchemeAccess: call("runtime.false"), inIncognitoContext: false })
    if (!chrome.extension.getURL) set(chrome.extension, { getURL: (p) => chrome.runtime.getURL(p) })
  }
  // chrome.webRequest: Electron's gets no events beside the engine's listeners, so extwebrequest.ts relays them here,
  // to each listener by its id; a blocking one's answer goes back by the request's.
  const perms = manifest.permissions || []
  if (perms.includes("webRequest")) {
    const worker = typeof ServiceWorkerGlobalScope !== "undefined" && globalThis instanceof ServiceWorkerGlobalScope
    // (a worker's ids are the same each time it starts: the listeners the engine kept reach the new one)
    const prefix = worker ? "w" : Math.random().toString(36).slice(2), counts = {}, mine = new Map()
    const reply = (rid, r) => { bridge.call("webRequest.reply", [rid, r && typeof r === "object" ? r : null]).catch(() => {}) }
    listeners.set("vaultite.webRequest", new Set([(lid, d, rid) => {
      const l = mine.get(lid)
      // (one this page or worker no longer has: the engine drops it)
      if (!l) { if (rid) reply(rid, null); bridge.call("webRequest.removeListener", [lid]).catch(() => {}); return }
      for (const x of d.requestBody?.raw || []) if (x.bytes) x.bytes = x.bytes.buffer.slice(x.bytes.byteOffset, x.bytes.byteOffset + x.bytes.byteLength)
      if (!rid) return l.fn(d)
      let sent = false
      const once = (r) => { if (!sent) { sent = true; reply(rid, r) } }
      try {
        const r = l.async ? l.fn(d, once) : l.fn(d)
        if (r && typeof r.then === "function") r.then(once, (e) => { console.error(e); once(null) })
        else if (!l.async) once(r)
      } catch (e) { console.error(e); once(null) }
    }]))
    const event = (name) => {
      const has = (fn) => [...mine.values()].some((l) => l.name === name && (!fn || l.fn === fn))
      return {
        addListener(fn, filter, spec) {
          if (typeof fn !== "function" || !filter || !Array.isArray(filter.urls)) throw new TypeError(`webRequest.${name}.addListener needs a function and a filter with urls`)
          if (has(fn)) return
          const specs = Array.isArray(spec) ? spec.map(String) : []
          const blocking = specs.includes("blocking") || specs.includes("asyncBlocking")
          if (blocking && !((manifest.manifest_version < 3 && perms.includes("webRequestBlocking")) || (name === "onAuthRequired" && perms.includes("webRequestAuthProvider")))) {
            throw new Error("You do not have permission to use blocking webRequest listeners. Be sure to declare the webRequestBlocking permission in your manifest.")
          }
          const lid = `${prefix}:${name}:${(counts[name] = (counts[name] || 0) + 1)}`
          mine.set(lid, { fn, name, async: specs.includes("asyncBlocking") })
          const f = { urls: filter.urls.map(String), types: Array.isArray(filter.types) ? filter.types.map(String) : undefined, tabId: filter.tabId, windowId: filter.windowId }
          bridge.call("webRequest.addListener", [name, lid, f, specs]).catch((e) => console.error(e))
        },
        removeListener(fn) {
          for (const [lid, l] of mine) if (l.name === name && l.fn === fn) { mine.delete(lid); bridge.call("webRequest.removeListener", [lid]).catch(() => {}) }
        },
        hasListener: (fn) => has(fn),
        hasListeners: () => has(),
      }
    }
    const names = ["onBeforeRequest", "onBeforeSendHeaders", "onSendHeaders", "onHeadersReceived", "onAuthRequired", "onResponseStarted", "onBeforeRedirect",
      "onCompleted", "onErrorOccurred"]
    const values = (...xs) => Object.fromEntries(xs.map((x) => [x.toUpperCase().replace(/([a-z])([A-Z])/g, "$1_$2"), x]))
    const webRequest = {
      ...Object.fromEntries(names.map((n) => [n, event(n)])),
      handlerBehaviorChanged: call("runtime.noop"), MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES: 20,
      ResourceType: Object.fromEntries(["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media",
        "websocket", "webbundle", "other"].map((t) => [t.toUpperCase(), t])),
      OnBeforeRequestOptions: values("blocking", "requestBody", "extraHeaders"),
      OnBeforeSendHeadersOptions: values("requestHeaders", "blocking", "extraHeaders"),
      OnSendHeadersOptions: values("requestHeaders", "extraHeaders"),
      OnHeadersReceivedOptions: values("blocking", "responseHeaders", "extraHeaders"),
      OnAuthRequiredOptions: values("responseHeaders", "blocking", "asyncBlocking", "extraHeaders"),
      OnResponseStartedOptions: values("responseHeaders", "extraHeaders"),
      OnBeforeRedirectOptions: values("responseHeaders", "extraHeaders"),
      OnCompletedOptions: values("responseHeaders", "extraHeaders"),
      OnErrorOccurredOptions: values("extraHeaders"),
    }
    api("webRequest", webRequest)
  }
  // Content scripts it adds itself get the storage shim first too, as the manifest's do (extstore.ts).
  const SHIM = "vaultite/content.js"
  const shimmed = (s) => (s && s.world !== "MAIN" && Array.isArray(s.js) && s.js.length && s.js[0] !== SHIM ? { ...s, js: [SHIM, ...s.js] } : s)
  const sc = chrome.scripting
  if (sc?.registerContentScripts) {
    const reg = sc.registerContentScripts.bind(sc), upd = sc.updateContentScripts.bind(sc), exe = sc.executeScript.bind(sc)
    const promised = (fn) => (arg, cb) => { const p = fn(arg); if (typeof cb !== "function") return p; p.then(cb, (e) => { console.error(e); cb() }) }
    set(sc, {
      registerContentScripts: promised((list) => reg((list || []).map(shimmed))),
      updateContentScripts: promised((list) => upd((list || []).map(shimmed))),
      executeScript: promised(async (inj) => {
        if (inj && inj.world !== "MAIN" && !inj.files?.includes(SHIM)) await exe({ target: inj.target, files: [SHIM], injectImmediately: inj.injectImmediately }).catch(() => {})
        return exe(inj)
      }),
    })
  }
}

if (process.type === "browser") module.exports = { storageShim }
else {
  const { contextBridge, ipcRenderer } = require("electron")
  // (a worker's preload has no location: extapi.ts tells its scope. Sites' own workers get this preload too, and must
  // be left alone: one whose world is touched stalls its pages for half a minute)
  const where = process.type === "service-worker" ? String(ipcRenderer.sendSync("vaultite:ext:scope") ?? "") : location.href
  if (where.startsWith("chrome-extension:")) extension(contextBridge, ipcRenderer)
}

function extension(contextBridge, ipcRenderer) {
  const bridge = {
    call: (name, args) => ipcRenderer.invoke("vaultite:ext", name, args),
    listen: (name) => ipcRenderer.send("vaultite:ext:listen", name),
    onEvent: (fn) => { ipcRenderer.on("vaultite:ext:event", (_e, name, args) => fn(name, args)) },
  }
  try {
    // (an MV2 background page has no isolation: this world is its own)
    if (!process.contextIsolated) { storageShim(); extensionApis(bridge) }
    else {
      contextBridge.executeInMainWorld({ func: storageShim })
      contextBridge.executeInMainWorld({ func: extensionApis, args: [bridge] })
    }
  } catch (e) { console.error("vaultite: an extension's APIs couldn't be added", e) }
}
