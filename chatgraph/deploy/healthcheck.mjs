import http from 'node:http';

const port = Number(process.env.CHATGRAPH_PORT || 4317);
const host = process.env.CHATGRAPH_PUBLIC_ORIGIN ? new URL(process.env.CHATGRAPH_PUBLIC_ORIGIN).host : `127.0.0.1:${port}`;
const request = http.get({ hostname: '127.0.0.1', port, path: '/api/health', headers: { Host: host }, timeout: 4000 }, response => {
  let body = '';
  response.setEncoding('utf8');
  response.on('data', chunk => { body += chunk; if (body.length > 4096) request.destroy(new Error('response too large')); });
  response.on('end', () => {
    try { if (response.statusCode !== 200 || JSON.parse(body).ok !== true) process.exitCode = 1; }
    catch { process.exitCode = 1; }
  });
});
request.on('timeout', () => request.destroy(new Error('timeout')));
request.on('error', () => { process.exitCode = 1; });
