const $ = id => document.getElementById(id);
let current;
const selected = new Set();
const { parseDestination, defaultOrigin } = globalThis.ChatGraphDestination;
let workspaceEdited = false;
function status(text, error = false) { $('status').textContent = text; $('status').dataset.error = String(error); }
function destinationNotice() {
  try { const target = parseDestination($('workspace').value); $('destination-notice').textContent = `将发送到 ${target.origin} 的导入预览。${target.local ? '手机请先配置 HTTPS 工作区。' : '请先在该工作区登录。'}`; }
  catch (error) { $('destination-notice').textContent = error.message; }
}
async function saveDestination() {
  const target = parseDestination($('workspace').value);
  await chrome.storage?.local?.set({ workspaceOrigin: target.origin });
  $('workspace').value = target.origin; destinationNotice(); return target;
}
$('workspace').addEventListener('input', () => { workspaceEdited = true; destinationNotice(); });
destinationNotice();
chrome.storage?.local?.get('workspaceOrigin').then(saved => {
  if (workspaceEdited) return;
  try { $('workspace').value = parseDestination(saved.workspaceOrigin || defaultOrigin).origin; }
  catch { $('workspace').value = defaultOrigin; }
  destinationNotice();
}).catch(() => {});
function updateCount() { $('count').textContent = `已选 ${selected.size} / ${current.messages.length} 条`; }
function payload() {
  if (!current || !selected.size) throw new Error('请至少选择一条消息。');
  const messages = current.messages.filter(message => selected.has(message.id));
  const warnings = [...current.capture.warnings];
  if (messages.length !== current.messages.length) warnings.push(`手动选择 ${messages.length} 条，采集到的其余消息未包含在此次导入。`);
  return { ...current, title: $('title').value.trim() || current.title, messages, capture: { ...current.capture, messageCount: messages.length, warnings } };
}
function render() {
  $('result').hidden = false;
  $('title').value = current.title;
  $('source').textContent = `${current.platform} · ${current.url}`;
  $('warnings').replaceChildren(...current.capture.warnings.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  $('messages').replaceChildren();
  for (const [index, message] of current.messages.entries()) {
    const item = document.createElement('article'); item.className = 'message';
    const head = document.createElement('header');
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = true; check.setAttribute('aria-label', `选择第 ${index + 1} 条消息`);
    check.addEventListener('change', () => { if (check.checked) selected.add(message.id); else selected.delete(message.id); updateCount(); });
    const number = document.createElement('span'); number.textContent = `#${index + 1}`;
    const role = document.createElement('select'); role.setAttribute('aria-label', `第 ${index + 1} 条消息的发言者`);
    for (const [value, label] of [['user', '用户'], ['assistant', 'AI'], ['unknown', '未确认角色']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; role.append(option); }
    role.value = message.role; role.addEventListener('change', () => { message.role = role.value; });
    const text = document.createElement('pre'); text.textContent = message.content;
    head.append(check, number, role); item.append(head, text); $('messages').append(item);
  }
  updateCount();
}
async function action(button, fn) {
  button.disabled = true;
  try { await fn(); } catch (error) { status(error.message || '操作失败，请重试。', true); }
  finally { button.disabled = false; }
}
$('save-workspace').addEventListener('click', () => action($('save-workspace'), async () => { const target = await saveDestination(); status(`已保存工作区 ${target.origin}。`); }));
$('open-workspace').addEventListener('click', () => action($('open-workspace'), async () => { const target = await saveDestination(); await chrome.tabs.create({ url: target.url, active: true }); }));
$('capture').addEventListener('click', () => action($('capture'), async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('无法读取当前标签页。');
  // Check the URL before requesting script execution on an unrelated website.
  const url = new URL(tab.url || 'about:blank');
  if (url.protocol !== 'https:' || !['chatgpt.com', 'chat.openai.com', 'chat.deepseek.com'].includes(url.hostname)) throw new Error('请打开 ChatGPT 或 DeepSeek 对话页或公开分享页后重试。');
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extractor.js'] });
  const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
    try { return { capture: globalThis.ChatGraphCapture.extractDocument(document, location.href) }; }
    catch (error) { return { error: error.message }; }
  } });
  if (result[0]?.result?.error) throw new Error(result[0].result.error);
  if (!result[0]?.result?.capture) throw new Error('页面尚未准备好，请刷新页面后重试。');
  current = result[0].result.capture; selected.clear(); current.messages.forEach(message => selected.add(message.id));
  render(); status(`已采集 ${current.messages.length} 条文字消息，请核对角色和首尾范围。`);
}));
$('select-all').addEventListener('click', () => { current.messages.forEach(message => selected.add(message.id)); for (const check of $('messages').querySelectorAll('input[type=checkbox]')) check.checked = true; updateCount(); });
$('copy').addEventListener('click', () => action($('copy'), async () => { await navigator.clipboard.writeText(JSON.stringify(payload(), null, 2)); status('已复制。可在 ChatGraph 的导入窗口粘贴。'); }));
$('download').addEventListener('click', () => action($('download'), async () => {
  const data = payload(); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `${data.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'chatgraph'}-conversation.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); status('已下载标准对话 JSON，可在 ChatGraph 中选择文件导入。');
}));
$('send').addEventListener('click', () => action($('send'), async () => {
  const capture = payload();
  const target = parseDestination($('workspace').value);
  const granted = await chrome.permissions.request({ origins: [target.permission] });
  if (!granted) throw new Error('未授予该工作区页面的访问权限。你仍可复制或下载 JSON 导入。');
  await saveDestination();
  // Keep the popup alive until delivery: open in background, then activate after ACK.
  const tab = await chrome.tabs.create({ url: target.url, active: false });
  const started = Date.now();
  let ready;
  while ((ready = await chrome.tabs.get(tab.id)).status !== 'complete') {
    if (Date.now() - started > 12000) throw new Error('工作区页面未就绪。请检查地址和网络，再复制或下载 JSON 导入。');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!ready.url || new URL(ready.url).origin !== target.origin) throw new Error('工作区跳转到了其他地址，已停止发送。请核对工作区地址。');
  const requestId = crypto.randomUUID();
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', args: [capture, requestId, target.origin], func: (data, id, expectedOrigin) => {
    if (location.origin !== expectedOrigin) return false;
    return new Promise(resolve => {
    const timer = setTimeout(() => { window.removeEventListener('message', receive); resolve(false); }, 7000);
    function receive(event) {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'chatgraph:import:ack' || event.data?.requestId !== id) return;
      clearTimeout(timer); window.removeEventListener('message', receive); resolve(event.data.ok === true);
    }
    window.addEventListener('message', receive);
    window.postMessage({ type: 'chatgraph:import', version: 1, requestId: id, capture: data }, location.origin);
  }); } });
  if (!results[0]?.result) throw new Error('工作区未确认收到。请先打开工作区登录，并使用最新版 ChatGraph；也可以复制 / 下载 JSON 导入。');
  await chrome.tabs.update(tab.id, { active: true });
  status('已送到 ChatGraph 导入预览。');
}));
