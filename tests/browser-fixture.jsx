import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
function Form() {
  const [single, setSingle] = useState('');
  const [split, setSplit] = useState(Array(6).fill(''));
  return <main>
    <label>Verification code<input id="single" autoComplete="one-time-code" value={single} onChange={e => setSingle(e.target.value)} /></label>
    <output id="single-value">{single}</output>
    <div>{split.map((value, index) => <input key={index} id={`digit-${index}`} maxLength={1} value={value} onChange={e => setSplit(old => old.map((digit, i) => i === index ? e.target.value : digit))} />)}</div>
    <output id="split-value">{split.join('')}</output>
    <input id="unusual" aria-label="Security challenge" />
  </main>;
}
createRoot(document.getElementById('root')).render(<Form />);
