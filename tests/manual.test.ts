// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { manualSelection } from '../src/content/manual';
beforeEach(() => {
  document.body.innerHTML = '<input id="unusual-field"><input type="email">';
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
});
it('selects an otherwise unrecognized field only after an explicit click', () => {
  const onTarget = vi.fn(); const cleanup = manualSelection(onTarget);
  const input = document.querySelector('input')!;
  expect(onTarget).not.toHaveBeenCalled();
  input.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
  expect(onTarget).toHaveBeenCalledWith({ inputs: [input], anchor: input });
  expect(document.getElementById('autofill-os-manual')).toBeNull(); cleanup();
});
it('cancels selection with Escape', () => {
  const onTarget = vi.fn(); manualSelection(onTarget);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.querySelector('input')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  expect(onTarget).not.toHaveBeenCalled();
});
