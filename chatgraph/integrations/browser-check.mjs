// Optional real Chromium checks for DOM adapters, extension preview and the MCP Apps bridge.
// Set CHATGRAPH_PLAYWRIGHT_PATH to an installed Playwright ES module, or install playwright in your development runtime.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { organizeConversation, parseConversation } from '../lib/conversations.mjs';

const {chromium}=await import(process.env.CHATGRAPH_PLAYWRIGHT_PATH||'playwright');
const extractor=await readFile(new URL('../extension/extractor.js',import.meta.url),'utf8');
const widget=await readFile(new URL('./chatgpt/widget.html',import.meta.url),'utf8');
const popup=await readFile(new URL('../extension/popup.html',import.meta.url),'utf8');
const popupScript=await readFile(new URL('../extension/popup.js',import.meta.url),'utf8');
const destinationScript=await readFile(new URL('../extension/destination.js',import.meta.url),'utf8');
const popupStyles=await readFile(new URL('../extension/popup.css',import.meta.url),'utf8');
const output=fileURLToPath(new URL('../test-output/',import.meta.url));await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const checks=[],errors=[];
function check(name){checks.push(name);console.log(`PASS ${name}`);}
try{
  const page=await browser.newPage({viewport:{width:1000,height:800}});page.on('pageerror',error=>errors.push(error.message));
  async function capture(html,url='https://chatgpt.com/c/fixture'){
    await page.setContent(html);await page.addScriptTag({content:extractor});
    return page.evaluate(url=>{try{return {value:ChatGraphCapture.extractDocument(document,url)};}catch(error){return {error:error.message};}},url);
  }
  const chatgpt=await capture(`<title>判断变化 - ChatGPT</title><aside>不要采集导航</aside>
    <article data-message-author-role="user"><div class="whitespace-pre-wrap">我最初想按月收费。<br>还没有决定。</div><button>编辑</button></article>
    <article data-message-author-role="assistant"><div class="markdown"><p>也可以先免费测试。</p><pre>const example = '&lt;script&gt;';</pre></div><button>复制</button></article>
    <article data-message-author-role="user"><div class="whitespace-pre-wrap">我决定先免费测试。</div></article>
    <article data-message-author-role="assistant" hidden>隐藏分支</article><button data-testid="stop-button">停止生成</button>`);
  assert.equal(chatgpt.value.messages.length,3);assert.deepEqual(chatgpt.value.messages.map(message=>message.role),['user','assistant','user']);
  assert.match(chatgpt.value.messages[0].content,/收费。\n还没有/);
  assert.doesNotMatch(JSON.stringify(chatgpt.value.messages),/编辑|复制|导航|隐藏分支/);
  assert.match(chatgpt.value.capture.warnings.join(''),/仍在生成/);
  assert.equal(chatgpt.value.capture.complete,'unknown');assert.equal(chatgpt.value.title,'判断变化');
  assert.deepEqual(parseConversation(JSON.stringify(chatgpt.value)),chatgpt.value.messages);
  check('ChatGPT visible-message roles/order, clean text, streaming notice and standard JSON import');

  const deepseek=await capture(`<title>DeepSeek</title><div class="ds-message" data-message-role="user"><div data-message-content>我的判断</div></div><div class="ds-message" data-message-role="assistant"><div class="ds-think-content">隐藏推理</div><div class="ds-markdown"><p>供你考虑的建议</p></div><img alt="附件"></div>`,'https://chat.deepseek.com/a/chat/s/fixture');
  assert.deepEqual(deepseek.value.messages.map(message=>message.role),['user','assistant']);assert.doesNotMatch(JSON.stringify(deepseek.value.messages),/隐藏推理/);assert.match(deepseek.value.capture.warnings.join(''),/媒体/);
  const unknown=await capture('<div class="ds-message">用户未标记</div><div class="ds-message"><div class="ds-markdown">AI 未标记</div></div>','https://chat.deepseek.com/share/fixture');
  assert.deepEqual(unknown.value.messages.map(message=>message.role),['unknown','unknown']);assert.match(unknown.value.capture.warnings.join(''),/不会按轮次猜测/);
  const mixed=await capture('<div class="ds-message">角色未标记的一轮</div><div class="ds-message" data-message-role="assistant">已标记的一轮</div>','https://chat.deepseek.com/share/fixture');
  assert.deepEqual(mixed.value.messages.map(message=>message.role),['unknown','assistant']);
  check('DeepSeek semantic role adapter and honest unknown-role fallback without hidden reasoning');

  assert.match((await capture('<main>登录页，不是对话</main>')).error,/没有识别到/);
  assert.match((await capture('<div data-message-author-role="user">x</div>','https://evil.test')).error,/不受支持/);
  assert.match((await capture('<div data-message-author-role="user">x</div>'.repeat(501))).error,/500/);
  const nested=await capture('<div data-message-author-role="user"><div data-message-author-role="user">一个消息</div></div>');assert.equal(nested.value.messages.length,1);
  check('wrong pages and oversized captures fail clearly; nested message containers are not duplicated');

  // Exercise the real popup code with a mocked Chrome transport, not a live signed-in platform.
  const popupPage=await browser.newPage({viewport:{width:460,height:1000}});popupPage.on('pageerror',error=>errors.push(error.message));
  await popupPage.setContent(popup.replace('<link rel="stylesheet" href="popup.css">',`<style>${popupStyles}</style>`).replace('<script src="popup.js"></script>','').replace('<script src="destination.js"></script>',''));
  await popupPage.evaluate(capture=>{globalThis.chrome={tabs:{query:async()=>[{id:1,url:'https://chatgpt.com/c/fixture'}]},scripting:{executeScript:async args=>args.files?[]:[{result:{capture}}]}};},chatgpt.value);
  await popupPage.addScriptTag({content:destinationScript});await popupPage.addScriptTag({content:popupScript});await popupPage.getByRole('button',{name:'采集当前对话',exact:true}).click();
  assert.equal(await popupPage.locator('.message').count(),3);await popupPage.getByLabel('第 2 条消息的发言者').selectOption('unknown');
  await popupPage.getByLabel('选择第 1 条消息').uncheck();assert.match(await popupPage.locator('#count').textContent(),/2 \/ 3/);
  const downloadPromise=popupPage.waitForEvent('download');await popupPage.getByRole('button',{name:'下载 JSON',exact:true}).click();const download=await downloadPromise;
  const data=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(data.messages.length,2);assert.equal(data.messages[0].role,'unknown');assert.match(data.capture.warnings.join(''),/手动选择/);
  await popupPage.screenshot({path:`${output}/extension-preview.png`});check('extension preview permits role correction, range selection and actual JSON download (Chrome transport mocked)');

  const graph=organizeConversation({title:'观点变化测试',text:JSON.stringify(chatgpt.value)});
  await page.setContent('<iframe title="ChatGraph widget" style="width:950px;height:760px;border:0"></iframe>');
  await page.evaluate(({html,graph})=>{
    globalThis.downloaded=null;globalThis.widgetInitialized=false;
    const frame=document.querySelector('iframe');
    window.addEventListener('message',event=>{
      if(event.source!==frame.contentWindow||event.data?.jsonrpc!=='2.0')return;
      const request=event.data;
      if(request.method==='ui/initialize')frame.contentWindow.postMessage({jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'test-host',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
      if(request.method==='ui/notifications/initialized'){
        globalThis.widgetInitialized=true;frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{graph,sourceNotice:'仅本次提供的消息。'}}},'*');
      }
      if(request.method==='ui/download-file'){globalThis.downloaded=request.params.contents[0].resource.text;frame.contentWindow.postMessage({jsonrpc:'2.0',id:request.id,result:{}},'*');}
    });frame.srcdoc=html;
  },{html:widget,graph});
  await page.waitForFunction(()=>globalThis.widgetInitialized);const frame=page.frameLocator('iframe');
  await frame.locator('.node').first().waitFor();assert.equal(await frame.locator('.node').count(),4);
  await frame.locator('.node').filter({hasText:'我决定先免费测试。'}).click();assert.match(await frame.locator('.source pre').textContent(),/我决定先免费测试/);
  await frame.locator('summary > .fold').first().click();assert.equal(await frame.locator('details').first().getAttribute('open'),null);
  await frame.getByRole('button',{name:'展开全部'}).click();assert.notEqual(await frame.locator('details').first().getAttribute('open'),null);
  await frame.getByRole('button',{name:'导出 JSON'}).click();await page.waitForFunction(()=>globalThis.downloaded);
  assert.equal(JSON.parse(await page.evaluate(()=>globalThis.downloaded)).messages.length,3);
  await page.screenshot({path:`${output}/mcp-widget.png`});check('standard MCP Apps bridge initializes and renders foldable source-linked UI with host download');
  assert.deepEqual(errors,[]);check('no page JavaScript errors');
  await writeFile(`${output}/integration-browser-check.json`,JSON.stringify({checks,errors,note:'Browser fixtures and simulated MCP host; not live ChatGPT/DeepSeek account verification.'},null,2));
}finally{await browser.close();}
