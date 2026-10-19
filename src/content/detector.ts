export interface Target { inputs: HTMLInputElement[]; anchor: HTMLInputElement }
const allowedTypes = new Set(['text', 'tel', 'number', 'password', '']);
export function eligible(input: HTMLInputElement) {
  return allowedTypes.has(input.type) && !input.disabled && !input.readOnly && input.getAttribute('aria-hidden') !== 'true' && input.getClientRects().length > 0;
}
export function detect(input: HTMLInputElement): Target | null {
  if (!eligible(input)) return null;
  const metadata = [input.name, input.id, input.placeholder, input.getAttribute('aria-label'), input.getAttribute('autocomplete'),
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
    const focused = document.activeElement;
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
    requestAnimationFrame(() => { queued = false; if (document.activeElement instanceof HTMLInputElement) inspect(); });
  });
  document.addEventListener('focusin', focus);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['autocomplete', 'name', 'id', 'placeholder', 'maxlength', 'disabled', 'readonly', 'aria-label'] });
  inspect();
  return () => { observer.disconnect(); document.removeEventListener('focusin', focus); };
}
