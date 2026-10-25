// Upload only the original broker's required values, via stdin; never print secrets.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
const server = parseEnv(readFileSync(new URL('../server/.env', import.meta.url), 'utf8'));
const app = parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
if (!server.GOOGLE_CLIENT_SECRET || !server.GOOGLE_CLIENT_ID || !/^[a-p]{32}$/.test(server.EXTENSION_ID || '')) throw Error('Original server/.env is incomplete.');
if (server.GOOGLE_CLIENT_ID !== app.VITE_GOOGLE_CLIENT_ID) throw Error('Original extension and server OAuth client IDs differ. Resolve this before deployment.');
const values = Object.fromEntries(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'EXTENSION_ID'].map(key => [key, server[key]]));
const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'secret', 'bulk', '--config', 'server/cloudflare/wrangler.jsonc'], { stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
child.stdin.on('error', () => {});
child.on('error', () => { console.error('Could not start Wrangler.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
child.stdin.end(JSON.stringify(values));
