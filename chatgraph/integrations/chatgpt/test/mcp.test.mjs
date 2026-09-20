import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { createHttpServer } from '../server.mjs';
import { createToolKit, RESOURCE_URI, validateCitations } from '../tools.mjs';
import { createAuth } from '../auth.mjs';

const messages = [
  { id: 'm1', role: 'user', content: '我先考虑订阅收费，暂时没有决定。' },
  { id: 'm2', role: 'assistant', content: '可以先做免费公开测试。' },
  { id: 'm3', role: 'user', content: '我改主意了，先免费测试，不做订阅。' },
];
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }

test('SDK client initializes Streamable HTTP, lists exact auth metadata, reads MCP Apps UI and executes source-preserving tools', async () => {
  const server=createHttpServer({env:{}}), origin=await listen(server);
  const client=new Client({name:'chatgraph-integration-test',version:'1.0.0'});
  try {
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
    await client.connect(transport);
    const list=await client.listTools();assert.equal(list.tools.length,2);
    const organize=list.tools.find(item=>item.name==='organize_conversation');
    assert.equal(organize.annotations.openWorldHint,false);
    assert.deepEqual(organize._meta.securitySchemes,[{type:'noauth'}]);
    // SDK clients strip unknown top-level extensions; verify the actual wire response too.
    const raw=await(await fetch(`${origin}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','Mcp-Session-Id':transport.sessionId},body:JSON.stringify({jsonrpc:'2.0',id:99,method:'tools/list',params:{}})})).json();
    assert.deepEqual(raw.result.tools[0].securitySchemes,[{type:'noauth'}]);
    assert.equal(organize._meta.ui,undefined);
    const resource=await client.readResource({uri:RESOURCE_URI});
    assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
    assert.match(resource.contents[0].text,/ui\/initialize/);
    const result=await client.callTool({name:'organize_conversation',arguments:{title:'收费判断',messages}});
    assert.equal(result.isError,undefined);
    assert.deepEqual(result.structuredContent.graph.messages,messages);
    assert.equal(result.structuredContent.graph.source.complete,'partial');
    assert.match(result.structuredContent.sourceNotice,/不能自动读取/);
    assert.ok(result.structuredContent.graph.nodes.every(node=>node.status==='open'));
    const rendered=await client.callTool({name:'render_conversation_graph',arguments:{graph:result.structuredContent.graph}});
    assert.equal(rendered.isError,undefined);
    const invalid=await client.callTool({name:'organize_conversation',arguments:{title:'x',messages,apiKey:'never-accept-secrets'}});
    assert.equal(invalid.isError,true);assert.doesNotMatch(JSON.stringify(invalid),/never-accept-secrets/);
  } finally { await client.close(); await close(server); }
});

test('separate HTTP calls never share conversation state', async () => {
  const kit=createToolKit({env:{}});
  const first=await kit.call('organize_conversation',{title:'private-a',messages});
  const second=await kit.call('organize_conversation',{title:'private-b',messages:[{id:'b1',role:'user',content:'unrelated'}]});
  assert.notEqual(first.structuredContent.graph.id,second.structuredContent.graph.id);
  assert.doesNotMatch(JSON.stringify(second),/订阅|m3/);
  const supplied=await kit.call('organize_conversation',{title:'provided file',messages,source_scope:'user_supplied_export'});
  assert.equal(supplied.structuredContent.graph.source.complete,'provided');
});

test('render validation rejects fake sources and AI-only confirmation',async()=>{
  const kit=createToolKit({env:{}});
  const result=await kit.call('organize_conversation',{title:'x',messages});
  const graph=result.structuredContent.graph;
  graph.nodes[2].status='confirmed';
  assert.throws(()=>validateCitations(graph),/用户原文/);
  graph.nodes[2].status='open';graph.nodes[2].sourceIds=['invented'];
  assert.throws(()=>validateCitations(graph),/原文|引用|来源/);
  graph.nodes[2].sourceIds=['m2'];
  graph.edges.push({id:'revision',source:graph.nodes[3].id,target:graph.nodes[1].id,type:'revises',label:'修正'});
  assert.throws(()=>validateCitations(graph),/旧观点/);
});

test('paid model tool is opt-in, never accepts user API settings, and returns truthful provider failures',async()=>{
  let received;
  const kit=createToolKit({env:{CHATGRAPH_MCP_ENABLE_AI:'1'},analyze:async(input)=>{received=input;throw new Error('provider unavailable');}});
  assert.equal(kit.tools.find(tool=>tool.name==='analyze_conversation').annotations.openWorldHint,true);
  const result=await kit.call('analyze_conversation',{title:'x',messages});
  assert.equal(result.isError,true);assert.match(result.content[0].text,/provider unavailable/);
  assert.deepEqual(JSON.parse(received.text).messages,messages);assert.equal(received.api,undefined);
  assert.equal(received.complete,'partial');
  await kit.call('analyze_conversation',{title:'provided export',messages,source_scope:'user_supplied_export'});
  assert.equal(received.complete,'provided');
  assert.throws(()=>createHttpServer({env:{CHATGRAPH_MCP_PUBLIC_URL:'https://chatgraph.example.test/mcp',CHATGRAPH_MCP_ENABLE_AI:'1'}}),/OAuth/);
});

test('HTTP refuses foreign origins, invalid JSON and oversized input',async()=>{
  const server=createHttpServer({env:{}}), origin=await listen(server);
  try {
    assert.equal((await fetch(`${origin}/mcp`,{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(`${origin}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'})).status,400);
    assert.equal((await fetch(`${origin}/mcp`,{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
    assert.equal((await fetch(`${origin}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({a:'x'.repeat(2_000_000)})})).status,413);
  }finally{await close(server);}
});

test('OAuth resource server verifies signature, issuer, audience, expiry and scope with discovery challenge',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='test';
  const env={CHATGRAPH_MCP_PUBLIC_URL:'https://chatgraph.example.test/mcp',CHATGRAPH_MCP_AUTH_ISSUER:'https://auth.example.test/',CHATGRAPH_MCP_AUTH_JWKS_URL:'https://auth.example.test/jwks'};
  const auth=createAuth(env,{keySet:createLocalJWKSet({keys:[jwk]})});
  const sign=async(extra={})=>new SignJWT({scope:'chatgraph:use',...extra}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('account-a').setIssuer(env.CHATGRAPH_MCP_AUTH_ISSUER).setAudience(env.CHATGRAPH_MCP_PUBLIC_URL).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const token=await sign();assert.equal((await auth.verify(`Bearer ${token}`)).subject,'account-a');
  await assert.rejects(auth.verify(`Bearer ${await sign({scope:'other'})}`),/权限/);
  await assert.rejects(auth.verify(`Bearer ${token.slice(0,-8)}tampered`));
  const expired=await new SignJWT({scope:'chatgraph:use'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('a').setIssuer(env.CHATGRAPH_MCP_AUTH_ISSUER).setAudience(env.CHATGRAPH_MCP_PUBLIC_URL).setIssuedAt().setExpirationTime(1).sign(privateKey);
  await assert.rejects(auth.verify(`Bearer ${expired}`));
  const wrongAud=await new SignJWT({scope:'chatgraph:use'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('a').setIssuer(env.CHATGRAPH_MCP_AUTH_ISSUER).setAudience('https://different.example').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  await assert.rejects(auth.verify(`Bearer ${wrongAud}`));
  const server=createHttpServer({env,auth}),origin=await listen(server);
  try{
    const discovery=await(await fetch(`${origin}/.well-known/oauth-protected-resource`)).json();
    assert.equal(discovery.resource,env.CHATGRAPH_MCP_PUBLIC_URL);assert.equal(discovery.authorization_servers[0],env.CHATGRAPH_MCP_AUTH_ISSUER);
    const denied=await fetch(`${origin}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(denied.status,401);assert.match(denied.headers.get('www-authenticate'),/resource_metadata/);
    const client=new Client({name:'oauth-test',version:'1'});
    const transport=new StreamableHTTPClientTransport(new URL(`${origin}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${token}`}}});
    await client.connect(transport);
    const tools=await client.listTools();assert.deepEqual(tools.tools[0]._meta.securitySchemes,[{type:'oauth2',scopes:['chatgraph:use']}]);
    const otherToken=await new SignJWT({scope:'chatgraph:use'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('account-b').setIssuer(env.CHATGRAPH_MCP_AUTH_ISSUER).setAudience(env.CHATGRAPH_MCP_PUBLIC_URL).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const isolated=await fetch(`${origin}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:`Bearer ${otherToken}`,'Mcp-Session-Id':transport.sessionId},body:JSON.stringify({jsonrpc:'2.0',id:14,method:'tools/list',params:{}})});
    assert.equal(isolated.status,404,'another authenticated subject cannot use the existing protocol session');
    await client.close();
  }finally{await close(server);}
});

test('SDK HTTP cancellation reaches the provider and does not affect another MCP session', async () => {
  let started, aborted;
  const didStart=new Promise(resolve=>{started=resolve;});
  const didAbort=new Promise(resolve=>{aborted=resolve;});
  const env={CHATGRAPH_MCP_ENABLE_AI:'1'};
  const server=createHttpServer({env,analyze:async(input,{signal})=>{
    assert.equal(input.complete,'partial');
    assert.ok(signal instanceof AbortSignal);
    started();
    return new Promise((resolve,reject)=>{
      const stop=()=>{aborted();reject(new Error('cancelled provider'));};
      if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
    });
  }}),origin=await listen(server);
  const client=new Client({name:'cancel-client',version:'1'}),other=new Client({name:'independent-client',version:'1'});
  try{
    const transport=new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
    await client.connect(transport);
    await other.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
    const controller=new AbortController();
    const call=client.callTool({name:'analyze_conversation',arguments:{title:'cancel fixture',messages}},undefined,{signal:controller.signal});
    const rejected=assert.rejects(call);
    await didStart;controller.abort();await rejected;
    await Promise.race([didAbort,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('provider did not observe MCP cancellation')),2000);timer.unref();})]);
    const unaffected=await other.callTool({name:'organize_conversation',arguments:{title:'independent',messages}});
    assert.equal(unaffected.isError,undefined);
    await transport.terminateSession();
    const stale=await fetch(`${origin}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','Mcp-Session-Id':transport.sessionId||'closed'},body:JSON.stringify({jsonrpc:'2.0',id:10,method:'tools/list',params:{}})});
    assert.equal(stale.status,404);
  }finally{await client.close();await other.close();await close(server);}
});
