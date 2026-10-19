import { detect, eligible, type Target } from './detector';
export function manualSelection(onTarget: (target: Target) => void): () => void {
  const host = document.createElement('div');
  host.id = 'autofill-os-manual';
  host.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const panel = document.createElement('div');
  panel.style.cssText = 'font:14px system-ui;background:#312e81;color:white;border-radius:12px;padding:16px;box-shadow:0 6px 24px #0004;';
  panel.setAttribute('role', 'status');
  panel.textContent = 'Autofill OS: click the field where you want the code. Press Escape to cancel. ';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel'; cancel.style.cssText = 'color:white;background:transparent;border:1px solid white;border-radius:6px;padding:4px 8px;';
  panel.append(cancel); shadow.append(panel); document.documentElement.append(host);
  const cleanup = () => {
    clearTimeout(timeout); host.remove(); document.removeEventListener('pointerdown', select, true);
    document.removeEventListener('keydown', escape, true); window.removeEventListener('pagehide', cleanup);
  };
  const select = (event: PointerEvent) => {
    const input = event.composedPath().find(node => node instanceof HTMLInputElement);
    if (!(input instanceof HTMLInputElement) || !eligible(input)) return;
    event.preventDefault(); event.stopPropagation(); cleanup(); input.focus();
    onTarget(detect(input) || { inputs: [input], anchor: input });
  };
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cleanup(); };
  const timeout = setTimeout(cleanup, 30_000);
  cancel.addEventListener('click', cleanup);
  document.addEventListener('pointerdown', select, true); document.addEventListener('keydown', escape, true);
  window.addEventListener('pagehide', cleanup);
  return cleanup;
}
