import { registerMobile, normalizeMobileShare, readMobileFile, readMobileShare, saveMobileShare, listMobileShares, removeMobileShare, markMobileSharePending, MOBILE_SHARE_ERRORS } from './mobile.js';

const $ = selector => document.querySelector(selector);
const form = $('#mobile-import-form');
const title = $('#share-title'), text = $('#share-text'), url = $('#share-url');
const actionButtons = [$('#continue-import'), $('#save-inbox')];
let selected = null, selectedFile = null, installing = null, formRevision = 0, readingFile = false, saving = false, fileReadSequence = 0;
function syncActionButtons() { actionButtons.forEach(button => { button.disabled = readingFile || saving; }); }

function message(value, error = false) {
  const target = error ? $('#form-error') : $('#page-status');
  target.textContent = value || '';
  target.hidden = !value;
}
function formData() {
  return { ...(selected ? { id: selected.id, revision: selected.revision, createdAt: selected.createdAt } : {}), title: title.value, text: selectedFile?.text ?? text.value, url: url.value, fileName: selectedFile?.fileName || '' };
}
function updateSource() {
  let linked = false;
  try { linked = normalizeMobileShare(formData()).kind === 'link'; } catch { /* Show validation errors only on submit. */ }
  $('#link-notice').hidden = !linked;
  $('#continue-import').firstChild.textContent = linked ? '补充对话原文 ' : '检查并整理 ';
}
function showFile(value) {
  selectedFile = value;
  text.hidden = Boolean(value);
  $('#file-preview').hidden = !value;
  $('#paste-text').hidden = Boolean(value);
  if (value) {
    $('#file-name').textContent = value.fileName;
    $('#file-meta').textContent = `${(value.bytes / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} KB · 下一步检查会话和范围`;
    $('#file-excerpt').textContent = value.text.slice(0, 1500) + (value.text.length > 1500 ? '\n…（这里只展示文件开头）' : '');
  } else {
    $('#file-name').textContent = $('#file-meta').textContent = $('#file-excerpt').textContent = '';
  }
  updateSource();
}
function displayRecord(record) {
  formRevision++;
  fileReadSequence++;
  readingFile = false;
  syncActionButtons();
  selected = record;
  title.value = record.title;
  url.value = record.url;
  text.value = record.fileName ? '' : record.text;
  showFile(record.fileName ? record : null);
  $('#new-entry').hidden = false;
  message('这份内容已保存在当前浏览器。检查后继续，或留到稍后整理。');
  message('', true);
}
function newEntry() {
  formRevision++;
  fileReadSequence++;
  readingFile = false;
  syncActionButtons();
  selected = null;
  form.reset();
  showFile(null);
  $('#new-entry').hidden = true;
  history.replaceState(null, '', location.pathname);
  message(''); message('', true);
}
async function refreshQueue() {
  const records = await listMobileShares();
  const queue = $('#share-queue');
  queue.replaceChildren();
  $('#queue-section').hidden = !records.length;
  $('#queue-count').textContent = records.length;
  for (const item of records) {
    const row = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button'; open.className = 'queue-open';
    const name = document.createElement('strong');
    name.textContent = item.title || item.fileName || (item.kind === 'link' ? '待补充原文的分享链接' : '一段待整理的对话');
    const meta = document.createElement('small');
    meta.textContent = `${item.kind === 'link' ? '仅链接' : item.kind === 'file' ? '文件' : '文字'} · ${new Date(item.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${(item.bytes / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} KB`;
    open.append(name, meta);
    open.addEventListener('click', async () => {
      const revision = ++formRevision;
      try {
        const record = await readMobileShare(item.id);
        if (revision !== formRevision) return;
        if (!record) { await refreshQueue(); throw new Error(MOBILE_SHARE_ERRORS.unavailable); }
        displayRecord(record);
        history.replaceState(null, '', `#${item.id}`);
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) { message(error.message, true); }
    });
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'queue-delete'; remove.textContent = '删除';
    remove.setAttribute('aria-label', `删除 ${name.textContent}`);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        if (!await removeMobileShare(item.id, item.revision)) { await refreshQueue(); throw new Error(MOBILE_SHARE_ERRORS.conflict); }
        if (selected?.id === item.id) newEntry();
        await refreshQueue();
        message('已从这台设备的收件箱移除。');
      } catch (error) { remove.disabled = false; message(error.message, true); }
    });
    row.append(open, remove); queue.append(row);
  }
}
async function save({ continueToWorkspace = false } = {}) {
  if (readingFile || saving) return;
  saving = true; syncActionButtons();
  message('', true);
  const revision = formRevision;
  try {
    const record = await saveMobileShare(formData());
    if (formRevision !== revision) { await refreshQueue(); message('已保存刚才的内容；当前输入有新修改，请再次保存后继续。'); return; }
    selected = record;
    $('#new-entry').hidden = false;
    history.replaceState(null, '', `#${record.id}`);
    await refreshQueue();
    if (formRevision !== revision) { message('已保存刚才的内容；当前输入有新修改，请再次保存后继续。'); return; }
    if (continueToWorkspace && navigator.onLine) location.assign(markMobileSharePending(record.id));
    else message(continueToWorkspace ? '内容已保存到手机收件箱。当前离线，请联网后再次点“检查并整理”。' : '已保存到这台设备。24 小时后会在下次访问收件箱时清理。');
  } catch (error) { message(error.message || MOBILE_SHARE_ERRORS.storage, true); }
  finally { saving = false; syncActionButtons(); }
}

