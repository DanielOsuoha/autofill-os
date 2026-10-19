// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detect } from '../src/content/detector';
import { insertCode } from '../src/content/inject';
beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
});
function input(attrs = '') { document.body.innerHTML = `<input ${attrs}>`; return document.querySelector('input')!; }
describe('field detection and insertion', () => {
  it('recognizes autocomplete and excludes disabled or unrelated fields', () => {
    expect(detect(input('autocomplete="one-time-code"'))).not.toBeNull();
    expect(detect(input('name="verificationCode" disabled'))).toBeNull();
    expect(detect(input('name="email" type="email"'))).toBeNull();
  });
  it('detects split boxes and fills each with bubbling events', () => {
    document.body.innerHTML = `<div>${'<input maxlength="1">'.repeat(6)}</div>`;
    const inputs = [...document.querySelectorAll('input')];
    const target = detect(inputs[2])!;
    expect(target.inputs).toHaveLength(6);
    const listener = vi.fn(); document.body.addEventListener('input', listener);
    insertCode(target, '012345');
    expect(inputs.map(i => i.value).join('')).toBe('012345');
    expect(listener).toHaveBeenCalledTimes(6);
  });
  it('uses the prototype setter, bypassing framework instance tracking', () => {
    const field = input('autocomplete="one-time-code"');
    const trackedSetter = vi.fn(); Object.defineProperty(field, 'value', { configurable: true, set: trackedSetter });
    insertCode({ anchor: field, inputs: [field] }, '001234');
    expect(trackedSetter).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.get!.call(field)).toBe('001234');
  });
  it('rejects a mismatched split code before changing any values', () => {
    document.body.innerHTML = `<div>${'<input maxlength="1">'.repeat(4)}</div>`;
    const fields = [...document.querySelectorAll('input')];
    expect(() => insertCode({ inputs: fields, anchor: fields[0] }, '123456')).toThrow('length');
    expect(fields.every(i => i.value === '')).toBe(true);
  });
});
