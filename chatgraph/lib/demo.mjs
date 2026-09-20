import { validateGraph } from './conversations.mjs';

/** Hand-authored fictional sample. Its claims cite the supplied sample messages. */
export function createDemoGraph() {
  const now = new Date().toISOString();
  const messages = [
    { id: 'demo-m1', role: 'user', content: '我和 AI 讨论产品时会越聊越深入，但聊完之后，决定了什么、为什么改变想法，都埋在长记录里。我想把这些思考沉淀成能继续用的知识。' },
    { id: 'demo-m2', role: 'assistant', content: '可以先做一键把对话转成思维导图，再提供 PPT、知识卡片和团队协作。第一版同时支持多种输出，会让产品看起来更完整。' },
    { id: 'demo-m3', role: 'user', content: '先不要把 PPT 和团队协作放进第一版。我更在意保留自己的判断和改变判断的原因。先服务用 AI 讨论产品的独立开发者与产品经理。' },
    { id: 'demo-m4', role: 'assistant', content: '那可以把第一版定义为决策备忘录：最终判断、判断依据、放弃的建议、未解决的问题；每个判断都能点击查看对应原文。图谱用来展示这些内容的关系。' },
    { id: 'demo-m5', role: 'user', content: '我接受这个方向，但不能把 AI 的建议直接当成我的结论。只有我明确接受的才标成已确认；没有明确表态就保持待确认。' },
    { id: 'demo-m6', role: 'assistant', content: '接入上建议从复制粘贴开始，再增加 ChatGPT 官方组件与跨平台浏览器插件。官方组件能否获得足够完整的原文，需要先做技术验证。' },
    { id: 'demo-m7', role: 'user', content: '可以。先让粘贴导入真正能用，ChatGPT 官方组件和浏览器插件共用一套核心。还有，我希望整理后的图谱能作为交互式网页分享，也可以导出矢量图继续使用。' },
    { id: 'demo-m8', role: 'assistant', content: 'ChatGraph 可以提供可交互的分享网页和清晰的矢量图，同时保留原文引用，让接收者也能核查观点。建议先验证这些能力是否让用户更容易找回判断。' },
    { id: 'demo-m9', role: 'user', content: '第一步就做这个原型。找 10 位目标用户，各提供真实讨论，与原聊天窗口直接总结做对照。一周后看他们是否实际复用，并询问是否愿意为下一次整理付费。付费意愿现在还不知道。' },
  ];
  const node = (id, label, summary, type, stance, status, sourceIds, parentId = 'demo-root') => ({ id, label, summary, type, stance, status, sourceIds, parentId, note: '' });
  const nodes = [
    node('demo-root', '把对话变成可复用的判断', 'ChatGraph 产品决策演示：用一段虚构但完整的对话，展示个人判断、被放弃的建议和下一步验证。', 'topic', 'shared', 'open', ['demo-m1', 'demo-m9'], null),
    node('demo-pain', '思考升级了，结果却没有留下', '真正要找回的是“决定了什么，以及为什么改变想法”。', 'claim', 'user', 'confirmed', ['demo-m1']),
    node('demo-audience', '先服务独立开发者与产品经理', '从用 AI 讨论产品的用户开始，围绕一次真实产品决策验证价值。', 'claim', 'user', 'confirmed', ['demo-m3']),
    node('demo-abandoned', '暂缓完整 PPT 与团队协作', 'AI 建议第一版增加多种输出；用户明确要求暂缓，把范围收回到判断沉淀。', 'claim', 'ai', 'rejected', ['demo-m2', 'demo-m3']),
    node('demo-output', '从漂亮导图，修正为决策备忘录', '保留最终判断、判断依据、放弃的建议和未解决问题，图谱帮助解释关系。', 'claim', 'shared', 'revised', ['demo-m4', 'demo-m5']),
    node('demo-ownership', 'AI 建议不能自动成为我的结论', '用户明确接受后才标为已确认；未表态时保持待确认。', 'claim', 'user', 'confirmed', ['demo-m5']),
    node('demo-evidence', '每个判断都能回到原文', '用可点击的引用让用户核查提取是否准确，并保留改变判断的上下文。', 'evidence', 'shared', 'confirmed', ['demo-m4', 'demo-m5']),
    node('demo-entry', '三个入口，共用一套核心', '先让粘贴导入可用，再扩展 ChatGPT 官方组件和浏览器插件。', 'action', 'user', 'confirmed', ['demo-m6', 'demo-m7']),
    node('demo-platform', '官方组件能取得多少原文？', '组件的实际对话范围尚待技术验证，不能预先承诺完整历史。', 'question', 'ai', 'open', ['demo-m6'], 'demo-entry'),
    node('demo-archify', '让图谱成为可分享的知识', '提供交互式分享网页和矢量图，保留原文引用，方便继续阅读与复用。', 'claim', 'ai', 'proposed', ['demo-m7', 'demo-m8']),
    node('demo-test', '用真实复用行为验证付费需求', '找 10 位目标用户，对照原生总结。一周后回访实际复用，再测试下一次付费；当前付费意愿未知。', 'action', 'user', 'confirmed', ['demo-m9']),
  ];
  const edges = nodes.filter(item => item.parentId).map((item, index) => ({ id: `demo-contains-${index + 1}`, source: item.parentId, target: item.id, type: 'contains', label: '' }));
  edges.push(
    { id: 'demo-rel-1', source: 'demo-output', target: 'demo-abandoned', type: 'revises', label: '收窄第一版范围' },
    { id: 'demo-rel-2', source: 'demo-evidence', target: 'demo-ownership', type: 'supports', label: '通过原文核查归属' },
    { id: 'demo-rel-3', source: 'demo-entry', target: 'demo-platform', type: 'depends', label: '官方入口待验证' },
    { id: 'demo-rel-4', source: 'demo-test', target: 'demo-output', type: 'challenges', label: '验证是否真的被复用' },
  );
  return validateGraph({ id: 'chatgraph-demo', title: 'ChatGraph · 从对话到个人知识', description: '演示样例 · 以下为手工编写的虚构对话及图谱，用于展示产品能力，不是对你的真实聊天自动分析的结果。', createdAt: now, updatedAt: now, mode: 'demo', source: { platform: '演示对话', url: '', complete: 'provided' }, messages, nodes, edges });
}