form.addEventListener('submit', event => { event.preventDefault(); save({ continueToWorkspace: true }); });
$('#save-inbox').addEventListener('click', () => save());
$('#new-entry').addEventListener('click', newEntry);
for (const field of [title, text, url]) field.addEventListener('input', () => { formRevision++; message('', true); updateSource(); });
$('#clear-file').addEventListener('click', () => { formRevision++; showFile(null); text.focus(); });
$('#share-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const revision = ++formRevision;
  const sequence = ++fileReadSequence;
  readingFile = true;
  syncActionButtons();
  try {
    const record = await readMobileFile(file);
    if (sequence !== fileReadSequence || revision !== formRevision) return;
    formRevision++;
    if (!title.value.trim()) title.value = record.title;
    showFile(record);
    message('', true);
  } catch (error) { if (sequence === fileReadSequence && revision === formRevision) message(error.message, true); }
  finally {
    if (sequence === fileReadSequence) {
      event.target.value = ''; readingFile = false; syncActionButtons();
    }
  }
});
$('#paste-text').addEventListener('click', async () => {
  const revision = formRevision;
  try {
    if (!navigator.clipboard?.readText) throw new Error('clipboard-unavailable');
    const content = await navigator.clipboard.readText();
    if (revision !== formRevision) throw new Error('changed');
    if (!content.trim()) throw new Error('clipboard-empty');
    normalizeMobileShare({ text: content });
    text.value = content; formRevision++; updateSource(); message('', true);
  } catch (error) {
    text.focus();
    message(error.code ? error.message : '请长按“对话原文”输入框，选择“粘贴”。当前浏览器未提供可直接读取的剪贴板文字。', true);
  }
});

function selectPlatform(name) {
  for (const platform of ['ios', 'android']) {
    const active = name === platform;
    $(`#${platform}-tab`).setAttribute('aria-selected', String(active));
    $(`#${platform}-tab`).tabIndex = active ? 0 : -1;
    $(`#${platform}-guide`).hidden = !active;
  }
}
for (const platform of ['ios', 'android']) {
  const tab = $(`#${platform}-tab`);
  tab.addEventListener('click', () => selectPlatform(platform));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'ios' : event.key === 'End' ? 'android' : platform === 'ios' ? 'android' : 'ios';
    selectPlatform(next); $(`#${next}-tab`).focus();
  });
}
if (/Android/i.test(navigator.userAgent)) selectPlatform('android');
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installing = event; $('#install-app').hidden = false;
});
$('#install-app').addEventListener('click', async () => {
  if (!installing) return;
  const prompt = installing; installing = null; $('#install-app').hidden = true;
  try { await prompt.prompt(); await prompt.userChoice; }
  catch { $('#install-status').textContent = '请打开浏览器菜单，选择安装应用或添加到主屏幕。'; }
});
function standaloneStatus() {
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
    $('#install-status').textContent = '你正在独立窗口中使用 ChatGraph。接收分享能力仍取决于手机系统和浏览器。';
    $('#install-app').hidden = true;
  }
}
window.addEventListener('appinstalled', standaloneStatus);
standaloneStatus();
function onlineStatus() { $('#offline-status').hidden = navigator.onLine; }
window.addEventListener('online', onlineStatus); window.addEventListener('offline', onlineStatus); onlineStatus();
$('#local-warning').hidden = !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

async function initialize() {
  registerMobile().catch(() => { message('手机离线入口暂时未准备好。你仍可粘贴或选择文件；请联网刷新后再启用系统分享。'); });
  try {
    await refreshQueue();
    const hash = location.hash.slice(1);
    if (/^[a-f0-9-]{36}$/i.test(hash)) {
      const record = await readMobileShare(hash);
      if (!record) throw new Error(MOBILE_SHARE_ERRORS.unavailable);
      displayRecord(record);
    } else if (hash.startsWith('error=')) {
      const code = new URLSearchParams(hash).get('error');
      throw new Error(MOBILE_SHARE_ERRORS[code] || MOBILE_SHARE_ERRORS.format);
    }
  } catch (error) { message(error.message || MOBILE_SHARE_ERRORS.storage, true); }
}
initialize();
