import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const page = readFileSync(new URL('../tests/fixtures/otp.html', import.meta.url));
createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/otp') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page);
}).listen(8788, '127.0.0.1', () => console.log('OTP test page: http://127.0.0.1:8788'));
