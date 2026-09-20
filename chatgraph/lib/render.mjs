import { readFile } from 'node:fs/promises';
import { applyTemplate, esc, textUnits } from '../../archify/renderers/shared/utils.mjs';

const NODE_W = 264;
const NODE_H = 126;
const STATUS = { confirmed: '已确认', proposed: '待确认', rejected: '已放弃', revised: '已修正', open: '开放问题' };
const STANCE = { user: '我的判断', ai: 'AI 建议', shared: '共同形成', unknown: '待确认归属' };
const EDGE = { contains: '包含', supports: '支持', challenges: '反驳', revises: '修正', depends: '依赖' };

export function layoutGraph(graph) {
  const children = new Map(graph.nodes.map(node => [node.id, []]));
  const roots = [];
  for (const node of graph.nodes) {
    if (node.parentId && children.has(node.parentId)) children.get(node.parentId).push(node);
    else roots.push(node);
  }
  const computed = new Map();
  const weights = new Map();
  function weight(node) {
    if (!weights.has(node.id)) weights.set(node.id, Math.max(1, children.get(node.id).reduce((sum, child) => sum + weight(child), 0)));
    return weights.get(node.id);
  }
  let forestOffset = 0;
  for (const root of roots) {
    const left = [], right = [];
    let leftWeight = 0, rightWeight = 0;
    for (const child of children.get(root.id)) {
      if (rightWeight <= leftWeight) { right.push(child); rightWeight += weight(child); }
      else { left.push(child); leftWeight += weight(child); }
    }
    const totalHeight = Math.max(leftWeight, rightWeight, 1) * (NODE_H + 36);
    computed.set(root.id, { x: 0, y: forestOffset + (totalHeight - NODE_H - 36) / 2 });
    for (const [branch, direction, branchWeight] of [[left, -1, leftWeight], [right, 1, rightWeight]]) {
      let cursor = forestOffset + (totalHeight - branchWeight * (NODE_H + 36)) / 2;
      function visit(node, depth) {
        const descendants = children.get(node.id);
        let y;
        if (descendants.length) {
          const ys = descendants.map(child => visit(child, depth + 1));
          y = (ys[0] + ys.at(-1)) / 2;
        } else { y = cursor; cursor += NODE_H + 36; }
        computed.set(node.id, { x: direction * depth * (NODE_W + 104), y });
        return y;
      }
      branch.forEach(child => visit(child, 1));
    }
    forestOffset += totalHeight + 80;
  }
  const positioned = graph.nodes.map(node => {
    const position = computed.get(node.id) || { x: 0, y: 0 };
    return { ...node, x: Number.isFinite(node.x) ? node.x : position.x, y: Number.isFinite(node.y) ? node.y : position.y, width: NODE_W, height: NODE_H };
  });
  const minX = Math.min(...positioned.map(n => n.x)) - 70;
  const minY = Math.min(...positioned.map(n => n.y)) - 70;
  const maxX = Math.max(...positioned.map(n => n.x + NODE_W)) + 70;
  const maxY = Math.max(...positioned.map(n => n.y + NODE_H)) + 70;
  return { nodes: positioned, minX, minY, width: maxX - minX, height: maxY - minY };
}

function wrap(text, maxUnits = 30, maxLines = 2) {
  const result = [];
  let line = '';
  let overflow = false;
  for (const char of String(text || '').replace(/\s+/g, ' ')) {
    if (textUnits(line + char) > maxUnits) {
      result.push(line);
      line = '';
      if (result.length >= maxLines) { overflow = true; break; }
    }
    line += char;
  }
  if (line && result.length < maxLines) result.push(line);
  if (overflow) result[result.length - 1] += '…';
  return result;
}

