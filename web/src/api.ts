import { lazy } from "react"
import { isEnabled } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"

// The plugin API: everything a plugin may import ("@vaultite"). Plugins use this, their own folder, and the plugins
// they `require`; never the core's internals (web/src/core, components), so the core can change underneath them.
export {
  addDays, dateText, dow, fmtAgo, fmtDay, fmtLongDay, fmtMin, fmtTime, getStore, iso, mutate, numberText, optimistic, parse, plain,
  range, reload, today, useLive, useStore, useTick, weekStart,
} from "@/core/data"
export { appDevice, del, get, op, patch, post, put } from "@/core/http"
export type { Store } from "@/core/data"

/** What plugins keep in the store, declared by each in a module of its own: `declare
 *  module "@vaultite" { interface PluginState { logs: Log[] } }`; plugins that `require` it import those types. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PluginState {}
export { definePlugin, detailPath } from "@/core/define"
/** The app's version and the plugin API's: a manifest's `minAppVersion` and `apiVersion` are checked against them. */
export { API_VERSION, APP_VERSION } from "../../core/version.ts"
/** What a pinned entry is: a file, a heading in a note ("Notes/Idea.md#Plan"), a search ("search:<query>"). */
export { pinKind, SEARCH as PIN_SEARCH } from "../../core/pins.ts"
export type { AgentDef, AmbientItem, BlockCtx, BrowseEntry, BrowseSource, Conventions, DetailDef, EditorCtx, EditorExtension, FileBarItem, FileCtx, FileHead, FileFormat, FileIcon, FileMark, FileMenuItem, FileRow, FileRowPart, FileView, FormatCtx, NoteTopItem, HeaderItem, HostedPlugin, LinkTarget, NewFile, NewTabCtx, NewTabSection, OpenFile, PageCtx, PageView, PluginCommand, PluginDef, PluginHost, SearchDoc, SettingsSearchEntry, SidebarCtx, SidebarPanel, SidebarSetup, SlashItem, StatusItem, TimelineKind, ViewCtx, ViewDef, WebPageAction, WorkspaceHost, WorkspaceInfo } from "@/core/define"
export { parseTimeline, timelineOf, type Entry as TimelineEntry } from "../../core/timeline.ts"
/** A button opening the form that adds a line to a file's `## Timeline` (made when it has none). */
export { AddToTimeline } from "@/components/Timeline"
export { closeView, createFile, folderOf, freeName, homeOf, isDoc, isHidden, isViewOpen, markNew, openFile, openNew, openingSoon, openView, readFile, settleFile, splitFm, stem } from "@/core/files"
export { currentFile, isDesktop, useFocusedFile, type FocusedFile } from "@/core/workspace"
export { openInSplit } from "@/core/splits"
/** CSV, the vault's tables, parsed the same way everywhere (core/csv.ts, shared with the server). */
export { csvRecords, parseCsv } from "../../core/csv.ts"
/** Moment.js-style dates (core/dates.ts, shared with the server). */
export { formatDate, parseDate, type DateOptions } from "../../core/dates.ts"
export { activeFile, insertOnOwnLine, type ActiveFile } from "@/core/active"
export { choose, type Choice } from "@/components/Chooser"
export { pickIcon } from "@/components/IconPicker"
export { BrandIcon } from "@/core/icons"
// The tabs and splits as a whole (Workspaces keeps one per workspace).
export { getWorkspace as getTabLayout, onWorkspaceChange as onTabLayoutChange, replaceWorkspace as setTabLayout } from "@/core/workspace"
export { type Workspace as TabLayout } from "@/core/layout"
export { startedFresh } from "@/core/workspace"
// Its tabs one by one (the Tabs panel): the layout live, its panes, showing, closing and opening a tab, and what each
// tab shows and its menu, as in its bar.
export { closeTab, newTab, selectTab, useWorkspace as useTabLayout } from "@/core/workspace"
export { leaves as panesOf, type Group as TabGroup, type Tab } from "@/core/layout"
export { dragTab, TABS, tabMenuOf, tabsMenu, useTabLabels, type TabInfo } from "@/components/Tabs"
// Selecting several rows of a list (⌘- and ⇧-click, ⇧↑↓, ⌘A; a phone's Select): one way for every list.
export { clearSelection, rowMenu, selectClick, selectedAttr, selectedIn, selectionFor, selectItem, startSelecting, useSelectable, useSelected, useSelectedKeys, useSelecting, type Selectable } from "@/core/select"
export { SwipeRow, type SwipeAction } from "@/components/SwipeRow"
export { opcodes } from "@/core/merge"
// The one drag primitive: plugins' drop targets (Workspaces' switcher rows take a dragged tab) and things they drag (a
// database view's cards).
export { edgeScroller, startDrag, useDrag, useDropHit, useDropTarget, type DragItem } from "@/core/drag"
export { confirmDialog, type ConfirmOptions } from "@/components/ConfirmDialog"
export { copyText, fileMenu, filesMenu, grouped, linkTo, openItem, pluginFileGroups } from "@/components/FileActions"
export { deleteFile, keepOpen, restoreFile } from "@/core/files"
// "Move file to…": the folder picker, then the move (with Undo); `before` runs once a folder is picked. Or straight
// into a folder (a drop on it), one toast with Undo.
export { askMove, askMoveMany, moveManyInto, treeShownItems } from "@/components/FileTree"
// Recent files: opened lately in the workspace, and changed lately in the vault (a blank tab's sections, the Recent
// files panel).
export { changedFiles, RecentList, useFileIcon, useOpenedFiles, type RecentKind } from "@/components/RecentFiles"
export { agentOfTerminal, agentsOn, iconNamed, useAgents, useEnabled, type Agent } from "@/core/plugins"
export { parseTerminal, type TerminalAgent } from "../../core/terminalids.ts"
// Plugins' colours (--<id>), which an artifact gets too (as --vau-<id>).
export { editorMenuItems, tintNames, webPageActions } from "@/core/plugins"
export { blockFor, fileRowsChanged, kindFolder, pluginById } from "@/core/plugins"
export { besideActive, newNoteFolder } from "@/core/conventions"
// How a file looks where it's listed (its `icon:` and `tint:`, or its plugin's), and pages:
// a file a plugin draws as one (a dashboard) or a page's tab (core/tabs.ts: headOf is the page a tab belongs to).
export { fileAt, headOf, iconOf, isPage, namedIcon, offPlugin, pageOf, tintOf } from "@/core/pages"
// Attachments (a pasted image, a recording): the folder they go in for a note, and saving files there as embeds.
export { attachmentFolder, pasteAttachments } from "@/core/conventions"
export {
  accountsOf, canRunAgents, chooseDefaultPlace, choosePlace, getDefaultPlace, defaultPlaceOf, mintedHere, openAgent, openPlace, openTerminal, places, resolvePlace, setDefaultPlace, terminalId, useDefaultPlace,
  useTerminalAccount, type AgentAccount, type DefaultPlace, type Place,
} from "@/core/agents"
// Your other machines (Machines plugin): their terminals are <id>@<machine>, their API is machines/<machine>/<path>.
export { fetchMachines, machinePath, onMachine, otherMachines, splitMachine, useMachines, type Machine } from "@/core/machines"
// Where the sidebars' setup comes from (.vaultite/sidebars.json, or a plugin that keeps its own: Workspaces).
export { readSidebars, sameSidebars, savedSidebars, setDefaultSidebars, sidebars, sidebarsChanged, useSidebars, vaultSidebars } from "@/core/plugins"
// Show a sidebar panel (its sidebar open, it unfolded): revealPanel, else dockAtEnd puts it at the end of a sidebar.
export { dockAtEnd, revealPanel, sideOf as panelSide } from "@/core/plugins"
// Plugins a plugin runs (Obsidian's, under plugin-compat): listed and drawn like any, their switches its own.
export { hostPlugins, standingIn } from "@/core/plugins"
// The three levels state lives at (the vault, a workspace, a device: core/scope.ts): the current workspace, the ones in
// use, and values a plugin keeps per workspace or per device. Workspaces itself tells the app when they change.
export {
  currentWorkspace, pinInWorkspace, scopedState, subscribeScoped, useScopedState, useWorkspaceVersion, workspaceChanged, workspaceList, workspacePins,
  type Scope,
} from "@/core/scope"
export type { Sidebars } from "@/core/plugins"
// Views' tab titles and icons that follow live data (a terminal's session name): tell the tabs it changed.
export { viewsChanged } from "@/core/plugins"
export { devicePref } from "@/core/prefs"
export { setTextSize, stepTextSize, textSize, useTextSize, useTextSizeWheel, type TextSizeKind } from "@/core/textsize"
export { addKeys, appShortcut, beginKeys, cancelKeys, commandKeys, keyCaps, keyHint, modifiedSteps, runShortcut, typingIn, useCommandKeys, useCommands, usePendingKeys } from "@/core/commands"
export { isLinux, isMac, modKey, revealLabel, showLabel } from "@/core/platform"
export { checklist, commandItems, menuAbove, menuBelow, menuFor, menuShowing, openMenu, type CheckItem, type MenuItem } from "@/components/ContextMenu"
export { onVaultChange, touches, useVaultChange } from "@/core/live"
export { backDetail, openDetail, replaceDetail, scrollPage } from "@/core/nav"
export { backlinks, followLink, mentions, openTag, openWebLink, plainText, resolver, snippet, takeSchemeLink, WIKI, type Target } from "@/core/links"
// Places in files (a heading, a block id) and tags (core/sections.ts, shared with the server).
export { openAt, useOutline, type Heading } from "@/core/anchors"
export { currentEditor, editorOf, selectedText, type OpenEditor } from "@/core/editors"
export { hasTag, headingsOf, tagName, tagsOf, withoutBlocks } from "../../core/sections.ts"
// Archiving (`archived: true` in any file; core/fileprops.ts, shared with the server): is this item (a person, a book:
// the vault marks every kind's items) or frontmatter archived? Lists leave those out.
export { ARCHIVE_DIR, archiveTwin, inArchive, isArchived } from "../../core/fileprops.ts"
// Property types (`.vaultite/types.json`, Obsidian's under it; core/proptypes.ts, shared with the server): a key's
// type across the vault (the store's `propertyTypes`), and a value as its type compares it.
export { PROP_TYPES, typedValue, typeOf as propertyType, type PropType, type PropTypes } from "../../core/proptypes.ts"
export { Markdown, markdownHtml } from "@/components/Markdown"
export { hydrate as hydrateMarkdown, markdownDrawn, onMarkdownDrawn } from "@/core/richmd"
// A whole note drawn read-only, as reading it looks (Slides, Export to PDF).
export { NoteBody } from "@/components/NoteBody"
export { NotePreview, noteFor } from "@/components/NoteEmbed"
// The app's Markdown editor outside a file's view (a canvas's cards): text the caller keeps, or a vault file's body
// saved in place; and any file drawn as `![[file]]` draws it.
export { FileEditor, NoteEditor, type FileEditorProps, type NoteEditorProps } from "@/components/NoteEditor"
export { FileEmbed } from "@/components/FileEmbed"
// The address of a file's bytes (an image's src, a binary format's file; an iPhone photo as JPEG where needed).
export { rawUrl } from "@/components/FileViewers"
export { AmbientButton } from "@/components/Ambient"
export { Badged, Bars, Editable, Empty, FilterField, Group, KV, List, Loading, PageHeader, Panel, Ring, Row, Section, Segmented, SettingRow, SheetHead, Stat, Switch } from "@/components/kit"
// A form in a sheet that isn't saved as you type: closing the sheet with something unsaved asks first.
export { useSheetGuard } from "@/components/DetailSheet"
export { WeeksGrid } from "@/components/WeeksGrid"
// Maps: the base map's look (core/mapstyle.ts), its buttons, and a lazy map of pins (MapLibre loads with it).
export { followMapTheme, MAP_STYLE, mapTheme, restyleMap, type MapTheme } from "@/core/mapstyle"
export { MapControls, type MapButton } from "@/components/MapControls"
export type { MapPin } from "@/components/PinMap"
export const PinMap = lazy(() => import("@/components/PinMap"))
// Blocks: a body in pieces (its blocks, embeds and the Markdown between them), a block's options, a block drawn on its
// own, and who draws one (Dashboards lays a file's blocks out as a grid).
export { BlockView, blockOptions, FileBlocks, segments, type Segment } from "@/components/Blocks"
export { EmbedView } from "@/components/NoteEmbed"
// Remembered heights: a card drawn again starts at the size it had (core/heights.ts), so a page doesn't jump as its
// data comes in.
export { blockHeightKey, holdHeight, textKey, useHeldHeight } from "@/core/heights"
// Something heavy (a map) made only once it comes near the screen.
export { useNearScreen } from "@/core/near"
// A page of cards keeps what's at the top of the screen in place when cards above it change size.
export { keepAnchored } from "@/core/anchor"
export { SortableList } from "@/components/Sortable"
export { haptic, type Haptic } from "@/core/haptics"
// Phones: keys above the on-screen keyboard, and the part of the window it leaves.
export { KeyBar, keyboardUp, useVisibleArea, type BarKey } from "@/components/KeyBar"
export { FilesPanel, PanelFold, panelMenu, SidebarHeading, SidebarRow, SidebarSearch } from "@/components/Sidebar"
export { ActionButtons, AddButton } from "@/components/NewTab"
// The core's pages that panels open as tabs: the file tree (view:files) and the search page.
export { Files as FilesPage } from "@/pages/Files"
export { FilesSettings, filesSettingsSearch } from "@/components/FilesSettings"
// A plugin's settings sheet (components/PluginSettings.tsx), and one setting drawn as its form row.
export { hasSettings, openPluginSettings, settingsFile } from "@/core/pluginSettings"
export { Field as SettingField, usePluginSettings } from "@/components/PluginSettings"
export type { SettingDecl, SettingDecls } from "../../core/blocks.ts"
export { SearchPage } from "@/pages/Search"
// Which pane a view is drawn in (its group's id; "" outside the desktop's panes).
export { usePane } from "@/core/pane"
export { focusPane, holdFocus, keyboardBusy, useHeldFocus } from "@/core/focus"
// Make a pane the focused one (the address, the status bar and commands follow it) without moving the keyboard: a view
// whose keyboard lives outside the page (the web viewer's page) was clicked.
export { focusGroup, isPopout } from "@/core/workspace"
export { offeredCommand, onCommandsChanged, runCommandById, runCommandNamed } from "@/core/commands"
export { useDesktop } from "@/core/workspace"
// Every command and its keys in effect (Vim's list of its keys).
export { commandList, keysOf, useCommandList } from "@/core/commands"
export { currentRow, focusSidebar, foldInList, inKeyList, leaveList, moveInList, openInList } from "@/core/keylist"
// What the user does in the app that no request shows (a command run, a drag and drop): Activity listens.
export { onActivity, type ActivityNote } from "@/core/activity"
/** What the app did, by topic (editor changes, scroll restores, commands, console warnings): add to it, or hear it all. */
export { onTrace, trace, type TraceEvent } from "@/core/trace"
export { onAppError, takeAppErrors, type AppError } from "@/core/errors"
export { dismissNotice, notify, notifyError, type NotifyOptions } from "@/core/notify"
export { cn } from "@/lib/utils"
// A coding agent's usage and sessions (Claude Code, Codex...): the blocks every agent plugin draws, on its own data.
export { AgentLimits, AgentLimitsChip, AgentModels, AgentProject, AgentProjects, AgentSessions, AgentUsageBlock, money, openSession, sessionTitle, tokens } from "@/components/AgentUsage"
export type { AgentSource, AgentUsage, Day as AgentDay, LiveSession as AgentLiveSession, Session as AgentSessionSummary, Share as AgentShare, Window as AgentWindow } from "@/components/AgentUsage"
export { AgentSession, type Entry as AgentEntry, type SessionPage as AgentSessionPage } from "@/components/AgentSession"
export { setProperty } from "@/core/frontmatter"
/** A frontmatter key as a chip in a file's header or the status bar, its values each with a label, an icon and a colour
 *  (Provenance's `origin`, the keys All properties pins), and the editor of those values for a settings sheet. */
