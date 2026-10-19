import { manualSelection } from './manual';
import { createRoot, type Root } from 'react-dom/client';
import { Widget } from './Widget';
import { eligible, observeTargets, type Target } from './detector';
import styles from '../shared/styles.css?inline';
let host: HTMLDivElement | undefined;
let root: Root | undefined;
let current: Target | undefined;
let dismissed: HTMLInputElement | undefined;
let inserting = false;
let resizeObserver: ResizeObserver | undefined;
function close(dismiss = false) {
  dismissed = dismiss ? current?.anchor : undefined;
  resizeObserver?.disconnect(); resizeObserver = undefined;
  root?.unmount(); host?.remove(); root = undefined; host = undefined; current = undefined;
}
function position() {
  if (!host || !current) return;
  if (!current.anchor.isConnected) { close(); return; }
  const rect = current.anchor.getBoundingClientRect();
  const height = host.getBoundingClientRect().height || 180;
  host.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 336))}px`;
  host.style.top = `${Math.max(8, rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 8 : rect.top - height - 8)}px`;
}
function show(target: Target) {
  if (inserting || (current && target.inputs.length === current.inputs.length && target.inputs.every((input, i) => input === current!.inputs[i]))) return;
  if (dismissed === target.anchor) return;
  close(); dismissed = undefined; current = target;
  host = document.createElement('div'); host.id = 'autofill-os-widget';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; display: block;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style'); style.textContent = styles;
  const mount = document.createElement('div'); shadow.append(style, mount);
  // Retain field focus on pointer interaction; keyboard users can still Tab into the widget.
  host.addEventListener('pointerdown', event => event.preventDefault());
  host.addEventListener('click', () => { inserting = true; queueMicrotask(() => { inserting = false; }); }, true);
  document.documentElement.append(host);
  root = createRoot(mount); root.render(<Widget target={target} onClose={() => close(true)} />);
  position();
  resizeObserver = new ResizeObserver(position); resizeObserver.observe(host);
}
observeTargets(show, () => {
  // A manually selected field may deliberately have no OTP metadata.
  const focused = document.activeElement;
  if (current?.inputs.includes(focused as HTMLInputElement) && focused instanceof HTMLInputElement && eligible(focused)) return;
  if (!inserting) { close(); dismissed = undefined; }
});
window.addEventListener('scroll', position, true);
window.addEventListener('resize', position);
window.addEventListener('pagehide', () => close());
document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });

let cancelManual: (() => void) | undefined;
if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'ARM_MANUAL_SELECTION' && sender?.id === chrome.runtime.id) {
      cancelManual?.(); close();
      cancelManual = manualSelection(target => { dismissed = undefined; show(target); });
      respond({ ok: true });
    }
  });
}
