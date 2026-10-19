// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detect, focusedElement, observeTargets } from '../src/content/detector';
import { insertCode, verifyInsertion } from '../src/content/inject';
beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
});
function input(attrs = '') { document.body.innerHTML = `<input ${attrs}>`; return document.querySelector('input')!; }
describe('field detection and insertion', () => {
  it('recognizes accessible labels in open shadow roots', () => {
    const host = document.createElement('div'); document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<span id="label">Verification code</span><input aria-labelledby="label">';
    const field = shadow.querySelector('input')!; field.focus();
    expect(focusedElement()).toBe(field);
    expect(detect(field)?.anchor).toBe(field);
  });
  it('dismisses a target removed by a page rerender', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 0));
    const field = input('autocomplete="one-time-code"'); field.focus();
    const leave = vi.fn(); const stop = observeTargets(vi.fn(), leave);
    field.remove();
    await vi.waitFor(() => expect(leave).toHaveBeenCalled());
    stop(); vi.unstubAllGlobals();
  });
  it('stops when a framework replaces a subsequent split input', () => {
    document.body.innerHTML = `<div>${'<input maxlength="1">'.repeat(4)}</div>`;
    const fields = [...document.querySelectorAll('input')];
    fields[0].addEventListener('input', () => fields[1].replaceWith(document.createElement('input')));
    expect(() => insertCode({ inputs: fields, anchor: fields[0] }, '1234')).toThrow('changed during insertion');
    expect(fields[2].value).toBe('');
  });
  it('does not confirm insertion when the page rejects a value', () => {
    const field = input('autocomplete="one-time-code"');
    field.addEventListener('input', () => { field.value = ''; });
    const target = { inputs: [field], anchor: field };
    insertCode(target, '123456');
    expect(() => verifyInsertion(target, '123456')).toThrow('left unread');
  });
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
