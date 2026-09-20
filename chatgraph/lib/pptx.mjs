import { validateGraph } from './conversations.mjs';
import { createZip } from './zip.mjs';

const NS = 'http://schemas.openxmlformats.org';
const A = `${NS}/drawingml/2006/main`;
const P = `${NS}/presentationml/2006/main`;
const R = `${NS}/officeDocument/2006/relationships`;
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 12192000;
const H = 6858000;
const FONT = 'Arial';
const FONT_EA = 'Heiti SC';
const STATUS = { confirmed: '已确认', proposed: '建议', rejected: '已否定', revised: '已修正', open: '待确认' };
const STANCE = { user: '用户观点', ai: 'AI 建议', shared: '共同形成', unknown: '归属待确认' };
const TYPE = { topic: '主题', claim: '观点', evidence: '依据', question: '问题', action: '行动' };
const EDGE = { contains: '包含', supports: '支持', challenges: '质疑', revises: '修正', depends: '依赖' };
const ROLE = { user: '用户', assistant: 'AI', unknown: '角色未注明' };

function esc(value) {
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, character => `_x${character.charCodeAt(0).toString(16).padStart(4, '0')}_`).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function inch(value) { return Math.round(value * 914400); }
function wrap(text, width = 34) {
  const result = [];
  for (const paragraph of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    let line = '', units = 0;
    for (const character of paragraph) {
      const size = /[MW@#%&]/.test(character) ? 1.05 : /[A-Z0-9]/.test(character) ? 0.78 : /[\u0000-\u007f]/.test(character) ? 0.62 : 1.12;
      const endingPunctuation = /[，。！？；：、）》」』】〕〉,.!?;:)\]]/.test(character);
      if (units + size > width && line && (!endingPunctuation || units > width + 2.24)) { result.push(line); line = ''; units = 0; }
      line += character;
      units += size;
    }
    result.push(line);
  }
  return result;
}
function paginate(lines, size = 10) {
  const pages = [];
  for (let index = 0; index < lines.length; index += size) pages.push(lines.slice(index, index + size));
  return pages.length ? pages : [[]];
}
function clipped(text, count = 50) {
  const chars = Array.from(String(text));
  return chars.length <= count ? text : `${chars.slice(0, count - 1).join('')}…`;
}
function textBox(id, text, x, y, w, h, { size = 22, color = '253D34', bold = false, lineHeight = 30, align = 'l' } = {}) {
  const lines = Array.isArray(text) ? text : String(text).split('\n');
  const paragraphs = lines.map(line => `<a:p><a:pPr algn="${align}"><a:lnSpc><a:spcPts val="${lineHeight * 100}"/></a:lnSpc><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buNone/></a:pPr><a:r><a:rPr lang="zh-CN" sz="${size * 100}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${FONT}"/><a:ea typeface="${FONT_EA}"/><a:cs typeface="${FONT}"/></a:rPr><a:t xml:space="preserve">${esc(line)}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="${size * 100}"/></a:p>`).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${inch(x)}" y="${inch(y)}"/><a:ext cx="${inch(w)}" cy="${inch(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}
function shapeTree(shapes) {
  return `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree>`;
}
function slideXml(slide, index, total) {
  const cover = slide.kind === 'cover';
  const foreground = cover ? 'FFFFFF' : '253D34';
  const shapes = [
    textBox(2, slide.kicker || 'ChatGraph', 0.85, 0.52, 11.5, 0.4, { size: 13, color: cover ? 'CDDCD5' : '61796E', lineHeight: 17 }),
    textBox(3, slide.heading, 0.85, 1.05, 11.5, 0.8, { size: 30, bold: true, color: foreground, lineHeight: 38 }),
    textBox(4, slide.lines, 0.85, 2.05, 11.5, 4.55, { size: 22, color: foreground, lineHeight: 30 }),
    textBox(5, slide.footer || '', 0.85, 6.78, 10.4, 0.38, { size: 10, color: cover ? 'CDDCD5' : '61796E', lineHeight: 14 }),
    textBox(6, `${index + 1} / ${total}`, 11.3, 6.78, 1.15, 0.38, { size: 10, color: cover ? 'CDDCD5' : '61796E', lineHeight: 14, align: 'r' }),
  ].join('');
  return `${XML}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${cover ? '214D40' : 'FAF9F5'}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${shapeTree(shapes)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
function notesXml(text) {
  const paragraphs = String(text).split(/\r?\n/).map(line => `<a:p><a:r><a:rPr lang="zh-CN"/><a:t xml:space="preserve">${esc(line)}</a:t></a:r></a:p>`).join('');
  const shape = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
  return `${XML}<p:notes xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld>${shapeTree(shape)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}
function rels(items) {
  return `${XML}<Relationships xmlns="${NS}/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${esc(target)}"/>`).join('')}</Relationships>`;
}

/** Produce native, editable slides. Text is paginated, never replaced by invented prose. */
export function renderGraphPptx(value) {
  const graph = validateGraph(value);
  const slides = [];
  const sourceSlide = new Map();
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const mode = graph.mode === 'demo' ? '虚构对话演示' : graph.mode === 'outline' ? '原文整理，未进行 AI 语义分析' : 'AI 结构化，请核对原文';
  const graphNotes = `图谱：${graph.title}\n图谱 ID：${graph.id}\n模式：${mode}\n说明：${graph.description}\n来源平台：${graph.source.platform}\n来源链接：${graph.source.url}\n导入完整性：${graph.source.complete}\n原文来源索引位于文稿末尾。`;
  function addPages({ heading, text, notes = '', ...options }) {
    const pages = paginate(wrap(text));
    for (const [index, lines] of pages.entries()) slides.push({ ...options, heading: `${heading}${pages.length > 1 ? `（${index + 1}/${pages.length}）` : ''}`, lines, notes });
    if (slides.length > 1_200) throw new Error('图谱文字生成超过 1,200 页幻灯片，请拆分图谱或使用 Markdown 导出完整文档。');
  }
  addPages({ kind: 'cover', heading: '对话知识图谱', text: graph.title, footer: mode, notes: graphNotes });
  if (graph.description) addPages({ heading: '讨论说明', text: graph.description, notes: graphNotes });
  const top = graph.nodes.filter(node => node.parentId === null || byId.get(node.parentId)?.parentId === null);
  addPages({ heading: '主题总览', text: top.map((node, index) => `${index + 1}. ${node.label}`).join('\n\n'), footer: `${graph.nodes.length} 个节点，${graph.messages.length} 条来源消息`, notes: `${graphNotes}\n\n完整节点清单：\n${graph.nodes.map(node => `${node.id}：${node.label}`).join('\n')}` });
  for (const [index, node] of graph.nodes.entries()) {
    const parts = [node.label, node.summary, node.note ? `备注：${node.note}` : ''].filter(Boolean);
    const relations = graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
    const notes = `节点 ID：${node.id}\n标题：${node.label}\n摘要：${node.summary}\n备注：${node.note}\n类型：${TYPE[node.type]}\n归属：${STANCE[node.stance]}\n状态：${STATUS[node.status]}\n重要程度：${node.importance}/5\n上级：${node.parentId ? byId.get(node.parentId).label : '无'}\n\n相关关系：\n${relations.map(edge => `${edge.id}：${byId.get(edge.source).label} ${EDGE[edge.type]} ${byId.get(edge.target).label}${edge.label ? `（${edge.label}）` : ''}`).join('\n')}`;
    const start = slides.length;
    addPages({ heading: `${TYPE[node.type]} ${String(index + 1).padStart(2, '0')}：${STATUS[node.status]}`, kicker: `${STANCE[node.stance]}  重要程度 ${node.importance}/5`, text: parts.join('\n\n'), footer: node.sourceIds.length ? `引用 ${node.sourceIds.length} 条原文，来源编号与页码见备注` : '未关联原文的主题或人工节点', notes });
    for (let i = start; i < slides.length; i++) slides[i].sourceIds = node.sourceIds;
  }
  const changes = graph.edges.filter(edge => ['revises', 'challenges'].includes(edge.type));
  if (changes.length) addPages({ heading: '已标注的观点变化', text: changes.map(edge => `${byId.get(edge.source).label}\n${EDGE[edge.type]}：${byId.get(edge.target).label}${edge.label ? `\n${edge.label}` : ''}`).join('\n\n'), notes: `仅展示图谱中已经标注的修正与质疑关系。\n${changes.map(edge => `${edge.id}\n起点：${edge.source}\n终点：${edge.target}\n类型：${edge.type}\n标签：${edge.label}`).join('\n\n')}` });
  if (graph.sessions?.length) addPages({ heading: '对话批次', text: graph.sessions.map((session, index) => `${index + 1}. ${session.title}\n${session.createdAt.slice(0, 10)}  ${session.source.platform || '平台未注明'}\n${session.messageIds.length} 条来源消息`).join('\n\n'), notes: graph.sessions.map(session => `${session.id}\n${session.title}\n${session.createdAt}\n${session.source.platform}\n${session.source.url}\n原文：${session.messageIds.join(', ')}\n节点：${session.nodeIds.join(', ')}`).join('\n\n') });
  // Store each full source exactly once, avoiding duplicated long conversations in notes.
  for (const [index, message] of graph.messages.entries()) {
    sourceSlide.set(message.id, slides.length + 1);
    const sessions = (graph.sessions || []).filter(session => session.messageIds.includes(message.id));
    slides.push({ heading: `原文 ${index + 1}：${ROLE[message.role]}`, kicker: '来源索引', lines: wrap(clipped(message.content.replace(/\s+/g, ' '), 220)).slice(0, 9), footer: '本页展示原文预览，完整原文保留在此页备注', notes: `原文 ID：${message.id}\n角色：${ROLE[message.role]}\n来源平台：${graph.source.platform}\n来源链接：${graph.source.url}\n${sessions.map(session => `对话批次：${session.title}\n来源平台：${session.source.platform}\n来源链接：${session.source.url}`).join('\n')}\n\n原文全文：\n${message.content}` });
  }
  if (slides.length > 1_200) throw new Error('图谱生成超过 1,200 页幻灯片，请拆分图谱后导出。');
  for (const slide of slides) if (slide.sourceIds) slide.notes += `\n\n原文引用：\n${slide.sourceIds.map(id => `${id}：来源索引第 ${sourceSlide.get(id)} 页，完整原文在该页备注中。`).join('\n') || '未关联原文。'}`;

  const entries = new Map();
  const overrides = [
    ['/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'],
    ['/ppt/slideMasters/slideMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml'],
    ['/ppt/slideLayouts/slideLayout1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'],
    ['/ppt/notesMasters/notesMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml'],
    ['/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
  ];
  for (let index = 1; index <= slides.length; index++) overrides.push([`/ppt/slides/slide${index}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'], [`/ppt/notesSlides/notesSlide${index}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml']);
  entries.set('[Content_Types].xml', `${XML}<Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('')}</Types>`);
  entries.set('_rels/.rels', `${XML}<Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="${NS}/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${R}/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  entries.set('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="${NS}/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(graph.title)}</dc:title><dc:creator>ChatGraph</dc:creator><dc:description>${esc(graph.description)}</dc:description><dcterms:created xsi:type="dcterms:W3CDTF">${esc(graph.createdAt)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${esc(graph.updatedAt)}</dcterms:modified></cp:coreProperties>`);
  entries.set('docProps/app.xml', `${XML}<Properties xmlns="${NS}/officeDocument/2006/extended-properties" xmlns:vt="${NS}/officeDocument/2006/docPropsVTypes"><Application>ChatGraph</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slides.length}</Slides><Notes>${slides.length}</Notes></Properties>`);
  entries.set('ppt/presentation.xml', `${XML}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rIdNotesMaster"/></p:notesMasterIdLst><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`);
  entries.set('ppt/_rels/presentation.xml.rels', rels([['rIdMaster', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rIdNotesMaster', 'notesMaster', 'notesMasters/notesMaster1.xml'], ...slides.map((_, index) => [`rId${index + 1}`, 'slide', `slides/slide${index + 1}.xml`])]));
  const clrMap = '<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>';
  entries.set('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld>${shapeTree('')}</p:cSld>${clrMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  entries.set('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rIdLayout', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rIdTheme', 'theme', '../theme/theme1.xml']]));
  entries.set('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="blank" preserve="1"><p:cSld name="Blank">${shapeTree('')}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  entries.set('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rIdMaster', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
  entries.set('ppt/notesMasters/notesMaster1.xml', `${XML}<p:notesMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld>${shapeTree('')}</p:cSld>${clrMap}<p:notesStyle/></p:notesMaster>`);
  entries.set('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([['rIdTheme', 'theme', '../theme/theme1.xml']]));
  entries.set('ppt/theme/theme1.xml', `${XML}<a:theme xmlns:a="${A}" name="ChatGraph"><a:themeElements><a:clrScheme name="ChatGraph"><a:dk1><a:srgbClr val="253D34"/></a:dk1><a:lt1><a:srgbClr val="FAF9F5"/></a:lt1><a:dk2><a:srgbClr val="214D40"/></a:dk2><a:lt2><a:srgbClr val="EEF5EF"/></a:lt2>${['214D40', '67577F', '9A653E', '496277', '786F65', 'B59B72'].map((color, index) => `<a:accent${index + 1}><a:srgbClr val="${color}"/></a:accent${index + 1}>`).join('')}<a:hlink><a:srgbClr val="214D40"/></a:hlink><a:folHlink><a:srgbClr val="67577F"/></a:folHlink></a:clrScheme><a:fontScheme name="ChatGraph"><a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface="${FONT_EA}"/><a:cs typeface="${FONT}"/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface="${FONT_EA}"/><a:cs typeface="${FONT}"/></a:minorFont></a:fontScheme><a:fmtScheme name="ChatGraph"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${'<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`);
  for (const [index, slide] of slides.entries()) {
    const number = index + 1;
    entries.set(`ppt/slides/slide${number}.xml`, slideXml(slide, index, slides.length));
    entries.set(`ppt/slides/_rels/slide${number}.xml.rels`, rels([['rIdLayout', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rIdNotes', 'notesSlide', `../notesSlides/notesSlide${number}.xml`]]));
    entries.set(`ppt/notesSlides/notesSlide${number}.xml`, notesXml(slide.notes));
    entries.set(`ppt/notesSlides/_rels/notesSlide${number}.xml.rels`, rels([['rIdSlide', 'slide', `../slides/slide${number}.xml`], ['rIdMaster', 'notesMaster', '../notesMasters/notesMaster1.xml']]));
  }
  const size = [...entries.values()].reduce((sum, body) => sum + Buffer.byteLength(body), 0);
  if (size > 64 * 1024 * 1024) throw new Error('幻灯片展开内容超过 64 MB，请拆分图谱后导出。');
  return createZip(entries);
}
