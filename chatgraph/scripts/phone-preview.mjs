// Temporary, password-protected mobile access. The desktop workspace is never
// forwarded: a separate hosted server and a separate data directory are used.
import { promises as fs, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server.mjs';
import { loadPrivateConfig } from '../lib/config.mjs';
import { atomicWriteFile } from '../lib/atomic-file.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--cloudflared', '--state-dir', '--port', '--private-config'].includes(args[index]) || !args[index + 1] || Object.hasOwn(options, args[index])) throw new Error('Use --cloudflared PATH --state-dir PRIVATE_DIR [--port 4321] [--private-config PRIVATE_ENV_FILE]');
  options[args[index]] = args[index + 1];
}
if (!options['--cloudflared'] || !options['--state-dir']) throw new Error('Specify cloudflared and a private state directory outside the checkout.');
const stateDir = path.resolve(options['--state-dir']);
if (stateDir === path.dirname(appRoot) || stateDir.startsWith(path.dirname(appRoot) + path.sep)) throw new Error('Preview state and credentials must live outside the source checkout.');
const port = Number(options['--port'] || 4321);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 4317) throw new Error('Choose a dedicated preview port (1024–65535, other than desktop port 4317).');
await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
const actualStateDir = await fs.realpath(stateDir), checkout = await fs.realpath(path.dirname(appRoot));
if (actualStateDir === checkout || actualStateDir.startsWith(checkout + path.sep) || (await fs.lstat(stateDir)).isSymbolicLink()) throw new Error('Preview state must be a real directory outside the source checkout.');
await fs.chmod(stateDir, 0o700);
const statusFile = path.join(stateDir, 'status.json');
const credentialsFile = path.join(stateDir, 'credentials.json');
const dataDir = path.join(stateDir, 'data');
for (const file of [statusFile, credentialsFile, dataDir]) {
  try {
    const entry = await fs.lstat(file);
    if (entry.isSymbolicLink()) throw new Error('Preview state, credentials and data must not be symbolic links.');
    if (file === dataDir ? !entry.isDirectory() : !entry.isFile()) throw new Error('Preview state files or data directory have an invalid file type.');
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
// Support a running preview started by the earlier, lock-free launcher too.
try {
  const previous = JSON.parse(await fs.readFile(statusFile, 'utf8'));
  if (previous?.state !== 'stopped' && Number.isSafeInteger(previous?.pid) && previous.pid > 0) {
    let alive = true;
    try { process.kill(previous.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw new Error('A preview process already owns this state directory. Stop that process before starting another.');
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const lockFile = path.join(stateDir, 'preview.lock'), lockToken = randomBytes(16).toString('hex');
let lock;
try { lock = await fs.open(lockFile, 'wx', 0o600); }
catch (error) {
  if (error.code === 'EEXIST') throw new Error('Preview state is locked. Do not start a second instance; after an interrupted exit, verify the recorded process has stopped before removing preview.lock.');
  throw error;
}
try { await lock.writeFile(JSON.stringify({ pid: process.pid, token: lockToken })); await lock.sync(); }
finally { await lock.close(); }
process.on('exit', () => {
  // Never remove a replacement lock installed by another operator/process.
  try { if (JSON.parse(readFileSync(lockFile, 'utf8')).token === lockToken) unlinkSync(lockFile); } catch {}
});
let credentials;
try { credentials = JSON.parse(await fs.readFile(credentialsFile, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw new Error('Cannot read saved preview credentials; the original file was retained.');
  credentials = { password: `ChatGraph-${randomBytes(18).toString('base64url')}` };
  await atomicWriteFile(credentialsFile, JSON.stringify(credentials));
}
if (!credentials || typeof credentials.password !== 'string' || credentials.password.length < 16) throw new Error('Saved preview credentials are invalid.');
await fs.chmod(credentialsFile, 0o600);
try { await fs.access(path.join(dataDir, '.incomplete')); throw new Error('Preview data restore is incomplete.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
// Reuse only the server's provider configuration; never publish it or pass it
// to cloudflared, the mobile app, a browser URL, or the status document.
const privateConfig = loadPrivateConfig(options['--private-config'] ? path.resolve(options['--private-config']) : path.join(appRoot, '.env'), { ...process.env });
const modelEnv = Object.fromEntries(['CHATGRAPH_API_KEY', 'CHATGRAPH_API_BASE_URL', 'CHATGRAPH_MODEL', 'CHATGRAPH_REASONING_EFFORT'].filter(key => privateConfig[key]).map(key => [key, privateConfig[key]]));
let server, origin = '', stopping = false, statusWrite = Promise.resolve();
const writeStatus = state => {
  statusWrite = statusWrite.catch(() => {}).then(() => atomicWriteFile(statusFile, JSON.stringify({ state, temporary: true, origin, port, dataDir, pid: process.pid, updatedAt: new Date().toISOString() }, null, 2)));
  return statusWrite;
};
await writeStatus('starting');
const tunnelEnvironment = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const tunnel = spawn(path.resolve(options['--cloudflared']), ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`, '--protocol', 'http2'], { stdio: ['ignore', 'pipe', 'pipe'], env: tunnelEnvironment });
let workspaceStarting = Promise.resolve();
const startupDeadline = setTimeout(() => { console.error('The temporary HTTPS tunnel did not start within 90 seconds.'); void stop(1); }, 90_000);
async function startWorkspace(url) {
  if (origin || stopping) return;
  origin = url;
  try {
    server = createAppServer({ dataDir, env: { ...modelEnv, CHATGRAPH_PUBLIC_ORIGIN: origin, CHATGRAPH_AUTH_PASSWORD: credentials.password, CHATGRAPH_TRUST_PROXY: 'loopback-cloudflare' } });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    if (stopping) return;
    await writeStatus('listening');
    if (stopping) return;
    console.log(`Temporary ChatGraph workspace: ${origin}`);
    console.log('The workspace password is stored in the private credentials.json file. This URL depends on this computer and tunnel process staying online.');
    clearTimeout(startupDeadline);
  } catch { console.error('The protected preview workspace failed to start; check the dedicated port and private directory.'); void stop(1); }
}
let logBuffer = '';
function output(chunk) {
  const text = chunk.toString('utf8');
  process.stderr.write(text);
  logBuffer = (logBuffer + text).slice(-16_384);
  const url = logBuffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
  if (url && !origin && !stopping) workspaceStarting = startWorkspace(url);
}
tunnel.stdout.on('data', output); tunnel.stderr.on('data', output);
tunnel.on('error', () => { console.error('Unable to run cloudflared.'); void stop(1); });
tunnel.on('exit', code => { if (!stopping) { console.error('The temporary tunnel stopped; its address is no longer usable.'); void stop(code || 1); } });
async function stop(code = 0) {
  if (stopping) return;
  stopping = true; clearTimeout(startupDeadline);
  const force = setTimeout(() => process.exit(code), 8_000); force.unref();
  const tunnelStopped = new Promise(resolve => {
    if (tunnel.exitCode !== null || tunnel.signalCode !== null || !tunnel.pid) { resolve(); return; }
    const kill = setTimeout(() => tunnel.kill('SIGKILL'), 2_000);
    tunnel.once('exit', () => { clearTimeout(kill); resolve(); });
  });
  tunnel.kill('SIGTERM');
  await workspaceStarting;
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await tunnelStopped;
  await writeStatus('stopped');
  process.exit(code);
}
process.on('SIGINT', () => { void stop(0); });
process.on('SIGTERM', () => { void stop(0); });
