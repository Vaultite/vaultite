export const ISLAND_STYLE = `
:root { interpolate-size: allow-keywords }
html, body { background: transparent !important; overflow: hidden }
.island { background: #000; max-width: 440px; overflow: hidden; position: relative;
  transition: width 420ms cubic-bezier(.3, 1.25, .45, 1), border-radius 260ms ease, box-shadow 260ms ease; font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased }
.island-card { position: absolute; width: 360px; display: flex; flex-direction: column; background: #000; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px rgb(0 0 0 / .35);
  animation: island-in 240ms cubic-bezier(.2, .9, .3, 1); font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased }
.island-card-centre { left: 50%; translate: -50% 0 }
.island-line { max-width: 300px; white-space: pre }
.island-wrap { white-space: normal; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden }
.island-chip { font-size: 11.5px; font-weight: 600; line-height: 1; padding: 5px 9px; border-radius: 999px; background: rgb(255 255 255 / .14); color: #fff; cursor: default }
.island-chip:hover { background: rgb(255 255 255 / .24) }
.island-chip-main { background: #fff; color: #000 }
.island-chip-main:hover { background: rgb(255 255 255 / .86) }
.island-chip:disabled { opacity: .4; background: rgb(255 255 255 / .14) }
.island-icon { display: grid; place-items: center; width: 24px; padding: 4px 0 }
.island-fade { animation: island-fade 200ms ease-out }
.island-rows { display: flex; flex-direction: column; gap: 1px; padding-bottom: 4px; flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / .28) transparent; --fade: 22px }
.island-rows > * { flex-shrink: 0 }
.island-rows[data-more="bottom"] { mask-image: linear-gradient(#000 calc(100% - var(--fade)), transparent) }
.island-rows[data-more="top"] { mask-image: linear-gradient(transparent, #000 var(--fade)) }
.island-rows[data-more="top bottom"] { mask-image: linear-gradient(transparent, #000 var(--fade) calc(100% - var(--fade)), transparent) }
.island-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 12px }
.island-row:hover { background: rgb(255 255 255 / .09) }
.island-group { font-size: 11px; font-weight: 600; color: rgb(255 255 255 / .5); padding: 8px 8px 3px }
.island-fold { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: rgb(255 255 255 / .5); padding: 7px 8px; border-radius: 12px; text-align: left; cursor: default }
.island-fold:hover { background: rgb(255 255 255 / .09); color: rgb(255 255 255 / .7) }
.island-chev { display: inline-block; transition: rotate 160ms ease }
.island-foot { flex-shrink: 0; display: flex; align-items: center; gap: 12px; font-size: 12px; color: rgb(255 255 255 / .7); margin: 2px 8px 6px; padding: 8px 6px 2px; border-top: 1px solid rgb(255 255 255 / .1); cursor: default }
.island-foot > button { cursor: default }
.island-foot > button:hover { color: #fff }
.island-dot { display: grid; place-items: center; min-width: 15px; height: 15px; padding: 0 3.5px; border-radius: 99px; font-size: 9.5px; line-height: 1; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.01em }
.island-dot-needs { background: var(--orange); color: #000 }
.island-dot-working { background: oklch(from var(--gray) .46 .05 250); color: rgb(255 255 255 / .88) }
.island-ask { font: 11px/1.45 ui-monospace, "SF Mono", Menlo, monospace; color: rgb(255 255 255 / .85); background: rgb(255 255 255 / .08); border-radius: 8px; padding: 6px 8px; max-height: 96px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere;
  scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / .28) transparent }
/* (the one motion at rest: once, as more come to need them) */
.island-nudge { animation: island-nudge 520ms cubic-bezier(.3, 1.4, .5, 1) }
@keyframes island-nudge { 40% { transform: scale(1.22) } }
@keyframes island-in { from { opacity: 0; transform: translateY(-4px) } }
@keyframes island-fade { from { opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .island-nudge, .island-fade { animation: none } }
`