export { ChipValuesEditor, chipLabel, chipMenu, chipValues, CHIP_TINTS, PropertyChip, type ChipProps, type ChipValue } from "@/components/PropertyChip"
// The desktop app's own: a PDF of the window as it prints (Export to PDF), and the Mac's microphone permission (Audio
// recorder). In a browser savePdf answers undefined (print instead) and askMicrophone true.
export { askMicrophone, captureWindow, savePdf } from "@/core/desktop"
// The iPhone app's voice note, as its widgets open it (Audio recorder's "Record a voice note"); false in a browser.
export { phoneVoiceNote } from "@/core/phoneapp"
/** Is this plugin on now (and what it requires)? For a `when` that needs another plugin's API (Inbox's ops). */
export const pluginOn = (id: string) => isEnabled(id, getPrefs().disabled)
// The Mac's notifications (the desktop app; null in a browser): the Inbox shows one while the window isn't in front.
export { systemNotify } from "@/core/desktop"
// The Dock's icon (the desktop app; null in a browser): the Dock icon plugin.
export { dockIcon } from "@/core/desktop"
// macOS's Look up and the spell checker (the desktop app; null in a browser): the editor's menu.
export { lookUp, spelling } from "@/core/desktop"
// Web pages laid over a pane (the Web viewer): null in a browser, and in app builds from before it.
export { webPages, type CloudSession, type WebEvent, type WebPageInfo, type WebPages, type WebPageState, type WebSite } from "@/core/desktop"
export { appWindows, type AppEvent, type AppInfo, type AppProblem, type AppWindows } from "@/core/desktop"
// Files saved as attachments where the vault's settings say (pasted or dropped images): their vault paths.
export { saveAttachments } from "@/core/conventions"
