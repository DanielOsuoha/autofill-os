export interface Target { inputs: HTMLInputElement[]; anchor: HTMLInputElement }
const allowedTypes = new Set(['text', 'tel', 'number', 'password', '']);
export function focusedElement(): Element | null {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  return focused;
}
export function eligible(input: HTMLInputElement) {
  return allowedTypes.has(input.type) && !input.disabled && !input.readOnly && input.getAttribute('aria-hidden') !== 'true' && input.getClientRects().length > 0;
}
export function detect(input: HTMLInputElement): Target | null {
  if (!eligible(input)) return null;
  const scope = input.getRootNode() as Document | ShadowRoot;
  const labelled = (input.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => scope.getElementById?.(id)?.textContent || '');
  const metadata = [input.name, input.id, input.placeholder, input.getAttribute('aria-label'), input.getAttribute('autocomplete'), ...labelled,
    ...(Array.from(input.labels || []).map(label => label.textContent))].join(' ');
  // Group only adjacent single-character fields in the closest containing group.
  if (input.maxLength === 1) {
    let parent = input.parentElement;
    for (let depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
      const fields = Array.from(parent.querySelectorAll('input')).filter(eligible);
      if (fields.length >= 4 && fields.length <= 8 && fields.every(field => field.maxLength === 1)) return { inputs: fields, anchor: input };
      if (fields.length > 8) break;
    }
  }
  if (input.autocomplete === 'one-time-code' || /otp|code|2fa|verification|pin|token/i.test(metadata)) return { inputs: [input], anchor: input };
  return null;
}
export function observeTargets(onTarget: (target: Target) => void, onLeave: () => void) {
  const inspect = () => {
    const focused = focusedElement();
    if (document.activeElement?.id === 'autofill-os-widget') return;
    if (focused instanceof HTMLInputElement) {
      const target = detect(focused);
      if (target) { onTarget(target); return; }
    }
    onLeave();
  };
  const focus = (event: FocusEvent) => {
    // Shadow-host focus belongs to the widget, and must not dismiss it.
    if (event.composedPath().some(node => node instanceof HTMLElement && node.id === 'autofill-os-widget')) return;
    inspect();
  };
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; inspect(); });
  });
  document.addEventListener('focusin', focus, true);
  const resume = () => { if (!document.hidden) inspect(); };
  window.addEventListener('pageshow', resume);
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', resume);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['autocomplete', 'name', 'id', 'placeholder', 'maxlength', 'disabled', 'readonly', 'aria-label', 'aria-labelledby'] });
  inspect();
  return () => {
    observer.disconnect(); document.removeEventListener('focusin', focus, true);
    window.removeEventListener('pageshow', resume); window.removeEventListener('focus', resume);
    document.removeEventListener('visibilitychange', resume);
  };
}
