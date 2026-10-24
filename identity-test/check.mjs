import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom = new JSDOM(readFileSync(new URL('index.html', import.meta.url),'utf8'),{runScripts:'outside-only',url:'https://test.invalid'});
const w=dom.window;
let saved={}, selected='A', requests=[], evictions=0;
const ids={A:{id:'111',email:'a@example.com'},B:{id:'222',email:'b@example.com'}};
w.chrome={runtime:{id:'test',getManifest:()=>({oauth2:{client_id:'test.apps.googleusercontent.com'}})},storage:{local:{get:async()=>saved,set:async v=>{saved=structuredClone(v)}}},identity:{getAuthToken:async d=>{requests.push(d);return {token:d.account?.id==='222'?'B':d.account?.id==='111'?'A':selected}},removeCachedAuthToken:async()=>{evictions++},clearAllCachedAuthTokens:async()=>{}}};
w.fetch=async(url,opts)=>{const u=ids[opts.headers.Authorization.slice(7)];return {ok:true,json:async()=>url.includes('userinfo')?{...u,verified_email:true}:url.includes('/profile')?{emailAddress:u.email}:{}}};
try {
  await w.eval('(async()=>{'+readFileSync(new URL('app.js', import.meta.url),'utf8')+'\nwindow.test={act,verify};})()');
  w.document.getElementById('email-A').value='a@example.com';
  await w.test.act('connect','A');
  w.document.getElementById('email-B').value='b@example.com';
  await assert.rejects(w.test.act('connect','B'),/MISMATCH/);
  assert.equal(saved.accounts.B,undefined);
  selected='B';await w.test.act('connect','B');
  await w.test.act('check','A');
  assert.equal(requests.at(-1).interactive,false);
  assert.equal(requests.at(-1).account.id,'111');
  await w.test.act('fresh','B');assert.equal(evictions,1);assert.equal(requests.at(-1).interactive,false);
  await w.test.act('forget','A');await w.test.act('check','B');
  assert.equal(saved.accounts.A,undefined);assert.equal(saved.accounts.B.id,'222');
  await assert.rejects(w.test.verify('B',{id:'111',email:'b@example.com'}),/MISMATCH/);
  console.log('PASS: wrong email and ID rejected; independent A/B selection; silent reacquisition; empty inbox; local disconnect preserves B.');
} finally { dom.window.close(); }