export function renderGraphSvg(graph) {
  const rawLayout = layoutGraph(graph);
  const layout = { ...rawLayout, minX: 0, minY: 0, nodes: rawLayout.nodes.map(node => ({ ...node, x: node.x - rawLayout.minX, y: node.y - rawLayout.minY })) };
  const byId = new Map(layout.nodes.map(node => [node.id, node]));
  const hierarchy = graph.nodes.filter(node => node.parentId && !graph.edges.some(edge => edge.type === 'contains' && edge.source === node.parentId && edge.target === node.id))
    .map(node => ({ id: `tree-${node.id}`, source: node.parentId, target: node.id, type: 'contains', label: '' }));
  const paths = [...hierarchy, ...graph.edges].map((edge, index) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return '';
    const forward = target.x >= source.x;
    const sx = source.x + (forward ? NODE_W : 0);
    const sy = source.y + NODE_H / 2;
    const tx = target.x + (forward ? 0 : NODE_W);
    const ty = target.y + NODE_H / 2;
    const offset = Math.max(48, Math.abs(tx - sx) / 2);
    const label = edge.label || (edge.type === 'contains' ? '' : EDGE[edge.type]);
    const dashed = edge.type === 'contains' || edge.type === 'supports' ? '' : 'stroke-dasharray="6 5"';
    return `<g data-edge-from="${esc(edge.source)}" data-edge-to="${esc(edge.target)}" data-edge-id="${esc(edge.id)}" data-edge-key="${index}" data-edge-label="${esc(label)}">
      <path d="M${sx},${sy} C${sx + (forward ? offset : -offset)},${sy} ${tx + (forward ? -offset : offset)},${ty} ${tx},${ty}" fill="none" stroke="${edge.type === 'revises' || edge.type === 'challenges' ? '#c28463' : '#a9b9b1'}" stroke-width="1.6" ${dashed} ${edge.type === 'contains' ? '' : 'marker-end="url(#cg-arrow)"'}/>
      ${label ? `<text x="${(sx + tx) / 2}" y="${(sy + ty) / 2 - 8}" text-anchor="middle" font-size="11" fill="#6c786f" paint-order="stroke" stroke="#faf9f5" stroke-width="5">${esc(label.slice(0, 18))}</text>` : ''}</g>`;
  }).join('\n');
  const nodes = layout.nodes.map(node => {
    const root = node.type === 'topic';
    const palette = root ? ['#214d40', '#214d40', '#ffffff', '#d4e3dc']
      : node.status === 'rejected' ? ['#f1f0ed', '#d6d5d0', '#777d77', '#8a8e87']
      : node.stance === 'user' ? ['#eef5ef', '#c1d5c5', '#284c3b', '#708478']
      : node.stance === 'ai' ? ['#f2eff9', '#d7cfe8', '#534772', '#86799c']
      : ['#fff6e8', '#e9d6b6', '#805c32', '#9b8467'];
    const lines = wrap(node.label, 29, 2);
    const summary = wrap(node.summary, 35, 1)[0] || '';
    // Same semantic hooks as Archify focusNodeAttrs, with conversation-specific roles.
    return `<g id="node-${esc(node.id)}" data-node-id="${esc(node.id)}" data-node-label="${esc(node.label)}" data-node-kind="${esc(node.type)}" data-node-sublabel="${esc(STANCE[node.stance])}" data-node-context="${esc(node.summary)}" data-node-tag="${esc(STATUS[node.status])}" tabindex="0" role="button" aria-label="${esc(node.label)}" aria-pressed="false">
      <title>${esc([node.label, node.summary, ...node.sourceIds.map(id => `原文 ${id}`)].join(' · '))}</title>
      <g transform="translate(${node.x},${node.y})">
      <rect width="${NODE_W}" height="${NODE_H}" rx="13" fill="${palette[0]}" stroke="${palette[1]}" stroke-width="1.4"/>
      <circle cx="18" cy="20" r="3" fill="${palette[3]}"/>
      <text x="29" y="24" font-size="10" fill="${palette[3]}">${esc(root ? '讨论主题' : STANCE[node.stance])}</text>
      <text x="${NODE_W - 14}" y="24" font-size="10" text-anchor="end" fill="${palette[3]}">${esc(root ? 'ChatGraph' : STATUS[node.status])}</text>
      <text x="16" y="50" font-size="14" font-weight="600" fill="${palette[2]}" ${node.status === 'rejected' ? 'text-decoration="line-through"' : ''}>${lines.map((line, i) => `<tspan x="16" dy="${i ? 21 : 0}">${esc(line)}</tspan>`).join('')}</text>
      <text x="16" y="101" font-size="11" fill="${palette[3]}">${esc(summary)}</text>
      <text x="${NODE_W - 15}" y="116" text-anchor="end" font-size="9" fill="${palette[3]}">${node.sourceIds.length ? `${node.sourceIds.length} 条原文依据` : '手动编写'}</text>
      </g>
    </g>`;
  }).join('\n');
  return `<svg id="main-svg" xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="${layout.minX} ${layout.minY} ${layout.width} ${layout.height}" role="img" aria-labelledby="archify-diagram-title archify-diagram-description" lang="zh-CN" data-quality-profile="standard" data-quality-gates="advisory">
    <title id="archify-diagram-title">${esc(graph.title)}</title><desc id="archify-diagram-description">${esc(graph.description || '保留原文依据的对话思维图谱')}</desc>
    <style>text{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif}g[data-node-id]{cursor:pointer}g[data-node-id]:focus{outline:none}g[data-node-id]:focus>rect{stroke:#df9b55;stroke-width:3}</style>
    <defs><pattern id="cg-dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#dfe4db"/></pattern><marker id="cg-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#a9b9b1"/></marker></defs>
    <rect x="${layout.minX}" y="${layout.minY}" width="${layout.width}" height="${layout.height}" fill="#faf9f5"/>
    <rect x="${layout.minX}" y="${layout.minY}" width="${layout.width}" height="${layout.height}" fill="url(#cg-dots)"/>
    ${paths}${nodes}
    <text x="${layout.minX + 18}" y="${layout.minY + layout.height - 16}" font-size="10" fill="#8c968d">ChatGraph · 对话图谱 · ${graph.mode === 'demo' ? '演示样例' : graph.mode === 'outline' ? '原文整理（未进行 AI 分析）' : 'AI 整理，观点与依据请核对原文'}</text>
  </svg>`;
}

