import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const context=vm.createContext({URL,TextEncoder});
vm.runInContext(await readFile(new URL('../extractor.js',import.meta.url),'utf8'),context);
const api=context.ChatGraphCapture;

test('platform allowlist accepts actual ChatGPT/DeepSeek share origins and rejects lookalikes/private targets',()=>{
  assert.equal(api.platformFor('https://chatgpt.com/share/example'),'ChatGPT');
  assert.equal(api.platformFor('https://chat.deepseek.com/a/chat/s/example'),'DeepSeek');
  for(const url of ['https://chatgpt.com.evil.test/c/abc','https://example.test','http://chatgpt.com/c/abc','http://127.0.0.1','https://user:password@chatgpt.com/c/abc']) assert.throws(()=>api.platformFor(url));
});

test('role classification uses explicit semantics and never alternation, layout or Markdown',()=>{
  const element=attrs=>({getAttribute:key=>attrs[key]??null,matches:()=>false});
  assert.equal(api.explicitRole(element({'data-message-author-role':'user'})),'user');
  assert.equal(api.explicitRole(element({'data-message-role':'assistant'})),'assistant');
  assert.equal(api.explicitRole(element({'data-testid':'assistant-message'})),'assistant');
  assert.equal(api.explicitRole(element({'class':'right-aligned ds-markdown'})),'unknown');
});
