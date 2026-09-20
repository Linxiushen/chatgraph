/* Injected only after a user clicks the extension. No page API/session access. */
(() => {
  const LIMIT = 500;
  const ROLES = new Set(['user', 'assistant', 'unknown']);
  const REMOVE = 'script,style,button,textarea,input,select,nav,[role="toolbar"],[aria-hidden="true"],[hidden],[data-thinking],.ds-think-content';
  const ROLE_SELECTORS = [
    '[data-message-author-role="user"],[data-message-author-role="assistant"]',
    '[data-message-role="user"],[data-message-role="assistant"]',
    '[data-role="user"],[data-role="assistant"]',
    '[data-testid="user-message"],[data-testid="assistant-message"]',
  ];

  function platformFor(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { throw new Error('无法识别当前页面地址。'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('请在 HTTPS 的 ChatGPT 或 DeepSeek 对话页打开扩展。');
    if (['chatgpt.com', 'chat.openai.com'].includes(url.hostname)) return 'ChatGPT';
    if (url.hostname === 'chat.deepseek.com') return 'DeepSeek';
    throw new Error('当前页面不受支持。请打开 ChatGPT 或 DeepSeek 的对话页或公开分享页。');
  }

  function explicitRole(element) {
    for (const attr of ['data-message-author-role', 'data-message-role', 'data-role']) {
      const value = element.getAttribute(attr);
      if (ROLES.has(value)) return value;
    }
    const testId = element.getAttribute('data-testid');
    if (testId === 'user-message') return 'user';
    if (testId === 'assistant-message') return 'assistant';
    if (element.matches('.user-message,[data-role="human"]')) return 'user';
    if (element.matches('.assistant-message,[data-role="ai"]')) return 'assistant';
    const label = (element.getAttribute('aria-label') || '').trim().toLowerCase();
    if (['user', '用户', 'you said:', '你说：'].includes(label)) return 'user';
    if (['assistant', 'deepseek', 'chatgpt', 'chatgpt said:', '助手'].includes(label)) return 'assistant';
    // DOM order, left/right alignment and Markdown formatting do not prove a role.
    return 'unknown';
  }

  function visible(element, doc) {
    if (element.closest('[hidden],[aria-hidden="true"]')) return false;
    const view = doc.defaultView;
    if (view?.getComputedStyle) {
      const style = view.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (style.display !== 'contents' && typeof element.getClientRects === 'function' && !element.getClientRects().length) return false;
    }
    return true;
  }

  function readText(element) {
    const copy = element.cloneNode(true);
    for (const item of copy.querySelectorAll(REMOVE)) item.remove();
    // Use content areas when available, excluding role headings and action labels.
    let areas = [...copy.querySelectorAll('[data-message-content]')];
    if (!areas.length) areas = [...copy.querySelectorAll('.markdown,.ds-markdown,.whitespace-pre-wrap')];
    areas = areas.filter(area => !areas.some(other => other !== area && other.contains(area)));
    const roots = areas.length ? areas : [copy];
    const text = roots.map(root => {
      for (const br of root.querySelectorAll('br')) br.replaceWith('\n');
      for (const block of root.querySelectorAll('p,div,li,pre,h1,h2,h3,h4,blockquote,tr')) block.append('\n');
      return root.textContent || '';
    }).join('\n\n');
    return text.replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function extractDocument(doc, rawUrl) {
    const platform = platformFor(rawUrl);
    let candidates = [];
    let adapter = '';
    for (const selector of ROLE_SELECTORS) {
      candidates = [...doc.querySelectorAll(selector)].filter(item => visible(item, doc));
      if (candidates.length) { adapter = selector; break; }
    }
    if (platform === 'DeepSeek') {
      const fallback = '.ds-message,.user-message,.assistant-message';
      const containers = [...doc.querySelectorAll(fallback)].filter(item => visible(item, doc));
      // Include unknown-role wrappers even when only some turns have semantic attributes.
      if (containers.length) {
        adapter = [adapter, fallback].filter(Boolean).join(' + ');
        candidates = [...new Set([...candidates, ...containers])];
        candidates.sort((a, b) => a === b ? 0 : (a.compareDocumentPosition(b) & 2) ? 1 : -1);
      }
    }
    // Nested semantic containers represent one message, not additional turns.
    candidates = candidates.filter(item => !candidates.some(other => other !== item && other.contains(item)));
    if (!candidates.length) throw new Error('没有识别到对话消息。请进入具体对话，等待回答结束、向上滚动加载所需内容后重试。若页面结构已变化，可复制带角色的原文或使用平台导出文件。');
    if (candidates.length > LIMIT) throw new Error('当前页面超过 500 条消息，请分段导出。扩展不会自动截断。');
    const messages = [];
    let attachments = false;
    for (const element of candidates) {
      const content = readText(element);
      attachments ||= !!element.querySelector('img,video,audio,canvas,[data-attachment]');
      if (!content) continue;
      if (content.length > 100_000) throw new Error('单条消息过长，请用平台导出后分段导入。');
      messages.push({ id: `capture-${messages.length + 1}`, role: explicitRole(element), content });
    }
    if (!messages.length) throw new Error('没有可读取的文字消息；图片、附件和音频不在本次采集范围。');
    const warnings = ['仅采集当前页面 DOM 中已加载且可见的对话分支；无法证明完整历史已加载。请核对首尾消息和轮数。', '不会采集其他分支、未加载消息、隐藏思考过程或附件正文。'];
    if (messages.some(message => message.role === 'unknown')) warnings.push('部分消息没有可靠的角色标记，已保留为“未确认”；请在预览中核对，扩展不会按轮次猜测角色。');
    if (attachments) warnings.push('页面包含图片或其他媒体，本次只保留文字。');
    if (doc.querySelector('[data-is-streaming="true"],[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="停止生成"]')) warnings.push('检测到回答可能仍在生成；建议等待完成后重新采集。');
    const url = new URL(rawUrl); url.hash = ''; url.search = '';
    const output = {
      schema: 'chatgraph.conversation.v1',
      title: String(doc.title || '未命名对话').replace(/\s*[-|–]\s*(ChatGPT|DeepSeek)\s*$/i, '').slice(0, 240),
      platform, url: url.href, messages,
      capture: { scope: 'rendered-current-branch', complete: 'unknown', capturedAt: new Date().toISOString(), adapter, messageCount: messages.length, warnings },
    };
    if (new TextEncoder().encode(JSON.stringify(output)).length > 1_950_000) throw new Error('采集结果接近 2 MB 导入上限，请分段导入；不会自动省略原文。');
    return output;
  }

  globalThis.ChatGraphCapture = Object.freeze({ platformFor, explicitRole, readText, extractDocument });
})();