export async function renderGraphHtml(graph) {
  const [template, license] = await Promise.all([
    readFile(new URL('../../archify/assets/template.html', import.meta.url), 'utf8'),
    readFile(new URL('../LICENSE', import.meta.url), 'utf8'),
  ]);
  const notes = graph.nodes.map(node => `<article class="cg-card"><h3>${esc(node.label)}</h3><p>${esc(STANCE[node.stance])} · ${esc(STATUS[node.status])}</p><p>${esc(node.summary)}</p>${node.note ? `<p>${esc(node.note)}</p>` : ''}<p>${node.sourceIds.map(id => `<a href="#cg-source-${esc(id)}">原文 ${esc(id)}</a>`).join(' · ') || '此节点为手动编写，没有原文引用。'}</p></article>`).join('');
  const sources = graph.messages.map(message => `<article class="cg-card" id="cg-source-${esc(message.id)}"><h3>${esc(message.id)} · ${message.role === 'user' ? '用户' : message.role === 'assistant' ? 'AI' : '未知发言者'}</h3><pre>${esc(message.content)}</pre></article>`).join('');
  const cards = `<style>.cg-provenance{max-width:1200px;margin:36px auto;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}.cg-note-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.cg-card{border:1px solid var(--border,#ddd);border-radius:12px;padding:18px;scroll-margin-top:30px}.cg-card h3{font-size:15px;margin-bottom:10px}.cg-card p,.cg-card pre{font:13px/1.8 inherit;white-space:pre-wrap;overflow-wrap:anywhere}.cg-card a{color:#579d80}.cg-license{font-size:11px;line-height:1.7;white-space:pre-wrap}.cg-provenance h2{margin:24px 0 16px}</style><section class="cg-provenance"><h2>观点与依据</h2><div class="cg-note-grid">${notes}</div><h2>对话原文</h2><p>以下仅包含此次导入的原文范围；对话内的陈述不代表已经完成外部事实核查。</p>${sources}<h2>关于此文件</h2><p>由 ChatGraph 生成。本文件包含对话原文，请选择适合的分享对象。</p><details><summary>开源许可与上游署名</summary><p>交互阅读器基于 <a href="https://github.com/tt-a1i/archify" target="_blank" rel="noopener noreferrer">Archify</a>。</p><pre class="cg-license">${esc(license)}</pre></details></section>`;
  return applyTemplate(template, { title: graph.title, subtitle: `${graph.description} · ${graph.mode === 'demo' ? '演示样例' : graph.mode === 'outline' ? '原文整理，未进行 AI 分析' : 'AI 整理，请核对原文'}`, svg: renderGraphSvg(graph), cards, locale: 'zh-CN', visualPreset: 'classic' })
    .replace('data-theme="dark"', 'data-theme="light"');
}
