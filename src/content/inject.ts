import type { Target } from './detector';
export function insertCode(target: Target, code: string) {
  const fields = target.inputs;
  if (!/^[A-Z0-9]{4,8}$/.test(code)) throw new Error('Invalid verification code.');
  if (fields.length > 1 && fields.length !== code.length) throw new Error('The code length does not match these boxes.');
  if (fields.some(field => !field.isConnected || field.disabled || field.readOnly)) throw new Error('The verification field changed. Focus it and try again.');
  if (fields.length === 1 && fields[0].maxLength > 0 && fields[0].maxLength < code.length) throw new Error('This code is too long for the field.');
  if (fields.some(field => field.type === 'number') && !/^\d+$/.test(code)) throw new Error('This field accepts numeric codes only.');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('This page does not support safe insertion.');
  fields.forEach((field, index) => {
    field.focus();
    setter.call(field, fields.length === 1 ? code : code[index]);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: fields.length === 1 ? code : code[index] }));
    field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  // Do not submit the form; the user controls verification.
}
